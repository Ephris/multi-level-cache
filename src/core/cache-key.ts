/**
 * Cache key generation utilities
 */

/** Options for key generation */
export interface KeyOptions {
  /** Data type (e.g., 'user-profile', 'product') */
  type?: string;
  /** Additional namespace */
  namespace?: string;
}

/**
 * Generate a cache key from parts
 */
export function buildKey(
  identifier: string | number,
  options?: KeyOptions
): string {
  const parts: string[] = [];

  if (options?.namespace) {
    parts.push(options.namespace);
  }

  if (options?.type) {
    parts.push(options.type);
  }

  parts.push(String(identifier));

  return parts.join(':');
}

/**
 * Generate a cache key from method arguments
 */
export function buildKeyFromArgs(
  methodName: string,
  args: unknown[],
  options?: KeyOptions
): string {
  const argsKey = args
    .map((arg) => {
      if (arg === null) return 'null';
      if (arg === undefined) return 'undefined';
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(':');

  const identifier = `${methodName}:${argsKey}`;
  return buildKey(identifier, options);
}

/**
 * Extract type from a key (if present)
 */
export function extractType(key: string): string | undefined {
  const parts = key.split(':');
  // If key has format type:identifier, return type
  if (parts.length >= 2) {
    return parts[0];
  }
  return undefined;
}
