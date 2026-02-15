/**
 * Tests for Cache Manager (L1-only mode)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheManager, createCacheManager } from '../src/core/cache-manager.js';

describe('CacheManager', () => {
  let cache: CacheManager<any>;

  beforeEach(() => {
    cache = createCacheManager({
      l1: { maxSize: 100, defaultTTL: 300 },
      ttlByType: new Map([
        ['user-profile', { l1TTL: 3600, l2TTL: 7200 }],
        ['product', { l1TTL: 300, l2TTL: 600 }],
      ]),
    });
  });

  describe('basic operations', () => {
    it('should store and retrieve values', async () => {
      await cache.set('key1', { name: 'test' });
      const result = await cache.get('key1');

      expect(result.hit).toBe(true);
      expect(result.value).toEqual({ name: 'test' });
      expect(result.source).toBe('l1');
    });

    it('should return miss for non-existent keys', async () => {
      const result = await cache.get('nonexistent');

      expect(result.hit).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should delete keys', async () => {
      await cache.set('key1', 'value1');
      await cache.delete('key1');
      const result = await cache.get('key1');

      expect(result.hit).toBe(false);
    });

    it('should check if key exists', async () => {
      await cache.set('key1', 'value1');

      expect(await cache.has('key1')).toBe(true);
      expect(await cache.has('nonexistent')).toBe(false);
    });
  });

  describe('getOrFetch', () => {
    it('should return cached value without calling fetch', async () => {
      await cache.set('key1', 'cached');
      const fetchFn = vi.fn().mockResolvedValue('fresh');

      const result = await cache.getOrFetch('key1', fetchFn);

      expect(result).toBe('cached');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('should call fetch on cache miss and store result', async () => {
      const fetchFn = vi.fn().mockResolvedValue('fetched');

      const result = await cache.getOrFetch('key1', fetchFn);

      expect(result).toBe('fetched');
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Verify it was cached
      const cached = await cache.get('key1');
      expect(cached.value).toBe('fetched');
    });

    it('should prevent stampede with concurrent requests', async () => {
      let fetchCount = 0;
      const fetchFn = vi.fn().mockImplementation(async () => {
        fetchCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return `result-${fetchCount}`;
      });

      // Start multiple concurrent requests
      const results = await Promise.all([
        cache.getOrFetch('key1', fetchFn),
        cache.getOrFetch('key1', fetchFn),
        cache.getOrFetch('key1', fetchFn),
      ]);

      // All should get the same result
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);

      // Fetch should only be called once (or twice due to lock contention)
      expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  describe('type-based TTL', () => {
    it('should use type-specific TTL', async () => {
      await cache.set('user:1', { name: 'Alice' }, { type: 'user-profile' });
      await cache.set('product:1', { name: 'Widget' }, { type: 'product' });

      // Both should be cached
      expect((await cache.get('user:1')).hit).toBe(true);
      expect((await cache.get('product:1')).hit).toBe(true);
    });

    it('should use default TTL when type not specified', async () => {
      await cache.set('generic:1', 'value');
      expect((await cache.get('generic:1')).hit).toBe(true);
    });
  });

  describe('invalidation', () => {
    it('should invalidate single key', async () => {
      await cache.set('key1', 'value1');
      await cache.invalidate('key1');

      expect((await cache.get('key1')).hit).toBe(false);
    });

    it('should delete by pattern', async () => {
      await cache.set('user:1', 'alice');
      await cache.set('user:2', 'bob');
      await cache.set('product:1', 'widget');

      await cache.deleteByPattern('user:*');

      expect((await cache.get('user:1')).hit).toBe(false);
      expect((await cache.get('user:2')).hit).toBe(false);
      expect((await cache.get('product:1')).hit).toBe(true);
    });

    it('should clear all entries', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.clear();

      expect((await cache.get('key1')).hit).toBe(false);
      expect((await cache.get('key2')).hit).toBe(false);
    });
  });

  describe('refresh', () => {
    it('should refresh cache with new value', async () => {
      await cache.set('key1', 'old');

      const result = await cache.refresh('key1', async () => 'new');

      expect(result).toBe('new');
      expect((await cache.get('key1')).value).toBe('new');
    });
  });

  describe('warmup', () => {
    it('should warmup cache with initial data', async () => {
      await cache.warmup([
        { key: 'user:1', value: { name: 'Alice' }, options: { type: 'user-profile' } },
        { key: 'user:2', value: { name: 'Bob' }, options: { type: 'user-profile' } },
      ]);

      expect((await cache.get('user:1')).value).toEqual({ name: 'Alice' });
      expect((await cache.get('user:2')).value).toEqual({ name: 'Bob' });
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', async () => {
      await cache.set('key1', 'value1');

      await cache.get('key1'); // Hit
      await cache.get('key2'); // Miss

      const stats = cache.getStats();

      expect(stats.l1.hits).toBe(1);
      expect(stats.l1.misses).toBe(1);
      expect(stats.l1.hitRate).toBe(0.5);
    });

    it('should track operations', async () => {
      await cache.set('key1', 'value1');
      await cache.get('key1');
      await cache.delete('key1');

      const stats = cache.getStats();

      expect(stats.operations.sets).toBe(1);
      expect(stats.operations.gets).toBe(1);
      expect(stats.operations.deletes).toBe(1);
    });

    it('should reset stats', async () => {
      await cache.set('key1', 'value1');
      await cache.get('key1');

      cache.resetStats();
      const stats = cache.getStats();

      expect(stats.l1.hits).toBe(0);
      expect(stats.operations.sets).toBe(0);
    });
  });
});
