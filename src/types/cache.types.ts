/**
 * Core cache interfaces and types
 */

/** Options for set operations */
export interface SetOptions {
  ttl?: number;
  type?: string;
}

/** Options for cache operations */
export interface CacheOptions extends SetOptions {
  skipL1?: boolean;
  skipL2?: boolean;
  broadcast?: boolean;
}

/** Metadata about where data came from */
export type CacheSource = 'l1' | 'l2' | 'origin';

/** A cached entry with metadata */
export interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
  type?: string;
  source: CacheSource;
}

/** Result of a cache get operation */
export interface CacheResult<T> {
  value: T | null;
  hit: boolean;
  source: CacheSource | null;
  latencyMs: number;
}

/** Entry for cache warmup */
export interface CacheWarmupEntry<T> {
  key: string;
  value: T;
  options?: CacheOptions;
}

/**
 * Core cache store interface that both L1 and L2 implement
 */
export interface ICacheStore<T = unknown> {
  /** Get a value by key */
  get(key: string): Promise<T | null>;

  /** Set a value with optional TTL */
  set(key: string, value: T, options?: SetOptions): Promise<void>;

  /** Delete a key */
  delete(key: string): Promise<boolean>;

  /** Check if key exists */
  has(key: string): Promise<boolean>;

  /** Clear all entries */
  clear(): Promise<void>;

  /** Get keys matching pattern (supports * wildcard) */
  keys(pattern?: string): Promise<string[]>;

  /** Get multiple values at once */
  mget(keys: string[]): Promise<Map<string, T | null>>;

  /** Set multiple values at once */
  mset(entries: Map<string, T>, options?: SetOptions): Promise<void>;
}

/** Eviction reasons for L1 cache */
export type EvictionReason = 'lru' | 'ttl' | 'manual' | 'overflow';

/** Event emitted when an entry is evicted */
export interface EvictionEvent<T> {
  key: string;
  value: T;
  reason: EvictionReason;
  timestamp: number;
}

/** Listener for eviction events */
export type EvictionListener<T> = (event: EvictionEvent<T>) => void;
