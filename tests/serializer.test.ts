/**
 * Tests for serialization utilities
 */

import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from '../src/core/serializer.js';

describe('Serializer', () => {
  describe('basic types', () => {
    it('should serialize/deserialize strings', () => {
      const original = 'hello world';
      const serialized = serialize(original);
      const deserialized = deserialize<string>(serialized);
      expect(deserialized).toBe(original);
    });

    it('should serialize/deserialize numbers', () => {
      const original = 42.5;
      const serialized = serialize(original);
      const deserialized = deserialize<number>(serialized);
      expect(deserialized).toBe(original);
    });

    it('should serialize/deserialize booleans', () => {
      expect(deserialize<boolean>(serialize(true))).toBe(true);
      expect(deserialize<boolean>(serialize(false))).toBe(false);
    });

    it('should serialize/deserialize null', () => {
      const serialized = serialize(null);
      const deserialized = deserialize(serialized);
      expect(deserialized).toBeNull();
    });

    it('should serialize/deserialize arrays', () => {
      const original = [1, 2, 3, 'four'];
      const serialized = serialize(original);
      const deserialized = deserialize<typeof original>(serialized);
      expect(deserialized).toEqual(original);
    });

    it('should serialize/deserialize objects', () => {
      const original = { name: 'test', count: 42, nested: { value: true } };
      const serialized = serialize(original);
      const deserialized = deserialize<typeof original>(serialized);
      expect(deserialized).toEqual(original);
    });
  });

  describe('special types', () => {
    it('should preserve Date objects', () => {
      const original = new Date('2024-01-15T12:00:00Z');
      const serialized = serialize(original);
      const deserialized = deserialize<Date>(serialized);

      expect(deserialized).toBeInstanceOf(Date);
      expect(deserialized.getTime()).toBe(original.getTime());
    });

    it('should preserve BigInt values', () => {
      const original = BigInt('9007199254740993');
      const serialized = serialize(original);
      const deserialized = deserialize<bigint>(serialized);

      expect(typeof deserialized).toBe('bigint');
      expect(deserialized).toBe(original);
    });

    it('should preserve Map objects', () => {
      const original = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ]);
      const serialized = serialize(original);
      const deserialized = deserialize<Map<string, string>>(serialized);

      expect(deserialized).toBeInstanceOf(Map);
      expect(deserialized.get('key1')).toBe('value1');
      expect(deserialized.get('key2')).toBe('value2');
    });

    it('should preserve Set objects', () => {
      const original = new Set([1, 2, 3]);
      const serialized = serialize(original);
      const deserialized = deserialize<Set<number>>(serialized);

      expect(deserialized).toBeInstanceOf(Set);
      expect(deserialized.has(1)).toBe(true);
      expect(deserialized.has(2)).toBe(true);
      expect(deserialized.has(3)).toBe(true);
    });

    it('should preserve undefined in objects', () => {
      const original = { defined: 'value', notDefined: undefined };
      const serialized = serialize(original);
      const deserialized = deserialize<typeof original>(serialized);

      expect(deserialized.defined).toBe('value');
      expect(deserialized.notDefined).toBeUndefined();
    });
  });

  describe('complex nested structures', () => {
    it('should handle nested special types', () => {
      const original = {
        user: {
          name: 'Alice',
          createdAt: new Date('2024-01-01'),
          balance: BigInt('1000000000000'),
        },
        metadata: new Map([['version', '1.0']]),
        tags: new Set(['admin', 'active']),
      };

      const serialized = serialize(original);
      const deserialized = deserialize<typeof original>(serialized);

      expect(deserialized.user.name).toBe('Alice');
      expect(deserialized.user.createdAt).toBeInstanceOf(Date);
      expect(deserialized.user.balance).toBe(BigInt('1000000000000'));
      expect(deserialized.metadata).toBeInstanceOf(Map);
      expect(deserialized.tags).toBeInstanceOf(Set);
    });

    it('should handle arrays with special types', () => {
      const original = [
        new Date('2024-01-01'),
        new Date('2024-01-02'),
        BigInt(123),
      ];

      const serialized = serialize(original);
      const deserialized = deserialize<typeof original>(serialized);

      expect(deserialized[0]).toBeInstanceOf(Date);
      expect(deserialized[1]).toBeInstanceOf(Date);
      expect(typeof deserialized[2]).toBe('bigint');
    });
  });
});
