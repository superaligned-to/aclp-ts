import assert from "node:assert/strict";
import test from "node:test";
import {
  compileLocalSchema,
  MAX_SCHEMA_DEPTH,
  MAX_SCHEMA_NODES,
} from "./schema-validator.ts";

test("schema compilation enforces its documented complexity ceilings", () => {
  assert.equal(MAX_SCHEMA_DEPTH, 32);
  assert.equal(MAX_SCHEMA_NODES, 2_048);
  assert.doesNotThrow(() => compileLocalSchema({ type: "string" }));
  assert.throws(
    () =>
      compileLocalSchema({
        enum: Array.from({ length: MAX_SCHEMA_NODES }, (_, index) => index),
      }),
    /complexity/,
  );

  let nested: unknown = "value";

  for (let index = 0; index < MAX_SCHEMA_DEPTH + 1; index++) {
    nested = [nested];
  }

  assert.throws(() => compileLocalSchema({ const: nested }), /complexity/);
});

test("self-contained references compile without loading remote resources", () => {
  const validate = compileLocalSchema({
    definitions: { count: { type: "integer" } },
    $ref: "#/definitions/count",
  });

  assert.equal(validate(1), true);
  assert.equal(validate("1"), false);
  assert.throws(() =>
    compileLocalSchema({ $ref: "https://example.invalid/missing" }),
  );
  const asynchronous: Record<string, unknown> = {
    $async: true,
    type: "number",
  };

  assert.throws(() => compileLocalSchema(asynchronous));
});
