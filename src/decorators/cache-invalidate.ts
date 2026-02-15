/**
 * @CacheInvalidate decorator - invalidates cache after method execution
 */

import type { CacheManager } from '../core/cache-manager.js';
import { buildKeyFromArgs } from '../core/cache-key.js';

/** Options for @CacheInvalidate decorator */
export interface CacheInvalidateOptions {
  /** Data type for type-based invalidation */
  type?: string;
  /** Index of the argument to use as cache key (0-based) */
  keyArg?: number;
  /** Custom key generator */
  keyGenerator?: (methodName: string, args: unknown[]) => string;
  /** Invalidate by pattern (supports * wildcard) */
  pattern?: string | ((args: unknown[]) => string);
  /** Broadcast invalidation to other servers */
  broadcast?: boolean;
  /** Cache manager instance (required) */
  cacheManager: CacheManager;
}

/**
 * @CacheInvalidate decorator
 * Invalidates cache entries after a method executes successfully
 *
 * @example
 * class UserService {
 *   @CacheInvalidate({ type: 'user-profile', keyArg: 0, cacheManager })
 *   async updateUser(id: string, data: UserUpdate): Promise<User> {
 *     return db.users.update(id, data);
 *   }
 * }
 */
export function CacheInvalidate(options: CacheInvalidateOptions) {
  return function <T extends (...args: any[]) => Promise<any>>(
    _target: object,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (!originalMethod) {
      throw new Error('@CacheInvalidate can only be applied to methods');
    }

    descriptor.value = async function (this: any, ...args: unknown[]) {
      const { cacheManager, type, keyArg, keyGenerator, pattern, broadcast } =
        options;

      // Execute the method first
      const result = await originalMethod.apply(this, args);

      // Invalidate after successful execution
      try {
        if (pattern) {
          // Pattern-based invalidation
          const resolvedPattern =
            typeof pattern === 'function' ? pattern(args) : pattern;
          await cacheManager.deleteByPattern(resolvedPattern);
        } else if (type && keyArg === undefined && !keyGenerator) {
          // Type-based invalidation
          await cacheManager.deleteByType(type);
        } else {
          // Key-based invalidation
          let key: string;
          if (keyGenerator) {
            key = keyGenerator(propertyKey, args);
          } else if (keyArg !== undefined) {
            const keyValue = args[keyArg];
            key = type ? `${type}:${keyValue}` : String(keyValue);
          } else {
            key = buildKeyFromArgs(propertyKey, args, { type });
          }

          await cacheManager.invalidate(key, { broadcast });
        }
      } catch {
        // Log but don't fail the operation due to cache invalidation errors
        console.warn('Cache invalidation failed:', propertyKey);
      }

      return result;
    } as T;

    return descriptor;
  };
}
