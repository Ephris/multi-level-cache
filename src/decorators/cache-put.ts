/**
 * @CachePut decorator - updates cache with method result
 */

import type { CacheManager } from '../core/cache-manager.js';
import { buildKeyFromArgs } from '../core/cache-key.js';

/** Options for @CachePut decorator */
export interface CachePutOptions {
  /** Data type for TTL resolution */
  type?: string;
  /** Custom TTL in seconds */
  ttl?: number;
  /** Index of the argument to use as cache key (0-based) */
  keyArg?: number;
  /** Custom key generator */
  keyGenerator?: (methodName: string, args: unknown[]) => string;
  /** Broadcast update to other servers (invalidates their L1) */
  broadcast?: boolean;
  /** Cache manager instance (required) */
  cacheManager: CacheManager;
}

/**
 * @CachePut decorator
 * Updates cache with the method's return value after execution
 *
 * @example
 * class UserService {
 *   @CachePut({ type: 'user-profile', keyArg: 0, cacheManager })
 *   async updateUser(id: string, data: UserUpdate): Promise<User> {
 *     return db.users.update(id, data);
 *   }
 * }
 */
export function CachePut(options: CachePutOptions) {
  return function <T extends (...args: any[]) => Promise<any>>(
    _target: object,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (!originalMethod) {
      throw new Error('@CachePut can only be applied to methods');
    }

    descriptor.value = async function (this: any, ...args: unknown[]) {
      const { cacheManager, type, ttl, keyArg, keyGenerator, broadcast } =
        options;

      // Execute the method first
      const result = await originalMethod.apply(this, args);

      // Update cache with the result
      try {
        let key: string;
        if (keyGenerator) {
          key = keyGenerator(propertyKey, args);
        } else if (keyArg !== undefined) {
          const keyValue = args[keyArg];
          key = type ? `${type}:${keyValue}` : String(keyValue);
        } else {
          key = buildKeyFromArgs(propertyKey, args, { type });
        }

        // If broadcast is enabled, invalidate other servers' L1 first
        if (broadcast) {
          await cacheManager.invalidate(key, { broadcast: true });
        }

        // Store the new value
        await cacheManager.set(key, result, { type, ttl });
      } catch {
        // Log but don't fail the operation due to cache errors
        console.warn('Cache put failed:', propertyKey);
      }

      return result;
    } as T;

    return descriptor;
  };
}
