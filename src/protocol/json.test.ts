import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeJson,
  encodeJson,
  MAX_BODY_BYTES,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
} from "./json.ts";

const bytes = (source: string): Uint8Array => new TextEncoder().encode(source);

test("strict JSON round trips preserve values", () => {
  const value = { text: "héllo", nested: [null, 1, true, { key: "value" }] };

  assert.deepEqual(decodeJson(encodeJson(value)), value);
  assert.equal(decodeJson(bytes('"\\ud800"')), "\ud800");
});

test("decoding rejects duplicate decoded keys, invalid UTF8 and non-finite numbers", () => {
  for (const source of [
    '{"x":1,"x":2}',
    '{"x":1,"\\u0078":2}',
    "1e400",
    '{"n":NaN}',
    "{} trailing",
    '{"x":1,}',
  ]) {
    assert.throws(() => decodeJson(bytes(source)), Error, source);
  }

  assert.throws(() => decodeJson(new Uint8Array([255])));
  assert.throws(() => decodeJson(new Uint8Array([239, 187, 191, 123, 125])));
});

test("encoding rejects values JSON serialization would coerce or discard", () => {
  const cycle: Record<string, unknown> = {};

  cycle.self = cycle;

  for (const value of [
    undefined,
    NaN,
    Infinity,
    1n,
    () => 1,
    { x: undefined },
    new Date(),
    new Map(),
    cycle,
    Array(1),
  ]) {
    assert.throws(() => encodeJson(value));
  }

  const getter = {
    get x(): number {
      throw new Error("must not execute");
    },
  };

  assert.throws(() => encodeJson(getter), /data properties/);
  assert.throws(() => encodeJson(Object.assign([1], { toJSON: () => [2] })));

  const arrayGetter = Object.defineProperty([], 0, {
    get(): never {
      throw new Error("must not execute");
    },
    enumerable: true,
  });

  assert.throws(() => encodeJson(arrayGetter), /indexed data properties/);
});

test("body and complexity limits reject one-over-boundary input", () => {
  assert.equal(MAX_BODY_BYTES, 1_048_576);
  assert.equal(MAX_JSON_DEPTH, 64);
  assert.equal(MAX_JSON_NODES, 100_000);
  assert.equal(
    encodeJson("x".repeat(MAX_BODY_BYTES - 2)).byteLength,
    MAX_BODY_BYTES,
  );
  assert.throws(() => encodeJson("x".repeat(MAX_BODY_BYTES - 1)));
  assert.throws(() => decodeJson(new Uint8Array(MAX_BODY_BYTES + 1)));
  assert.doesNotThrow(() =>
    decodeJson(
      bytes(`${"[".repeat(MAX_JSON_DEPTH)}0${"]".repeat(MAX_JSON_DEPTH)}`),
    ),
  );
  assert.throws(() =>
    decodeJson(
      bytes(
        `${"[".repeat(MAX_JSON_DEPTH + 1)}0${"]".repeat(MAX_JSON_DEPTH + 1)}`,
      ),
    ),
  );
  assert.throws(() => encodeJson(Array(MAX_JSON_NODES).fill(0)));
});
