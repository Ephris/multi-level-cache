/**
 * LRU Cache implementation with TTL support
 * Uses a doubly linked list + Map for O(1) get/set operations
 */

import type {
  ICacheStore,
  SetOptions,
  EvictionEvent,
  EvictionListener,
  EvictionReason,
} from '../types/index.js';

/** Node in the doubly linked list */
interface LRUNode<T> {
  key: string;
  value: T;
  expiresAt: number;
  prev: LRUNode<T> | null;
  next: LRUNode<T> | null;
}

/** Configuration for LRU cache */
export interface LRUCacheConfig {
  maxSize: number;
  defaultTTL: number;
  maxMemoryMB?: number;
}

/**
 * In-memory LRU cache with TTL support
 */
export class LRUCache<T = unknown> implements ICacheStore<T> {
  private readonly maxSize: number;
  private readonly defaultTTL: number;
  private readonly map: Map<string, LRUNode<T>> = new Map();
  private head: LRUNode<T> | null = null;
  private tail: LRUNode<T> | null = null;
  private readonly evictionListeners: Set<EvictionListener<T>> = new Set();

  // Stats tracking
  private _evictions = 0;

  constructor(config: LRUCacheConfig) {
    this.maxSize = config.maxSize;
    this.defaultTTL = config.defaultTTL;
  }

  /** Get eviction count */
  get evictions(): number {
    return this._evictions;
  }

  /** Get current size */
  get size(): number {
    return this.map.size;
  }

  /** Add an eviction listener */
  onEviction(listener: EvictionListener<T>): () => void {
    this.evictionListeners.add(listener);
    return () => this.evictionListeners.delete(listener);
  }

  /** Emit an eviction event */
  private emitEviction(key: string, value: T, reason: EvictionReason): void {
    this._evictions++;
    const event: EvictionEvent<T> = {
      key,
      value,
      reason,
      timestamp: Date.now(),
    };
    for (const listener of this.evictionListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /** Move a node to the head (most recently used) */
  private moveToHead(node: LRUNode<T>): void {
    if (node === this.head) return;

    // Remove from current position
    this.removeNode(node);

    // Add to head
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  /** Remove a node from the list */
  private removeNode(node: LRUNode<T>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  /** Add a new node to the head */
  private addToHead(node: LRUNode<T>): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  /** Remove and return the tail (least recently used) */
  private removeTail(): LRUNode<T> | null {
    const node = this.tail;
    if (!node) return null;

    if (node.prev) {
      node.prev.next = null;
      this.tail = node.prev;
    } else {
      this.head = null;
      this.tail = null;
    }

    return node;
  }

  /** Check if a node is expired */
  private isExpired(node: LRUNode<T>): boolean {
    return node.expiresAt <= Date.now();
  }

  /** Evict expired entries (lazy cleanup) */
  private evictExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, node] of this.map) {
      if (node.expiresAt <= now) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const node = this.map.get(key);
      if (node) {
        this.removeNode(node);
        this.map.delete(key);
        this.emitEviction(key, node.value, 'ttl');
      }
    }
  }

  async get(key: string): Promise<T | null> {
    const node = this.map.get(key);

    if (!node) {
      return null;
    }

    // Check if expired
    if (this.isExpired(node)) {
      this.removeNode(node);
      this.map.delete(key);
      this.emitEviction(key, node.value, 'ttl');
      return null;
    }

    // Move to head (most recently used)
    this.moveToHead(node);
    return node.value;
  }

  async set(key: string, value: T, options?: SetOptions): Promise<void> {
    const ttl = options?.ttl ?? this.defaultTTL;
    const expiresAt = Date.now() + ttl * 1000;

    const existingNode = this.map.get(key);

    if (existingNode) {
      // Update existing entry
      existingNode.value = value;
      existingNode.expiresAt = expiresAt;
      this.moveToHead(existingNode);
      return;
    }

    // Create new node
    const newNode: LRUNode<T> = {
      key,
      value,
      expiresAt,
      prev: null,
      next: null,
    };

    // Evict if at capacity
    while (this.map.size >= this.maxSize) {
      const evicted = this.removeTail();
      if (evicted) {
        this.map.delete(evicted.key);
        this.emitEviction(evicted.key, evicted.value, 'lru');
      }
    }

    this.map.set(key, newNode);
    this.addToHead(newNode);
  }

  async delete(key: string): Promise<boolean> {
    const node = this.map.get(key);

    if (!node) {
      return false;
    }

    this.removeNode(node);
    this.map.delete(key);
    this.emitEviction(key, node.value, 'manual');
    return true;
  }

  async has(key: string): Promise<boolean> {
    const node = this.map.get(key);

    if (!node) {
      return false;
    }

    if (this.isExpired(node)) {
      this.removeNode(node);
      this.map.delete(key);
      this.emitEviction(key, node.value, 'ttl');
      return false;
    }

    return true;
  }

  async clear(): Promise<void> {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  async keys(pattern?: string): Promise<string[]> {
    // Clean up expired entries first
    this.evictExpired();

    if (!pattern || pattern === '*') {
      return Array.from(this.map.keys());
    }

    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`);

    return Array.from(this.map.keys()).filter((key) => regex.test(key));
  }

  async mget(keys: string[]): Promise<Map<string, T | null>> {
    const result = new Map<string, T | null>();

    for (const key of keys) {
      result.set(key, await this.get(key));
    }

    return result;
  }

  async mset(entries: Map<string, T>, options?: SetOptions): Promise<void> {
    for (const [key, value] of entries) {
      await this.set(key, value, options);
    }
  }

  /** Get all entries (for debugging) */
  entries(): Array<{ key: string; value: T; expiresAt: number }> {
    this.evictExpired();
    return Array.from(this.map.values()).map((node) => ({
      key: node.key,
      value: node.value,
      expiresAt: node.expiresAt,
    }));
  }
}
