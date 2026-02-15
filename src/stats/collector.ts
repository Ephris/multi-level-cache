/**
 * Statistics collector for cache monitoring
 */

import type {
  CacheStats,
  LayerStats,
  StatsTracker,
  LatencyStats,
  TypeStats,
} from '../types/index.js';

/** Stats collector configuration */
export interface StatsCollectorConfig {
  enabled: boolean;
  sampleRate: number;
  maxLatencySamples: number;
}

const DEFAULT_CONFIG: StatsCollectorConfig = {
  enabled: true,
  sampleRate: 1.0,
  maxLatencySamples: 1000,
};

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, index)];
}

/**
 * Calculate average of array
 */
function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Statistics collector for cache metrics
 */
export class StatsCollector {
  private readonly config: StatsCollectorConfig;
  private readonly tracker: StatsTracker;

  constructor(config?: Partial<StatsCollectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tracker = this.createTracker();
  }

  /** Create a fresh stats tracker */
  private createTracker(): StatsTracker {
    return {
      startTime: Date.now(),
      l1Hits: 0,
      l1Misses: 0,
      l1Evictions: 0,
      l2Hits: 0,
      l2Misses: 0,
      l2Evictions: 0,
      gets: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      stampedesPrevented: 0,
      latencies: [],
      l1Latencies: [],
      l2Latencies: [],
      byType: new Map(),
    };
  }

  /** Check if we should sample this request */
  private shouldSample(): boolean {
    if (!this.config.enabled) return false;
    if (this.config.sampleRate >= 1.0) return true;
    return Math.random() < this.config.sampleRate;
  }

  /** Add latency sample */
  private addLatency(arr: number[], latency: number): void {
    arr.push(latency);
    if (arr.length > this.config.maxLatencySamples) {
      arr.shift();
    }
  }

  /** Record an L1 hit */
  recordL1Hit(latencyMs: number, type?: string): void {
    if (!this.shouldSample()) return;

    this.tracker.l1Hits++;
    this.addLatency(this.tracker.l1Latencies, latencyMs);
    this.addLatency(this.tracker.latencies, latencyMs);

    if (type) {
      this.recordTypeHit(type, latencyMs);
    }
  }

  /** Record an L1 miss */
  recordL1Miss(): void {
    if (!this.shouldSample()) return;
    this.tracker.l1Misses++;
  }

  /** Record an L2 hit */
  recordL2Hit(latencyMs: number, type?: string): void {
    if (!this.shouldSample()) return;

    this.tracker.l2Hits++;
    this.addLatency(this.tracker.l2Latencies, latencyMs);
    this.addLatency(this.tracker.latencies, latencyMs);

    if (type) {
      this.recordTypeHit(type, latencyMs);
    }
  }

  /** Record an L2 miss */
  recordL2Miss(type?: string): void {
    if (!this.shouldSample()) return;
    this.tracker.l2Misses++;

    if (type) {
      this.recordTypeMiss(type);
    }
  }

  /** Record a type hit */
  private recordTypeHit(type: string, latencyMs: number): void {
    let typeStats = this.tracker.byType.get(type);
    if (!typeStats) {
      typeStats = { hits: 0, misses: 0, latencies: [] };
      this.tracker.byType.set(type, typeStats);
    }
    typeStats.hits++;
    this.addLatency(typeStats.latencies, latencyMs);
  }

  /** Record a type miss */
  private recordTypeMiss(type: string): void {
    let typeStats = this.tracker.byType.get(type);
    if (!typeStats) {
      typeStats = { hits: 0, misses: 0, latencies: [] };
      this.tracker.byType.set(type, typeStats);
    }
    typeStats.misses++;
  }

  /** Record L1 eviction */
  recordL1Eviction(): void {
    if (!this.shouldSample()) return;
    this.tracker.l1Evictions++;
  }

  /** Record L2 eviction */
  recordL2Eviction(): void {
    if (!this.shouldSample()) return;
    this.tracker.l2Evictions++;
  }

  /** Record a get operation */
  recordGet(): void {
    if (!this.shouldSample()) return;
    this.tracker.gets++;
  }

  /** Record a set operation */
  recordSet(): void {
    if (!this.shouldSample()) return;
    this.tracker.sets++;
  }

  /** Record a delete operation */
  recordDelete(): void {
    if (!this.shouldSample()) return;
    this.tracker.deletes++;
  }

  /** Record an error */
  recordError(): void {
    if (!this.shouldSample()) return;
    this.tracker.errors++;
  }

  /** Record a stampede prevented */
  recordStampedePrevented(): void {
    if (!this.shouldSample()) return;
    this.tracker.stampedesPrevented++;
  }

  /** Calculate hit rate */
  private calculateHitRate(hits: number, misses: number): number {
    const total = hits + misses;
    return total === 0 ? 0 : hits / total;
  }

  /** Build layer stats */
  private buildLayerStats(
    hits: number,
    misses: number,
    evictions: number,
    size: number
  ): LayerStats {
    return {
      hits,
      misses,
      evictions,
      size,
      hitRate: this.calculateHitRate(hits, misses),
    };
  }

  /** Build latency stats */
  private buildLatencyStats(): LatencyStats {
    const sorted = [...this.tracker.latencies].sort((a, b) => a - b);
    const l1Sorted = [...this.tracker.l1Latencies].sort((a, b) => a - b);
    const l2Sorted = [...this.tracker.l2Latencies].sort((a, b) => a - b);

    return {
      l1Avg: average(l1Sorted),
      l2Avg: average(l2Sorted),
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    };
  }

  /** Get current stats */
  getStats(l1Size: number, l2Size: number | null): CacheStats {
    const now = Date.now();
    const uptimeSeconds = (now - this.tracker.startTime) / 1000;

    const l1Stats = this.buildLayerStats(
      this.tracker.l1Hits,
      this.tracker.l1Misses,
      this.tracker.l1Evictions,
      l1Size
    );

    const l2Stats =
      l2Size !== null
        ? this.buildLayerStats(
            this.tracker.l2Hits,
            this.tracker.l2Misses,
            this.tracker.l2Evictions,
            l2Size
          )
        : null;

    const totalHits = this.tracker.l1Hits + this.tracker.l2Hits;
    const totalMisses = this.tracker.l2Misses; // Only count final misses

    const totalOps =
      this.tracker.gets + this.tracker.sets + this.tracker.deletes;
    const throughput = uptimeSeconds > 0 ? totalOps / uptimeSeconds : 0;

    const byType = new Map<string, TypeStats>();
    for (const [type, stats] of this.tracker.byType) {
      byType.set(type, {
        type,
        layer: this.buildLayerStats(stats.hits, stats.misses, 0, 0),
        avgLatency: average(stats.latencies),
      });
    }

    return {
      timestamp: now,
      uptime: uptimeSeconds,
      l1: l1Stats,
      l2: l2Stats,
      combined: {
        hitRate: this.calculateHitRate(totalHits, totalMisses),
        avgLatency: average(this.tracker.latencies),
        throughput,
      },
      operations: {
        gets: this.tracker.gets,
        sets: this.tracker.sets,
        deletes: this.tracker.deletes,
        errors: this.tracker.errors,
      },
      latency: this.buildLatencyStats(),
      byType,
      stampedesPrevented: this.tracker.stampedesPrevented,
    };
  }

  /** Reset all stats */
  reset(): void {
    Object.assign(this.tracker, this.createTracker());
  }
}
