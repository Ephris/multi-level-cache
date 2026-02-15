/**
 * Redis cache adapter implementing ICacheStore
 */

import type { Redis } from 'ioredis';
import type { ICacheStore, SetOptions } from '../types/index.js';
import { serialize, deserialize } from '../core/serializer.js';
import { RedisConnection, type ConnectionState } from './redis-connection.js';
import type { L2Config, L2FailureStrategy } from '../types/config.types.js';

/** Invalidation message for pub/sub */
export interface InvalidationMessage {
  key?: string;
  pattern?: string;
  type?: string;
  timestamp: number;
}

/** Invalidation listener */
export type InvalidationListener = (message: InvalidationMessage) => void;

/**
 * Redis cache adapter with connection resilience
 */
export class RedisCache<T = unknown> implements ICacheStore<T> {
  private readonly connection: RedisConnection;
  private readonly keyPrefix: string;
  private readonly defaultTTL: number;
  private readonly failureStrategy: L2FailureStrategy;
  private subscriber: Redis | null = null;
  private readonly invalidationListeners: Set<InvalidationListener> = new Set();

  // Stats tracking
  private _evictions = 0;

  private static readonly INVALIDATION_CHANNEL = 'cache:invalidation';

  constructor(config: L2Config, failureStrategy: L2FailureStrategy = 'use-l1') {
    this.connection = new RedisConnection(config.redis);
    this.keyPrefix = config.keyPrefix;
    this.defaultTTL = config.defaultTTL;
    this.failureStrategy = failureStrategy;
  }

  /** Get eviction count */
  get evictions(): number {
    return this._evictions;
  }

  /** Get connection state */
  get state(): ConnectionState {
    return this.connection.state;
  }

  /** Build full key with prefix */
  private buildKey(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  /** Connect to Redis */
  async connect(): Promise<void> {
    await this.connection.connect();
  }

  /** Disconnect from Redis */
  async disconnect(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
    await this.connection.disconnect();
  }

  /** Check if connected */
  isConnected(): boolean {
    return this.connection.isConnected();
  }

  /** Execute a command with error handling */
  private async execute<R>(
    operation: (client: Redis) => Promise<R>,
    fallback?: () => R
  ): Promise<R> {
    if (!this.connection.isConnected()) {
      if (this.failureStrategy === 'throw') {
        throw new Error('Redis not connected');
      }
      if (fallback) {
        return fallback();
      }
      throw new Error('Redis not connected and no fallback provided');
    }

    try {
      return await operation(this.connection.getClient());
    } catch (error) {
      if (this.failureStrategy === 'throw') {
        throw error;
      }
      if (fallback) {
        return fallback();
      }
      throw error;
    }
  }

  async get(key: string): Promise<T | null> {
    return this.execute(
      async (client) => {
        const fullKey = this.buildKey(key);
        const data = await client.get(fullKey);
        if (data === null) {
          return null;
        }
        return deserialize<T>(data);
      },
      () => null
    );
  }

  async set(key: string, value: T, options?: SetOptions): Promise<void> {
    return this.execute(async (client) => {
      const fullKey = this.buildKey(key);
      const ttl = options?.ttl ?? this.defaultTTL;
      const serialized = serialize(value);

      if (ttl > 0) {
        await client.setex(fullKey, ttl, serialized);
      } else {
        await client.set(fullKey, serialized);
      }
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.execute(
      async (client) => {
        const fullKey = this.buildKey(key);
        const result = await client.del(fullKey);
        if (result > 0) {
          this._evictions++;
        }
        return result > 0;
      },
      () => false
    );
  }

  async has(key: string): Promise<boolean> {
    return this.execute(
      async (client) => {
        const fullKey = this.buildKey(key);
        const result = await client.exists(fullKey);
        return result > 0;
      },
      () => false
    );
  }

  async clear(): Promise<void> {
    return this.execute(async (client) => {
      const pattern = this.buildKey('*');
      let cursor = '0';

      do {
        const [newCursor, keys] = await client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100
        );
        cursor = newCursor;

        if (keys.length > 0) {
          await client.del(...keys);
          this._evictions += keys.length;
        }
      } while (cursor !== '0');
    });
  }

  async keys(pattern?: string): Promise<string[]> {
    return this.execute(
      async (client) => {
        const fullPattern = this.buildKey(pattern || '*');
        const keys: string[] = [];
        let cursor = '0';

        do {
          const [newCursor, foundKeys] = await client.scan(
            cursor,
            'MATCH',
            fullPattern,
            'COUNT',
            100
          );
          cursor = newCursor;
          keys.push(...foundKeys);
        } while (cursor !== '0');

        // Remove prefix from keys
        const prefixLength = this.keyPrefix.length + 1;
        return keys.map((key) => key.slice(prefixLength));
      },
      () => []
    );
  }

  async mget(keys: string[]): Promise<Map<string, T | null>> {
    return this.execute(
      async (client) => {
        const fullKeys = keys.map((k) => this.buildKey(k));
        const values = await client.mget(...fullKeys);

        const result = new Map<string, T | null>();
        keys.forEach((key, index) => {
          const value = values[index];
          result.set(key, value ? deserialize<T>(value) : null);
        });

        return result;
      },
      () => {
        const result = new Map<string, T | null>();
        keys.forEach((key) => result.set(key, null));
        return result;
      }
    );
  }

  async mset(entries: Map<string, T>, options?: SetOptions): Promise<void> {
    return this.execute(async (client) => {
      const ttl = options?.ttl ?? this.defaultTTL;
      const pipeline = client.pipeline();

      for (const [key, value] of entries) {
        const fullKey = this.buildKey(key);
        const serialized = serialize(value);

        if (ttl > 0) {
          pipeline.setex(fullKey, ttl, serialized);
        } else {
          pipeline.set(fullKey, serialized);
        }
      }

      await pipeline.exec();
    });
  }

  /** Delete keys matching a pattern */
  async deleteByPattern(pattern: string): Promise<number> {
    return this.execute(
      async (client) => {
        const fullPattern = this.buildKey(pattern);
        let cursor = '0';
        let deleted = 0;

        do {
          const [newCursor, keys] = await client.scan(
            cursor,
            'MATCH',
            fullPattern,
            'COUNT',
            100
          );
          cursor = newCursor;

          if (keys.length > 0) {
            const result = await client.del(...keys);
            deleted += result;
          }
        } while (cursor !== '0');

        this._evictions += deleted;
        return deleted;
      },
      () => 0
    );
  }

  /** Subscribe to invalidation events */
  async subscribeToInvalidations(
    listener: InvalidationListener
  ): Promise<() => Promise<void>> {
    this.invalidationListeners.add(listener);

    if (!this.subscriber && this.connection.isConnected()) {
      const client = this.connection.getClient();
      this.subscriber = client.duplicate();

      await this.subscriber.subscribe(RedisCache.INVALIDATION_CHANNEL);

      this.subscriber.on('message', (_channel, message) => {
        try {
          const parsed = JSON.parse(message) as InvalidationMessage;
          for (const l of this.invalidationListeners) {
            try {
              l(parsed);
            } catch {
              // Ignore listener errors
            }
          }
        } catch {
          // Ignore parse errors
        }
      });
    }

    return async () => {
      this.invalidationListeners.delete(listener);
      if (this.invalidationListeners.size === 0 && this.subscriber) {
        await this.subscriber.unsubscribe(RedisCache.INVALIDATION_CHANNEL);
        await this.subscriber.quit();
        this.subscriber = null;
      }
    };
  }

  /** Publish an invalidation event */
  async publishInvalidation(message: InvalidationMessage): Promise<void> {
    return this.execute(async (client) => {
      await client.publish(
        RedisCache.INVALIDATION_CHANNEL,
        JSON.stringify(message)
      );
    });
  }

  /** Health check */
  async ping(): Promise<boolean> {
    return this.connection.ping();
  }
}
