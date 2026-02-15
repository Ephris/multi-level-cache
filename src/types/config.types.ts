/**
 * Configuration types for the cache system
 */

import type { RedisOptions } from 'ioredis';

/** TTL configuration for a specific data type */
export interface TTLConfig {
  /** TTL in seconds for L1 cache */
  l1TTL: number;
  /** TTL in seconds for L2 cache */
  l2TTL: number;
  /** Optional grace period for stale-while-revalidate */
  staleWhileRevalidate?: number;
}

/** L1 (in-memory) cache configuration */
export interface L1Config {
  /** Maximum number of items in cache */
  maxSize: number;
  /** Optional maximum memory in MB */
  maxMemoryMB?: number;
  /** Default TTL in seconds */
  defaultTTL: number;
}

/** L2 (Redis) cache configuration */
export interface L2Config {
  /** Redis connection options */
  redis: RedisOptions;
  /** Prefix for all cache keys */
  keyPrefix: string;
  /** Default TTL in seconds */
  defaultTTL: number;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
}

/** Behavior when L2 (Redis) fails */
export type L2FailureStrategy = 'use-l1' | 'bypass' | 'throw';

/** Fallback configuration */
export interface FallbackConfig {
  /** What to do when L2 fails */
  onL2Failure: L2FailureStrategy;
  /** Number of retry attempts */
  retryAttempts?: number;
  /** Retry delay in milliseconds */
  retryDelayMs?: number;
}

/** Statistics configuration */
export interface StatsConfig {
  /** Enable statistics collection */
  enabled: boolean;
  /** Sample rate (0-1) for high-traffic scenarios */
  sampleRate?: number;
}

/** Complete cache configuration */
export interface CacheConfig {
  /** L1 cache configuration */
  l1: L1Config;
  /** L2 cache configuration (optional - L1-only mode if not provided) */
  l2?: L2Config;
  /** Per-type TTL configuration */
  ttlByType?: Map<string, TTLConfig>;
  /** Fallback behavior */
  fallback?: FallbackConfig;
  /** Statistics configuration */
  stats?: StatsConfig;
}

/** Default configuration values */
export const DEFAULT_CONFIG: Required<Omit<CacheConfig, 'l2' | 'ttlByType'>> & {
  ttlByType: Map<string, TTLConfig>;
} = {
  l1: {
    maxSize: 1000,
    defaultTTL: 300, // 5 minutes
  },
  ttlByType: new Map(),
  fallback: {
    onL2Failure: 'use-l1',
    retryAttempts: 3,
    retryDelayMs: 100,
  },
  stats: {
    enabled: true,
    sampleRate: 1.0,
  },
};
