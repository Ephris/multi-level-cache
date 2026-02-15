/**
 * Multi-Level Cache System
 *
 * A database-agnostic, two-tier caching module with:
 * - L1: In-memory LRU cache (fast, local)
 * - L2: Redis cache (shared across servers)
 * - Configurable TTL per data type
 * - Automatic cache invalidation
 * - Cache hit/miss statistics
 *
 * @example
 * ```typescript
 * import { createCacheManager } from 'multi-level-cache';
 *
 * const cache = createCacheManager({
 *   l1: { maxSize: 1000, defaultTTL: 300 },
 *   l2: {
 *     redis: { host: 'localhost', port: 6379 },
 *     keyPrefix: 'app',
 *     defaultTTL: 3600
 *   },
 *   ttlByType: new Map([
 *     ['user-profile', { l1TTL: 300, l2TTL: 3600 }],
 *     ['product', { l1TTL: 60, l2TTL: 300 }],
 *   ]),
 * });
 *
 * await cache.connect();
 *
 * // Fetch with automatic caching
 * const user = await cache.getOrFetch(
 *   `user:${id}`,
 *   () => db.users.findById(id),
 *   { type: 'user-profile' }
 * );
 *
 * // Invalidate on update
 * await cache.invalidate(`user:${id}`, { broadcast: true });
 *
 * // Check stats
 * console.log(cache.getStats());
 * ```
 */

// Core
export { CacheManager, createCacheManager } from './core/cache-manager.js';
export { buildKey, buildKeyFromArgs, extractType } from './core/cache-key.js';
export { serialize, deserialize } from './core/serializer.js';

// L1 Cache
export { LRUCache, type LRUCacheConfig } from './l1/lru-cache.js';

// L2 Cache
export {
  RedisCache,
  type InvalidationMessage,
  type InvalidationListener,
} from './l2/redis-cache.js';
export {
  RedisConnection,
  type ConnectionState,
  type ConnectionStateListener,
} from './l2/redis-connection.js';

// Strategies
export {
  DistributedLock,
  InMemoryLock,
  type Lock,
  type LockOptions,
} from './strategies/stampede-protection.js';
export {
  InvalidationManager,
  TypeRegistry,
  type InvalidationOptions,
} from './strategies/invalidation.js';

// Stats
export { StatsCollector, type StatsCollectorConfig } from './stats/collector.js';

// Decorators
export {
  Cacheable,
  withCache,
  CacheInvalidate,
  CachePut,
  type CacheableOptions,
  type CacheInvalidateOptions,
  type CachePutOptions,
} from './decorators/index.js';

// Types
export type {
  // Cache types
  ICacheStore,
  SetOptions,
  CacheOptions,
  CacheSource,
  CacheEntry,
  CacheResult,
  CacheWarmupEntry,
  EvictionReason,
  EvictionEvent,
  EvictionListener,
  // Config types
  CacheConfig,
  L1Config,
  L2Config,
  TTLConfig,
  L2FailureStrategy,
  FallbackConfig,
  StatsConfig,
  // Stats types
  CacheStats,
  LayerStats,
  OperationStats,
  LatencyStats,
  TypeStats,
} from './types/index.js';

export { DEFAULT_CONFIG } from './types/config.types.js';
