/**
 * @Cacheable decorator - caches method results
 */

import type { CacheManager } from '../core/cache-manager.js';
import { buildKeyFromArgs } from '../core/cache-key.js';

/** Options for @Cacheable decorator */
export interface CacheableOptions {
  /** Data type for TTL resolution */
  type?: string;
  /** Custom TTL in seconds (overrides type-based TTL) */
  ttl?: number;
  /** Custom key generator */
  keyGenerator?: (methodName: string, args: unknown[]) => string;
  /** Cache manager instance (required) */
  cacheManager: CacheManager;
}

/** Storage for decorator metadata */
const cacheableMetadata = new WeakMap<object, Map<string, CacheableOptions>>();

/**
 * Get or create metadata map for a target
 */
function getMetadataMap(target: object): Map<string, CacheableOptions> {
  let map = cacheableMetadata.get(target);
  if (!map) {
    map = new Map();
    cacheableMetadata.set(target, map);
  }
  return map;
}

/**
 * @Cacheable decorator
 * Caches the result of a method call
 *
 * @example
 * class UserService {
 *   @Cacheable({ type: 'user-profile', cacheManager })
 *   async getUserById(id: string): Promise<User> {
 *     return db.users.findById(id);
 *   }
 * }
 */
export function Cacheable(options: CacheableOptions) {
  return function <T extends (...args: any[]) => Promise<any>>(
    target: object,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (!originalMethod) {
      throw new Error('@Cacheable can only be applied to methods');
    }

    // Store metadata
    getMetadataMap(target).set(propertyKey, options);

    descriptor.value = async function (this: any, ...args: unknown[]) {
      const { cacheManager, type, ttl, keyGenerator } = options;

      // Generate cache key
      const key = keyGenerator
        ? keyGenerator(propertyKey, args)
        : buildKeyFromArgs(propertyKey, args, { type });

      // Try to get from cache or fetch
      return cacheManager.getOrFetch(
        key,
        () => originalMethod.apply(this, args),
        { type, ttl }
      );
    } as T;

    return descriptor;
  };
}

/**
 * Wrapper function for caching (alternative to decorator)
 *
 * @example
 * const user = await withCache(
 *   cacheManager,
 *   `user:${id}`,
 *   () => db.users.findById(id),
 *   { type: 'user-profile' }
 * );
 */
export async function withCache<T>(
  cacheManager: CacheManager<T>,
  key: string,
  fetchFn: () => Promise<T>,
  options?: { type?: string; ttl?: number }
): Promise<T> {
  return cacheManager.getOrFetch(key, fetchFn, options);
}
