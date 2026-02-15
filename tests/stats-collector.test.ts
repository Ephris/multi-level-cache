/**
 * Tests for statistics collector
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatsCollector } from '../src/stats/collector.js';

describe('StatsCollector', () => {
  let collector: StatsCollector;

  beforeEach(() => {
    collector = new StatsCollector({ enabled: true, sampleRate: 1.0, maxLatencySamples: 100 });
  });

  describe('hit/miss tracking', () => {
    it('should track L1 hits and misses', () => {
      collector.recordL1Hit(1);
      collector.recordL1Hit(2);
      collector.recordL1Miss();

      const stats = collector.getStats(10, null);

      expect(stats.l1.hits).toBe(2);
      expect(stats.l1.misses).toBe(1);
      expect(stats.l1.hitRate).toBeCloseTo(0.667, 2);
    });

    it('should track L2 hits and misses', () => {
      collector.recordL2Hit(5);
      collector.recordL2Miss();
      collector.recordL2Miss();

      const stats = collector.getStats(10, 20);

      expect(stats.l2?.hits).toBe(1);
      expect(stats.l2?.misses).toBe(2);
      expect(stats.l2?.hitRate).toBeCloseTo(0.333, 2);
    });

    it('should return null for L2 stats when not configured', () => {
      const stats = collector.getStats(10, null);
      expect(stats.l2).toBeNull();
    });
  });

  describe('operation tracking', () => {
    it('should track get/set/delete operations', () => {
      collector.recordGet();
      collector.recordGet();
      collector.recordSet();
      collector.recordDelete();

      const stats = collector.getStats(0, null);

      expect(stats.operations.gets).toBe(2);
      expect(stats.operations.sets).toBe(1);
      expect(stats.operations.deletes).toBe(1);
    });

    it('should track errors', () => {
      collector.recordError();
      collector.recordError();

      const stats = collector.getStats(0, null);
      expect(stats.operations.errors).toBe(2);
    });

    it('should track stampedes prevented', () => {
      collector.recordStampedePrevented();
      collector.recordStampedePrevented();

      const stats = collector.getStats(0, null);
      expect(stats.stampedesPrevented).toBe(2);
    });
  });

  describe('latency tracking', () => {
    it('should calculate average latency', () => {
      collector.recordL1Hit(10);
      collector.recordL1Hit(20);
      collector.recordL1Hit(30);

      const stats = collector.getStats(0, null);
      expect(stats.latency.l1Avg).toBe(20);
    });

    it('should calculate percentiles', () => {
      // Add 100 samples from 1ms to 100ms
      for (let i = 1; i <= 100; i++) {
        collector.recordL1Hit(i);
      }

      const stats = collector.getStats(0, null);

      expect(stats.latency.p50).toBe(50);
      expect(stats.latency.p95).toBe(95);
      expect(stats.latency.p99).toBe(99);
    });
  });

  describe('type-based stats', () => {
    it('should track stats per type', () => {
      collector.recordL1Hit(1, 'user');
      collector.recordL1Hit(2, 'user');
      collector.recordL1Hit(3, 'product');
      collector.recordL2Miss('user');

      const stats = collector.getStats(0, null);

      expect(stats.byType.get('user')?.layer.hits).toBe(2);
      expect(stats.byType.get('user')?.layer.misses).toBe(1);
      expect(stats.byType.get('product')?.layer.hits).toBe(1);
    });
  });

  describe('sampling', () => {
    it('should respect sample rate', () => {
      const lowSampleCollector = new StatsCollector({
        enabled: true,
        sampleRate: 0,
        maxLatencySamples: 100,
      });

      // With 0 sample rate, nothing should be recorded
      for (let i = 0; i < 100; i++) {
        lowSampleCollector.recordL1Hit(1);
      }

      const stats = lowSampleCollector.getStats(0, null);
      expect(stats.l1.hits).toBe(0);
    });

    it('should not record when disabled', () => {
      const disabledCollector = new StatsCollector({
        enabled: false,
        sampleRate: 1.0,
        maxLatencySamples: 100,
      });

      disabledCollector.recordL1Hit(1);
      disabledCollector.recordGet();

      const stats = disabledCollector.getStats(0, null);
      expect(stats.l1.hits).toBe(0);
      expect(stats.operations.gets).toBe(0);
    });
  });

  describe('combined stats', () => {
    it('should calculate combined hit rate', () => {
      // L1: 2 hits, 2 misses
      collector.recordL1Hit(1);
      collector.recordL1Hit(1);
      collector.recordL1Miss();
      collector.recordL1Miss();

      // L2: 1 hit, 1 miss (the final miss counts)
      collector.recordL2Hit(1);
      collector.recordL2Miss();

      const stats = collector.getStats(0, 0);

      // Total hits: 3, total misses (final): 1
      expect(stats.combined.hitRate).toBe(0.75);
    });

    it('should calculate throughput', () => {
      vi.useFakeTimers();

      const newCollector = new StatsCollector();

      newCollector.recordGet();
      newCollector.recordSet();
      newCollector.recordDelete();

      // Advance time by 1 second
      vi.advanceTimersByTime(1000);

      const stats = newCollector.getStats(0, null);

      // 3 operations in ~1 second
      expect(stats.combined.throughput).toBeGreaterThan(0);

      vi.useRealTimers();
    });
  });

  describe('reset', () => {
    it('should reset all stats', () => {
      collector.recordL1Hit(1);
      collector.recordGet();
      collector.recordError();

      collector.reset();

      const stats = collector.getStats(0, null);

      expect(stats.l1.hits).toBe(0);
      expect(stats.operations.gets).toBe(0);
      expect(stats.operations.errors).toBe(0);
    });
  });
});
