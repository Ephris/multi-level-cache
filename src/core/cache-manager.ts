/**
 * Main Cache Manager - orchestrates L1 and L2 caches
 */

import type {
  CacheConfig,
  CacheOptions,
  CacheResult,
  CacheStats,
  CacheWarmupEntry,
  SetOptions,
  TTLConfig,
} from '../types/index.js';
import { DEFAULT_CONFIG } from '../types/config.types.js';
import { LRUCache } from '../l1/lru-cache.js';
import { RedisCache } from '../l2/redis-cache.js';
import {
  DistributedLock,
  InMemoryLock,
  type Lock,
} from '../strategies/stampede-protection.js';
import {
  InvalidationManager,
  TypeRegistry,
} from '../strategies/invalidation.js';
import { StatsCollector } from '../stats/collector.js';

/** Internal cache options with resolved TTL */
interface ResolvedOptions extends CacheOptions {
  l1TTL: number;
  l2TTL: number;
}

/**
 * Multi-level cache manager with L1 (in-memory) and L2 (Redis) caches
 */
export class CacheManager<T = unknown> {
  private readonly config: CacheConfig;
  private readonly l1: LRUCache<T>;
  private readonly l2: RedisCache<T> | null;
  private readonly lock: DistributedLock | InMemoryLock;
  private readonly typeRegistry: TypeRegistry;
  private readonly invalidation: InvalidationManager<T>;
  private readonly stats: StatsCollector;
  private readonly pendingFetches = new Map<string, Promise<T>>();

  constructor(config: CacheConfig) {
    this.config = {
      ...config,
      fallback: { ...DEFAULT_CONFIG.fallback, ...config.fallback },
      stats: { ...DEFAULT_CONFIG.stats, ...config.stats },
    };

    // Initialize L1 cache
    this.l1 = new LRUCache<T>({
      maxSize: this.config.l1.maxSize,
      defaultTTL: this.config.l1.defaultTTL,
      maxMemoryMB: this.config.l1.maxMemoryMB,
    });

    // Initialize L2 cache (optional)
    if (this.config.l2) {
      this.l2 = new RedisCache<T>(
        this.config.l2,
        this.config.fallback?.onL2Failure ?? 'use-l1'
      );
    } else {
      this.l2 = null;
    }

    // Initialize lock
    if (this.l2) {
      // Will be set after connection
      this.lock = new InMemoryLock();
    } else {
      this.lock = new InMemoryLock();
    }

    // Initialize type registry and invalidation manager
    this.typeRegistry = new TypeRegistry();
    this.invalidation = new InvalidationManager<T>(
      this.l1,
      this.l2,
      this.typeRegistry
    );

    // Initialize stats collector
    this.stats = new StatsCollector({
      enabled: this.config.stats?.enabled ?? true,
      sampleRate: this.config.stats?.sampleRate ?? 1.0,
    });

    // Track L1 evictions
    this.l1.onEviction(() => {
      this.stats.recordL1Eviction();
    });
  }

  /** Connect to Redis (if configured) */
  async connect(): Promise<void> {
    if (this.l2) {
      await this.l2.connect();

      // Upgrade to distributed lock after connection
      if (this.l2.isConnected()) {
        const redis = (this.l2 as any).connection.getClient();
        (this as any).lock = new DistributedLock(redis, 'cache:lock');
      }

      // Initialize invalidation subscriptions
      await this.invalidation.init();
    }
  }

  /** Disconnect and cleanup */
  async disconnect(): Promise<void> {
    await this.invalidation.destroy();
    if (this.l2) {
      await this.l2.disconnect();
    }
  }

  /** Resolve TTL for a type */
  private resolveTTL(type?: string): { l1TTL: number; l2TTL: number } {
    if (type && this.config.ttlByType) {
      const ttlConfig = this.config.ttlByType.get(type);
      if (ttlConfig) {
        return { l1TTL: ttlConfig.l1TTL, l2TTL: ttlConfig.l2TTL };
      }
    }

    return {
      l1TTL: this.config.l1.defaultTTL,
      l2TTL: this.config.l2?.defaultTTL ?? this.config.l1.defaultTTL,
    };
  }

  /** Resolve full options */
  private resolveOptions(options?: CacheOptions): ResolvedOptions {
    const ttl = this.resolveTTL(options?.type);
    return {
      ...options,
      l1TTL: options?.ttl ?? ttl.l1TTL,
      l2TTL: options?.ttl ?? ttl.l2TTL,
    };
  }

  /**
   * Get a value from cache
   * Checks L1 first, then L2
   */
  async get(key: string, type?: string): Promise<CacheResult<T>> {
    this.stats.recordGet();
    const start = Date.now();

    // Try L1
    const l1Start = Date.now();
    const l1Value = await this.l1.get(key);
    const l1Latency = Date.now() - l1Start;

    if (l1Value !== null) {
      this.stats.recordL1Hit(l1Latency, type);
      return {
        value: l1Value,
        hit: true,
        source: 'l1',
        latencyMs: Date.now() - start,
      };
    }

    this.stats.recordL1Miss();

    // Try L2
    if (this.l2 && this.l2.isConnected()) {
      const l2Start = Date.now();
      const l2Value = await this.l2.get(key);
      const l2Latency = Date.now() - l2Start;

      if (l2Value !== null) {
        this.stats.recordL2Hit(l2Latency, type);

        // Populate L1
        const { l1TTL } = this.resolveTTL(type);
        await this.l1.set(key, l2Value, { ttl: l1TTL, type });

        if (type) {
          this.typeRegistry.register(key, type);
        }

        return {
          value: l2Value,
          hit: true,
          source: 'l2',
          latencyMs: Date.now() - start,
        };
      }

      this.stats.recordL2Miss(type);
    }

    return {
      value: null,
      hit: false,
      source: null,
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Get a value from cache, or fetch from origin if not found
   * Includes stampede protection
   */
  async getOrFetch(
    key: string,
    fetchFn: () => Promise<T>,
    options?: CacheOptions
  ): Promise<T> {
    const resolved = this.resolveOptions(options);

    // Try cache first
    const cached = await this.get(key, resolved.type);
    if (cached.hit && cached.value !== null) {
      return cached.value;
    }

    // Check if there's already a pending fetch for this key
    const pending = this.pendingFetches.get(key);
    if (pending) {
      this.stats.recordStampedePrevented();
      return pending;
    }

    // Acquire lock for stampede protection
    const lockResult = await this.lock.withLock(
      key,
      async () => {
        // Double-check cache after acquiring lock
        const recheckCached = await this.get(key, resolved.type);
        if (recheckCached.hit && recheckCached.value !== null) {
          return recheckCached.value;
        }

        // Fetch from origin
        const fetchPromise = fetchFn();
        this.pendingFetches.set(key, fetchPromise);

        try {
          const value = await fetchPromise;

          // Store in cache
          await this.set(key, value, resolved);

          return value;
        } finally {
          this.pendingFetches.delete(key);
        }
      },
      { ttlMs: 30000, waitTimeMs: 10000 }
    );

    if (lockResult.acquired) {
      return lockResult.result;
    }

    // Lock not acquired, try cache one more time
    this.stats.recordStampedePrevented();
    const finalCached = await this.get(key, resolved.type);
    if (finalCached.hit && finalCached.value !== null) {
      return finalCached.value;
    }

    // Last resort: fetch directly (might cause some stampede)
    return fetchFn();
  }

  /**
   * Set a value in cache
   * Writes to L2 first (source of truth), then L1
   */
  async set(key: string, value: T, options?: CacheOptions): Promise<void> {
    this.stats.recordSet();
    const resolved = this.resolveOptions(options);

    // Write to L2 first (if available)
    if (this.l2 && this.l2.isConnected() && !resolved.skipL2) {
      await this.l2.set(key, value, { ttl: resolved.l2TTL, type: resolved.type });
    }

    // Write to L1
    if (!resolved.skipL1) {
      await this.l1.set(key, value, { ttl: resolved.l1TTL, type: resolved.type });
    }

    // Register type
    if (resolved.type) {
      this.typeRegistry.register(key, resolved.type);
    }
  }

  /**
   * Delete a key from cache
   */
  async delete(key: string): Promise<boolean> {
    this.stats.recordDelete();
    const existed = await this.has(key);
    await this.invalidation.invalidate(key);
    return existed;
  }

  /**
   * Invalidate a cache entry
   * Optionally broadcasts to other servers
   */
  async invalidate(
    key: string,
    options?: { broadcast?: boolean }
  ): Promise<void> {
    this.stats.recordDelete();
    await this.invalidation.invalidate(key, options);
  }

  /**
   * Delete all keys matching a pattern
   */
  async deleteByPattern(pattern: string): Promise<number> {
    return this.invalidation.invalidateByPattern(pattern);
  }

  /**
   * Delete all keys of a specific type
   */
  async deleteByType(type: string): Promise<number> {
    return this.invalidation.invalidateByType(type);
  }

  /**
   * Refresh a cache entry by fetching fresh data
   */
  async refresh(
    key: string,
    fetchFn: () => Promise<T>,
    options?: CacheOptions
  ): Promise<T> {
    // Invalidate first
    await this.invalidate(key);

    // Fetch and store new value
    const value = await fetchFn();
    await this.set(key, value, options);

    return value;
  }

  /**
   * Check if a key exists in cache
   */
  async has(key: string): Promise<boolean> {
    if (await this.l1.has(key)) {
      return true;
    }
    if (this.l2 && this.l2.isConnected()) {
      return this.l2.has(key);
    }
    return false;
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    await this.invalidation.clear();
  }

  /**
   * Warmup cache with initial data
   */
  async warmup(entries: CacheWarmupEntry<T>[]): Promise<void> {
    for (const entry of entries) {
      await this.set(entry.key, entry.value, entry.options);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return this.stats.getStats(
      this.l1.size,
      this.l2 ? (this.l2 as any).map?.size ?? 0 : null
    );
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats.reset();
  }

  /**
   * Check if L2 is connected
   */
  isL2Connected(): boolean {
    return this.l2?.isConnected() ?? false;
  }
}

/**
 * Factory function to create a cache manager
 */
export function createCacheManager<T = unknown>(
  config: CacheConfig
): CacheManager<T> {
  return new CacheManager<T>(config);
}
