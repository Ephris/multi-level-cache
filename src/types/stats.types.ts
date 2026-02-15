/**
 * Statistics types for cache monitoring
 */

/** Statistics for a single cache layer */
export interface LayerStats {
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Number of evictions */
  evictions: number;
  /** Current number of items */
  size: number;
  /** Hit rate (hits / (hits + misses)) */
  hitRate: number;
}

/** Operation counts */
export interface OperationStats {
  /** Total get operations */
  gets: number;
  /** Total set operations */
  sets: number;
  /** Total delete operations */
  deletes: number;
  /** Total errors */
  errors: number;
}

/** Latency statistics in milliseconds */
export interface LatencyStats {
  /** Average L1 latency */
  l1Avg: number;
  /** Average L2 latency */
  l2Avg: number;
  /** 50th percentile latency */
  p50: number;
  /** 95th percentile latency */
  p95: number;
  /** 99th percentile latency */
  p99: number;
}

/** Per-type statistics */
export interface TypeStats {
  /** Data type name */
  type: string;
  /** Layer stats for this type */
  layer: LayerStats;
  /** Average latency for this type */
  avgLatency: number;
}

/** Complete cache statistics */
export interface CacheStats {
  /** Timestamp of stats snapshot */
  timestamp: number;
  /** Uptime in seconds */
  uptime: number;
  /** L1 layer stats */
  l1: LayerStats;
  /** L2 layer stats (null if L2 not configured) */
  l2: LayerStats | null;
  /** Combined stats */
  combined: {
    /** Overall hit rate */
    hitRate: number;
    /** Combined average latency */
    avgLatency: number;
    /** Operations per second */
    throughput: number;
  };
  /** Operation counts */
  operations: OperationStats;
  /** Latency stats */
  latency: LatencyStats;
  /** Stats by data type */
  byType: Map<string, TypeStats>;
  /** Number of stampedes prevented */
  stampedesPrevented: number;
}

/** Internal stats tracking (mutable) */
export interface StatsTracker {
  startTime: number;
  l1Hits: number;
  l1Misses: number;
  l1Evictions: number;
  l2Hits: number;
  l2Misses: number;
  l2Evictions: number;
  gets: number;
  sets: number;
  deletes: number;
  errors: number;
  stampedesPrevented: number;
  latencies: number[];
  l1Latencies: number[];
  l2Latencies: number[];
  byType: Map<string, {
    hits: number;
    misses: number;
    latencies: number[];
  }>;
}
