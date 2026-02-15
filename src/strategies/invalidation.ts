/**
 * Cache invalidation strategies
 */

import type { LRUCache } from '../l1/lru-cache.js';
import type { RedisCache, InvalidationMessage } from '../l2/redis-cache.js';

/** Type registry for type-based invalidation */
export class TypeRegistry {
  private readonly typeToKeys = new Map<string, Set<string>>();

  /** Register a key with a type */
  register(key: string, type: string): void {
    let keys = this.typeToKeys.get(type);
    if (!keys) {
      keys = new Set();
      this.typeToKeys.set(type, keys);
    }
    keys.add(key);
  }

  /** Unregister a key */
  unregister(key: string, type?: string): void {
    if (type) {
      const keys = this.typeToKeys.get(type);
      if (keys) {
        keys.delete(key);
      }
    } else {
      // Remove from all types
      for (const keys of this.typeToKeys.values()) {
        keys.delete(key);
      }
    }
  }

  /** Get all keys for a type */
  getKeysByType(type: string): string[] {
    const keys = this.typeToKeys.get(type);
    return keys ? Array.from(keys) : [];
  }

  /** Clear all registrations */
  clear(): void {
    this.typeToKeys.clear();
  }
}

/** Invalidation options */
export interface InvalidationOptions {
  /** Broadcast to other servers via pub/sub */
  broadcast?: boolean;
}

/**
 * Cache invalidation manager
 */
export class InvalidationManager<T = unknown> {
  private readonly l1: LRUCache<T>;
  private readonly l2: RedisCache<T> | null;
  private readonly typeRegistry: TypeRegistry;
  private unsubscribe: (() => Promise<void>) | null = null;

  constructor(
    l1: LRUCache<T>,
    l2: RedisCache<T> | null,
    typeRegistry: TypeRegistry
  ) {
    this.l1 = l1;
    this.l2 = l2;
    this.typeRegistry = typeRegistry;
  }

  /** Initialize pub/sub subscription for cross-server invalidation */
  async init(): Promise<void> {
    if (this.l2) {
      this.unsubscribe = await this.l2.subscribeToInvalidations(
        this.handleInvalidationMessage.bind(this)
      );
    }
  }

  /** Cleanup subscriptions */
  async destroy(): Promise<void> {
    if (this.unsubscribe) {
      await this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** Handle incoming invalidation message from pub/sub */
  private async handleInvalidationMessage(
    message: InvalidationMessage
  ): Promise<void> {
    if (message.key) {
      await this.l1.delete(message.key);
    }
    if (message.pattern) {
      await this.invalidateByPatternLocal(message.pattern);
    }
    if (message.type) {
      await this.invalidateByTypeLocal(message.type);
    }
  }

  /** Invalidate a single key */
  async invalidate(key: string, options?: InvalidationOptions): Promise<void> {
    // Delete from L1
    await this.l1.delete(key);

    // Delete from L2 and optionally broadcast
    if (this.l2) {
      await this.l2.delete(key);

      if (options?.broadcast) {
        await this.l2.publishInvalidation({
          key,
          timestamp: Date.now(),
        });
      }
    }

    // Remove from type registry
    this.typeRegistry.unregister(key);
  }

  /** Invalidate keys matching a pattern (local only) */
  private async invalidateByPatternLocal(pattern: string): Promise<number> {
    const keys = await this.l1.keys(pattern);
    for (const key of keys) {
      await this.l1.delete(key);
      this.typeRegistry.unregister(key);
    }
    return keys.length;
  }

  /** Invalidate by pattern */
  async invalidateByPattern(
    pattern: string,
    options?: InvalidationOptions
  ): Promise<number> {
    let deleted = await this.invalidateByPatternLocal(pattern);

    if (this.l2) {
      const l2Deleted = await this.l2.deleteByPattern(pattern);
      deleted = Math.max(deleted, l2Deleted);

      if (options?.broadcast) {
        await this.l2.publishInvalidation({
          pattern,
          timestamp: Date.now(),
        });
      }
    }

    return deleted;
  }

  /** Invalidate by type (local only) */
  private async invalidateByTypeLocal(type: string): Promise<number> {
    const keys = this.typeRegistry.getKeysByType(type);
    for (const key of keys) {
      await this.l1.delete(key);
    }
    // Clear the type registry for this type
    for (const key of keys) {
      this.typeRegistry.unregister(key, type);
    }
    return keys.length;
  }

  /** Invalidate all entries of a type */
  async invalidateByType(
    type: string,
    options?: InvalidationOptions
  ): Promise<number> {
    const keys = this.typeRegistry.getKeysByType(type);
    let deleted = await this.invalidateByTypeLocal(type);

    if (this.l2) {
      // Delete from L2
      for (const key of keys) {
        await this.l2.delete(key);
      }
      deleted = keys.length;

      if (options?.broadcast) {
        await this.l2.publishInvalidation({
          type,
          timestamp: Date.now(),
        });
      }
    }

    return deleted;
  }

  /** Clear all caches */
  async clear(): Promise<void> {
    await this.l1.clear();
    if (this.l2) {
      await this.l2.clear();
    }
    this.typeRegistry.clear();
  }
}
