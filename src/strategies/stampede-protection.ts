/**
 * Distributed locking for stampede protection
 */

import type { Redis } from 'ioredis';

/** Lock information */
export interface Lock {
  key: string;
  value: string;
  release: () => Promise<boolean>;
}

/** Lock options */
export interface LockOptions {
  /** Lock TTL in milliseconds */
  ttlMs?: number;
  /** Max wait time in milliseconds */
  waitTimeMs?: number;
  /** Retry interval in milliseconds */
  retryIntervalMs?: number;
}

const DEFAULT_LOCK_OPTIONS: Required<LockOptions> = {
  ttlMs: 10000, // 10 seconds
  waitTimeMs: 5000, // 5 seconds
  retryIntervalMs: 50, // 50ms
};

/**
 * Generate a unique lock value
 */
function generateLockValue(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Distributed lock manager using Redis
 */
export class DistributedLock {
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(redis: Redis, keyPrefix = 'lock') {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  /** Build the lock key */
  private buildKey(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  /**
   * Try to acquire a lock
   * Returns the lock if acquired, null otherwise
   */
  async tryAcquire(key: string, options?: LockOptions): Promise<Lock | null> {
    const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
    const lockKey = this.buildKey(key);
    const lockValue = generateLockValue();

    // Try to set the lock with NX (only if not exists) and PX (TTL in ms)
    const result = await this.redis.set(
      lockKey,
      lockValue,
      'PX',
      opts.ttlMs,
      'NX'
    );

    if (result !== 'OK') {
      return null;
    }

    return {
      key: lockKey,
      value: lockValue,
      release: async () => this.release(lockKey, lockValue),
    };
  }

  /**
   * Acquire a lock, waiting if necessary
   * Returns the lock if acquired within the wait time, null otherwise
   */
  async acquire(key: string, options?: LockOptions): Promise<Lock | null> {
    const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
    const startTime = Date.now();

    while (Date.now() - startTime < opts.waitTimeMs) {
      const lock = await this.tryAcquire(key, opts);
      if (lock) {
        return lock;
      }
      await sleep(opts.retryIntervalMs);
    }

    return null;
  }

  /**
   * Release a lock (only if we own it)
   */
  private async release(lockKey: string, lockValue: string): Promise<boolean> {
    // Use Lua script to ensure atomic check-and-delete
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await this.redis.eval(script, 1, lockKey, lockValue);
    return result === 1;
  }

  /**
   * Execute a function with a lock
   * Returns the result of the function, or null if lock couldn't be acquired
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options?: LockOptions
  ): Promise<{ acquired: true; result: T } | { acquired: false; result: null }> {
    const lock = await this.acquire(key, options);

    if (!lock) {
      return { acquired: false, result: null };
    }

    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      await lock.release();
    }
  }
}

/**
 * In-memory lock for L1-only mode (no Redis)
 */
export class InMemoryLock {
  private readonly locks = new Map<string, { value: string; expiresAt: number }>();

  /** Clean up expired locks */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, lock] of this.locks) {
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }

  /** Try to acquire a lock */
  async tryAcquire(key: string, options?: LockOptions): Promise<Lock | null> {
    this.cleanup();

    const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };

    if (this.locks.has(key)) {
      return null;
    }

    const lockValue = generateLockValue();
    this.locks.set(key, {
      value: lockValue,
      expiresAt: Date.now() + opts.ttlMs,
    });

    return {
      key,
      value: lockValue,
      release: async () => {
        const lock = this.locks.get(key);
        if (lock && lock.value === lockValue) {
          this.locks.delete(key);
          return true;
        }
        return false;
      },
    };
  }

  /** Acquire a lock, waiting if necessary */
  async acquire(key: string, options?: LockOptions): Promise<Lock | null> {
    const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
    const startTime = Date.now();

    while (Date.now() - startTime < opts.waitTimeMs) {
      const lock = await this.tryAcquire(key, opts);
      if (lock) {
        return lock;
      }
      await sleep(opts.retryIntervalMs);
    }

    return null;
  }

  /** Execute with lock */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options?: LockOptions
  ): Promise<{ acquired: true; result: T } | { acquired: false; result: null }> {
    const lock = await this.acquire(key, options);

    if (!lock) {
      return { acquired: false, result: null };
    }

    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      await lock.release();
    }
  }
}
