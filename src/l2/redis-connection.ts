/**
 * Redis connection management with automatic reconnection
 */

import Redis, { type RedisOptions } from 'ioredis';

/** Connection states */
export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

/** Connection state change listener */
export type ConnectionStateListener = (state: ConnectionState) => void;

/**
 * Manages Redis connection with resilience features
 */
export class RedisConnection {
  private client: Redis | null = null;
  private _state: ConnectionState = 'disconnected';
  private readonly stateListeners: Set<ConnectionStateListener> = new Set();
  private readonly options: RedisOptions;

  constructor(options: RedisOptions) {
    this.options = {
      ...options,
      retryStrategy: (times: number) => {
        if (times > 10) {
          return null; // Stop retrying
        }
        return Math.min(times * 100, 3000);
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    };
  }

  /** Get current connection state */
  get state(): ConnectionState {
    return this._state;
  }

  /** Get the Redis client (throws if not connected) */
  getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client not initialized. Call connect() first.');
    }
    return this.client;
  }

  /** Check if connected */
  isConnected(): boolean {
    return this._state === 'connected';
  }

  /** Add state change listener */
  onStateChange(listener: ConnectionStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Update and broadcast state */
  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /** Connect to Redis */
  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    this.client = new Redis(this.options);

    this.client.on('connect', () => {
      this.setState('connected');
    });

    this.client.on('ready', () => {
      this.setState('connected');
    });

    this.client.on('reconnecting', () => {
      this.setState('reconnecting');
    });

    this.client.on('error', () => {
      // Error logged but don't change state here
    });

    this.client.on('close', () => {
      this.setState('disconnected');
    });

    this.client.on('end', () => {
      this.setState('disconnected');
    });

    await this.client.connect();
  }

  /** Disconnect from Redis */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.setState('disconnected');
    }
  }

  /** Health check */
  async ping(): Promise<boolean> {
    if (!this.client || this._state !== 'connected') {
      return false;
    }
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
