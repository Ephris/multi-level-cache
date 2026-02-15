/**
 * JSON serialization with type preservation for special types
 */

/** Type markers for special values */
const TYPE_MARKERS = {
  DATE: '__DATE__',
  BIGINT: '__BIGINT__',
  UNDEFINED: '__UNDEFINED__',
  MAP: '__MAP__',
  SET: '__SET__',
} as const;

/** Wrapper for typed values */
interface TypedValue {
  __type: string;
  value: unknown;
}

/**
 * Check if value is a typed wrapper
 */
function isTypedValue(value: unknown): value is TypedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__type' in value &&
    'value' in value
  );
}

/**
 * Pre-process value to convert special types before JSON.stringify
 * This is needed because Date.toJSON() is called before the replacer
 */
function preProcess(value: unknown): unknown {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return { __type: TYPE_MARKERS.DATE, value: value.toISOString() };
  }

  if (typeof value === 'bigint') {
    return { __type: TYPE_MARKERS.BIGINT, value: value.toString() };
  }

  if (value === undefined) {
    return { __type: TYPE_MARKERS.UNDEFINED, value: null };
  }

  if (value instanceof Map) {
    return {
      __type: TYPE_MARKERS.MAP,
      value: Array.from(value.entries()).map(([k, v]) => [
        preProcess(k),
        preProcess(v),
      ]),
    };
  }

  if (value instanceof Set) {
    return {
      __type: TYPE_MARKERS.SET,
      value: Array.from(value).map((v) => preProcess(v)),
    };
  }

  if (Array.isArray(value)) {
    return value.map((v) => preProcess(v));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = preProcess(val);
    }
    return result;
  }

  return value;
}

/**
 * Serialize a value to JSON string with type preservation
 */
export function serialize<T>(value: T): string {
  return JSON.stringify(preProcess(value));
}

/**
 * Deserialize a JSON string back to the original value
 */
export function deserialize<T>(json: string): T {
  return JSON.parse(json, (_key, val) => {
    if (isTypedValue(val)) {
      switch (val.__type) {
        case TYPE_MARKERS.DATE:
          return new Date(val.value as string);
        case TYPE_MARKERS.BIGINT:
          return BigInt(val.value as string);
        case TYPE_MARKERS.UNDEFINED:
          return undefined;
        case TYPE_MARKERS.MAP:
          return new Map(val.value as Array<[unknown, unknown]>);
        case TYPE_MARKERS.SET:
          return new Set(val.value as unknown[]);
      }
    }
    return val;
  });
}
