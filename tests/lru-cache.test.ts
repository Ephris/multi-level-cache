/**
 * Tests for LRU Cache
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LRUCache } from '../src/l1/lru-cache.js';

describe('LRUCache', () => {
  let cache: LRUCache<string>;

  beforeEach(() => {
    cache = new LRUCache({ maxSize: 3, defaultTTL: 60 });
  });

  describe('basic operations', () => {
    it('should store and retrieve values', async () => {
      await cache.set('key1', 'value1');
      const result = await cache.get('key1');
      expect(result).toBe('value1');
    });

    it('should return null for non-existent keys', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should update existing keys', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key1', 'updated');
      const result = await cache.get('key1');
      expect(result).toBe('updated');
    });

    it('should delete keys', async () => {
      await cache.set('key1', 'value1');
      const deleted = await cache.delete('key1');
      expect(deleted).toBe(true);
      const result = await cache.get('key1');
      expect(result).toBeNull();
    });

    it('should check if key exists', async () => {
      await cache.set('key1', 'value1');
      expect(await cache.has('key1')).toBe(true);
      expect(await cache.has('nonexistent')).toBe(false);
    });

    it('should clear all entries', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used when at capacity', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      // Cache is now at capacity (3)
      // Adding key4 should evict key1 (least recently used)
      await cache.set('key4', 'value4');

      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).toBe('value2');
      expect(await cache.get('key3')).toBe('value3');
      expect(await cache.get('key4')).toBe('value4');
    });

    it('should update LRU order on get', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      // Access key1, making it most recently used
      await cache.get('key1');

      // Adding key4 should evict key2 (now least recently used)
      await cache.set('key4', 'value4');

      expect(await cache.get('key1')).toBe('value1');
      expect(await cache.get('key2')).toBeNull();
      expect(await cache.get('key3')).toBe('value3');
      expect(await cache.get('key4')).toBe('value4');
    });

    it('should emit eviction events', async () => {
      const evictionHandler = vi.fn();
      cache.onEviction(evictionHandler);

      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');
      await cache.set('key4', 'value4'); // Triggers eviction

      expect(evictionHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'key1',
          value: 'value1',
          reason: 'lru',
        })
      );
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      vi.useFakeTimers();

      const shortCache = new LRUCache<string>({ maxSize: 10, defaultTTL: 1 });
      await shortCache.set('key1', 'value1');

      expect(await shortCache.get('key1')).toBe('value1');

      // Advance time past TTL
      vi.advanceTimersByTime(1500);

      expect(await shortCache.get('key1')).toBeNull();

      vi.useRealTimers();
    });

    it('should allow custom TTL per entry', async () => {
      vi.useFakeTimers();

      await cache.set('short', 'value', { ttl: 1 });
      await cache.set('long', 'value', { ttl: 10 });

      vi.advanceTimersByTime(2000);

      expect(await cache.get('short')).toBeNull();
      expect(await cache.get('long')).toBe('value');

      vi.useRealTimers();
    });
  });

  describe('pattern matching', () => {
    it('should find keys matching pattern', async () => {
      await cache.set('user:1', 'alice');
      await cache.set('user:2', 'bob');
      await cache.set('product:1', 'widget');

      const userKeys = await cache.keys('user:*');
      expect(userKeys).toHaveLength(2);
      expect(userKeys).toContain('user:1');
      expect(userKeys).toContain('user:2');
    });

    it('should return all keys when no pattern', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      const allKeys = await cache.keys();
      expect(allKeys).toHaveLength(2);
    });
  });

  describe('bulk operations', () => {
    it('should get multiple values', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      const results = await cache.mget(['key1', 'key2', 'key3']);
      expect(results.get('key1')).toBe('value1');
      expect(results.get('key2')).toBe('value2');
      expect(results.get('key3')).toBeNull();
    });

    it('should set multiple values', async () => {
      const entries = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ]);
      await cache.mset(entries);

      expect(await cache.get('key1')).toBe('value1');
      expect(await cache.get('key2')).toBe('value2');
    });
  });
});
