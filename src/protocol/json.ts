export const MAX_BODY_BYTES = 1_048_576;

// The root has depth zero; each nested value adds one level.
export const MAX_JSON_DEPTH = 64;

// Count containers and scalar values once each; object keys do not count.
export const MAX_JSON_NODES = 100_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new Error("JSON body exceeds 1 MiB");
  }

  const source = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);

  let position = 0;

  let nodes = 0;

  function whitespace(): void {
    while ([32, 9, 10, 13].includes(source.charCodeAt(position))) {
      position++;
    }
  }

  function string(): string {
    const start = position++;

    while (position < source.length) {
      const code = source.charCodeAt(position++);

      if (code === 92) {
        position++;
        continue;
      }

      if (code === 34) {
        const value: unknown = JSON.parse(source.slice(start, position));

        if (typeof value !== "string") {
          throw new Error("Invalid JSON string");
        }

        return value;
      }
    }

    throw new Error("Unterminated JSON string");
  }

  function value(depth: number): void {
    nodes++;

    if (depth > MAX_JSON_DEPTH || nodes > MAX_JSON_NODES) {
      throw new Error("JSON complexity limit exceeded");
    }

    whitespace();

    const start = position;

    const character = source[position];

    if (character === "{") {
      position++;
      whitespace();

      const keys = new Set<string>();

      if (source[position] === "}") {
        position++;
        return;
      }

      for (;;) {
        if (source.charCodeAt(position) !== 34) {
          throw new Error("Invalid JSON object key");
        }

        const key = string();

        if (keys.has(key)) {
          throw new Error("Duplicate JSON object key");
        }

        keys.add(key);
        whitespace();

        if (source[position++] !== ":") {
          throw new Error("Invalid JSON object");
        }

        value(depth + 1);
        whitespace();

        const next = source[position++];

        if (next === "}") {
          return;
        }

        if (next !== ",") {
          throw new Error("Invalid JSON object");
        }

        whitespace();
      }
    }

    if (character === "[") {
      position++;
      whitespace();

      if (source[position] !== "]") {
        for (;;) {
          value(depth + 1);
          whitespace();

          if (source[position] === "]") {
            break;
          }

          if (source[position++] !== ",") {
            throw new Error("Invalid JSON array");
          }
        }
      }

      position++;
      return;
    }

    if (source.charCodeAt(position) === 34) {
      string();
      return;
    }

    while (
      position < source.length &&
      ![" ", "\t", "\n", "\r", ",", "]", "}"].includes(source[position] ?? "")
    ) {
      position++;
    }

    if (position === start) {
      throw new Error("Invalid JSON value");
    }

    const primitive: unknown = JSON.parse(source.slice(start, position));

    if (typeof primitive === "number" && !Number.isFinite(primitive)) {
      throw new Error("Non-finite JSON number");
    }
  }

  value(0);
  whitespace();

  if (position !== source.length) {
    throw new Error("Trailing data after JSON value");
  }

  const parsed: unknown = JSON.parse(source);

  return parsed;
}

export function encodeJson(value: unknown): Uint8Array {
  const ancestors = new Set<object>();

  let nodes = 0;

  function check(item: unknown, depth: number): void {
    nodes++;

    if (depth > MAX_JSON_DEPTH || nodes > MAX_JSON_NODES) {
      throw new Error("JSON complexity limit exceeded");
    }

    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      return;
    }

    if (typeof item === "number" && Number.isFinite(item)) {
      return;
    }

    if (typeof item !== "object" || item === null || ancestors.has(item)) {
      throw new Error("Value is not finite, acyclic JSON");
    }

    ancestors.add(item);

    if (Array.isArray(item)) {
      if (
        Object.getPrototypeOf(item) !== Array.prototype ||
        Reflect.ownKeys(item).length !== item.length + 1
      ) {
        throw new Error(
          "JSON arrays must contain only indexed data properties",
        );
      }

      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));

        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          throw new Error(
            "JSON arrays must contain only indexed data properties",
          );
        }

        const child: unknown = descriptor.value;

        check(child, depth + 1);
      }
    } else {
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      ) {
        throw new Error("JSON objects must be plain objects");
      }

      for (const key of Reflect.ownKeys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);

        if (
          typeof key !== "string" ||
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          throw new Error("JSON properties must be enumerable data properties");
        }

        const child: unknown = descriptor.value;

        check(child, depth + 1);
      }
    }

    ancestors.delete(item);
  }

  check(value, 0);

  const source = JSON.stringify(value);

  if (source === undefined) {
    throw new Error("Value cannot be encoded as JSON");
  }

  const bytes = new TextEncoder().encode(source);

  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new Error("JSON body exceeds 1 MiB");
  }

  return bytes;
}
