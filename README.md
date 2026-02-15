# multi-level-cache

A high-performance, database-agnostic, two-tier caching library for Node.js and TypeScript.

```
  Request
    |
    v
┌────────┐  hit   ┌───────────┐  hit   ┌──────────────┐
│   L1   │───────> │  Return   │        │              │
│ Memory │        └───────────┘        │   Database   │
│  (LRU) │                              │   (Origin)   │
│  <1ms  │  miss                        │              │
└───┬────┘                              └──────┬───────┘
    |                                          ^
    v                                          |
┌────────┐  hit   ┌───────────┐          miss  |
│   L2   │───────> │ Return +  │    ┌──────────┘
│ Redis  │        │ Fill L1   │    |
│  ~5ms  │        └───────────┘    |
│        │  miss                    |
└───┬────┘─────────────────────────┘
         Fetch, fill L1 + L2
```

## Features

- **Two-tier caching** -- L1 in-memory LRU for sub-millisecond reads, L2 Redis for cross-server sharing
- **Per-type TTL** -- user profiles for 1 hour, product listings for 5 minutes, fully configurable
- **Automatic cache population** -- `getOrFetch()` handles miss-fetch-store in one call
- **Stampede protection** -- distributed locking prevents thundering herd on cache miss
- **Smart invalidation** -- by key, by pattern (`product:*`), by type, or cross-server via Redis Pub/Sub
- **Built-in stats** -- hit/miss rates, latency percentiles (p50/p95/p99), per-type breakdowns
- **Graceful degradation** -- continues on L1-only if Redis goes down
- **TypeScript decorators** -- `@Cacheable`, `@CacheInvalidate`, `@CachePut`
- **Zero required dependencies for L1-only mode** -- Redis is optional

## Install

```bash
npm install multi-level-cache
```

## Quick Start

### L1 Only (no Redis needed)

```typescript
import { createCacheManager } from 'multi-level-cache';

const cache = createCacheManager({
  l1: { maxSize: 1000, defaultTTL: 300 },
});

// Fetch-through: returns cached value or calls your function
const user = await cache.getOrFetch(
  `user:${id}`,
  () => db.users.findById(id),
  { type: 'user-profile' }
);
```

### L1 + L2 (with Redis)

```typescript
import { createCacheManager } from 'multi-level-cache';

const cache = createCacheManager({
  l1: { maxSize: 1000, defaultTTL: 300 },
  l2: {
    redis: { host: 'localhost', port: 6379 },
    keyPrefix: 'myapp',
    defaultTTL: 3600,
  },
  ttlByType: new Map([
    ['user-profile', { l1TTL: 300, l2TTL: 3600 }],   // 5min local, 1hr shared
    ['product',      { l1TTL: 60,  l2TTL: 300 }],     // 1min local, 5min shared
    ['session',      { l1TTL: 30,  l2TTL: 1800 }],    // 30s local, 30min shared
  ]),
});

await cache.connect(); // connects to Redis
```

## Usage

### Fetch-through caching

The most common pattern. Cache handles the lookup, miss, fetch, and storage automatically:

```typescript
// First call: fetches from DB, stores in L1 + L2
const product = await cache.getOrFetch(
  `product:${sku}`,
  () => db.products.findBySku(sku),
  { type: 'product' }
);

// Second call: returns from L1 in <1ms, DB never touched
const same = await cache.getOrFetch(
  `product:${sku}`,
  () => db.products.findBySku(sku),
  { type: 'product' }
);
```

### Manual get/set

```typescript
await cache.set('config:feature-flags', flags, { ttl: 60 });

const result = await cache.get('config:feature-flags');
if (result.hit) {
  console.log(result.value);   // your data
  console.log(result.source);  // 'l1' or 'l2'
}
```

### Invalidation

```typescript
// Invalidate a single key
await cache.invalidate(`product:${sku}`);

// Invalidate with cross-server broadcast (clears L1 on all nodes)
await cache.invalidate(`product:${sku}`, { broadcast: true });

// Invalidate by pattern
await cache.deleteByPattern('product:*');

// Invalidate all entries of a type
await cache.deleteByType('user-profile');

// Refresh: invalidate + fetch + store in one call
const fresh = await cache.refresh(
  `product:${sku}`,
  () => db.products.findBySku(sku),
  { type: 'product' }
);
```

### Statistics

```typescript
const stats = cache.getStats();

console.log(stats.l1.hitRate);          // 0.96
console.log(stats.l1.hits);             // 24891
console.log(stats.l1.misses);           // 1032
console.log(stats.l2?.hitRate);         // 0.89
console.log(stats.combined.hitRate);    // 0.99
console.log(stats.combined.throughput); // 1250 ops/sec

console.log(stats.latency.p50);        // 0.2ms
console.log(stats.latency.p95);        // 1.8ms
console.log(stats.latency.p99);        // 4.1ms

console.log(stats.stampedesPrevented); // 47

// Per-type breakdown
for (const [type, typeStats] of stats.byType) {
  console.log(`${type}: ${typeStats.layer.hitRate} hit rate`);
}

// Reset counters
cache.resetStats();
```

### TypeScript Decorators

```typescript
import { Cacheable, CacheInvalidate, CachePut } from 'multi-level-cache';

class UserService {
  @Cacheable({ type: 'user-profile', cacheManager: cache })
  async getUser(id: string): Promise<User> {
    return db.users.findById(id);  // only called on cache miss
  }

  @CacheInvalidate({ type: 'user-profile', keyArg: 0, cacheManager: cache })
  async deleteUser(id: string): Promise<void> {
    await db.users.delete(id);     // cache cleared after success
  }

  @CachePut({ type: 'user-profile', keyArg: 0, cacheManager: cache })
  async updateUser(id: string, data: Partial<User>): Promise<User> {
    return db.users.update(id, data); // cache updated with return value
  }
}
```

### Wrapper Function (alternative to decorators)

```typescript
import { withCache } from 'multi-level-cache';

const user = await withCache(
  cache,
  `user:${id}`,
  () => db.users.findById(id),
  { type: 'user-profile' }
);
```

### Cache Warmup

Pre-populate the cache on startup:

```typescript
await cache.warmup([
  { key: 'config:flags', value: featureFlags, options: { ttl: 300 } },
  { key: 'config:limits', value: rateLimits, options: { ttl: 300 } },
]);
```

## Configuration Reference

```typescript
interface CacheConfig {
  l1: {
    maxSize: number;        // Max items in memory (default: 1000)
    defaultTTL: number;     // Default TTL in seconds (default: 300)
    maxMemoryMB?: number;   // Optional memory limit
  };

  l2?: {                    // Omit for L1-only mode
    redis: RedisOptions;    // ioredis connection options
    keyPrefix: string;      // Namespace for keys (e.g., 'myapp')
    defaultTTL: number;     // Default TTL in seconds
  };

  ttlByType?: Map<string, {
    l1TTL: number;          // L1 TTL in seconds
    l2TTL: number;          // L2 TTL in seconds
  }>;

  fallback?: {
    onL2Failure:            // What to do when Redis is down:
      | 'use-l1'           //   Keep serving from memory (default)
      | 'bypass'           //   Skip cache, go to origin
      | 'throw';           //   Throw an error
  };

  stats?: {
    enabled: boolean;       // Enable statistics (default: true)
    sampleRate?: number;    // 0-1, for high-traffic (default: 1.0)
  };
}
```

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      CacheManager                        │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   ┌──────────┐       ┌──────────┐       ┌──────────┐   │
│   │  L1 LRU  │ <---> │ L2 Redis │ <---> │  Origin  │   │
│   │  <1ms    │       │  ~5ms    │       │  ~50ms+  │   │
│   └──────────┘       └──────────┘       └──────────┘   │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  Stampede       Invalidation       Stats                 │
│  Protection     (Pub/Sub)          Collector             │
│  (Dist. Lock)   (Pattern/Type)     (p50/p95/p99)        │
└──────────────────────────────────────────────────────────┘
```

**Read path:** L1 -> L2 -> Origin (with automatic backfill)

**Write path:** L2 first (source of truth) -> L1

**Invalidation:** Local delete + optional Redis Pub/Sub broadcast to all nodes

**Stampede protection:** Distributed lock ensures only one fetch per key under concurrent load

## Project Structure

```
src/
├── index.ts                      # Public API
├── types/                        # TypeScript interfaces
├── core/
│   ├── cache-manager.ts          # Main orchestrator
│   ├── cache-key.ts              # Key generation
│   └── serializer.ts             # JSON + Date/BigInt/Map/Set
├── l1/
│   └── lru-cache.ts              # In-memory LRU with TTL
├── l2/
│   ├── redis-cache.ts            # Redis adapter (ioredis)
│   └── redis-connection.ts       # Connection + reconnect
├── strategies/
│   ├── invalidation.ts           # Key/pattern/type/pubsub
│   └── stampede-protection.ts    # Distributed + in-memory locks
├── stats/
│   └── collector.ts              # Metrics + percentiles
└── decorators/
    ├── cacheable.ts              # @Cacheable
    ├── cache-invalidate.ts       # @CacheInvalidate
    └── cache-put.ts              # @CachePut
```

## Development

```bash
npm install          # Install dependencies
npm test             # Run tests (59 tests)
npm run build        # Compile TypeScript
npm run lint         # Type check
```

## License

MIT
