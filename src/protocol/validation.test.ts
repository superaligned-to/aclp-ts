import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { eventDefinitions } from "./generated.ts";
import {
  defineResult,
  isEnvelope,
  isEventMethod,
  isResponse,
  validateParams,
} from "./index.ts";

test("all forty generated methods accept their canonical parameters", async () => {
  const examples: unknown = JSON.parse(
    await readFile(
      new URL("./event-examples.test.json", import.meta.url),
      "utf8",
    ),
  );

  assert.ok(Array.isArray(examples));
  assert.equal(Object.keys(eventDefinitions).length, 40);
  assert.equal(examples.length, 40);

  for (const example of examples) {
    assert.ok(Array.isArray(example));

    const method: unknown = example[0];

    const params: unknown = example[1];

    assert.ok(typeof method === "string" && isEventMethod(method));
    assert.equal(validateParams(method, params), true, method);
    assert.equal(validateParams(method, { unexpected: true }), false, method);
  }
});

test("generic envelopes classify unsupported methods before method lookup", () => {
  const message = {
    jsonrpc: "2.0",
    method: "custom.method",
    params: {},
    id: "r",
  };

  assert.equal(isEnvelope(message), true);
  assert.equal(isEventMethod(message.method), false);
  assert.equal(isEnvelope({ ...message, id: "é".repeat(65) }), false);
  assert.equal(isEnvelope({ ...message, id: null }), false);
  assert.equal(isEnvelope({ ...message, extra: true }), false);
});

test("response envelopes preserve matching-id constraints and result/error exclusivity", () => {
  assert.equal(isResponse({ jsonrpc: "2.0", id: "r", result: null }), true);
  assert.equal(
    isResponse({
      jsonrpc: "2.0",
      id: "r",
      result: null,
      error: { code: -32603, message: "Failed" },
    }),
    false,
  );
  assert.equal(
    isResponse({
      jsonrpc: "2.0",
      id: "r",
      error: { code: -32700, message: "Parse error" },
    }),
    false,
  );
  assert.equal(
    isResponse({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    }),
    true,
  );
});

test("binary content must use canonical base64 without interpreting structured data", () => {
  assert.equal(
    validateParams("input.submitted", {
      sessionId: "s",
      content: [{ type: "image", mimeType: "image/png", data: "AA==" }],
    }),
    true,
  );
  assert.equal(
    validateParams("input.submitted", {
      sessionId: "s",
      content: [{ type: "image", mimeType: "image/png", data: "AB==" }],
    }),
    false,
  );
  assert.equal(
    validateParams("input.submitted", {
      sessionId: "s",
      content: [],
      structuredContent: { type: "image", data: "AB==" },
    }),
    true,
  );
});

test("permission origins and offered identities have semantic constraints", () => {
  const options = [{ id: "allow", label: "Allow", decision: "allow" }];

  assert.equal(
    validateParams("permission.requested", {
      sessionId: "s",
      operation: { kind: "network", origin: "https://example.com/" },
      options,
    }),
    true,
  );
  assert.equal(
    validateParams("permission.requested", {
      sessionId: "s",
      operation: { kind: "network", origin: "https://example.com/path" },
      options,
    }),
    false,
  );
  assert.equal(
    validateParams("permission.requested", {
      sessionId: "s",
      operation: { kind: "network", origin: "https://example.com/?" },
      options,
    }),
    false,
  );
  assert.equal(
    validateParams("permission.requested", {
      sessionId: "s",
      operation: { kind: "capability", name: "network" },
      options: [...options, { id: "allow", label: "Other", decision: "deny" }],
    }),
    false,
  );
});

test("catalogs, plans, settings and batch calls require unique supplied identities", () => {
  assert.equal(
    validateParams("catalog.changed", {
      catalog: "skills",
      entries: [{ name: "x" }, { name: "x", description: "other" }],
    }),
    false,
  );
  assert.equal(
    validateParams("plan.updated", {
      sessionId: "s",
      steps: [
        { id: "x", text: "A", status: "pending" },
        { id: "x", text: "B", status: "pending" },
      ],
    }),
    false,
  );
  assert.equal(
    validateParams("configuration.changed", {
      changes: [
        { key: "x", value: 1 },
        { key: "x", value: 2 },
      ],
    }),
    false,
  );
  assert.equal(
    validateParams("tool.batch.finished", {
      sessionId: "s",
      calls: [
        { call: { id: "x", name: "a" }, outcome: { status: "unknown" } },
        { call: { id: "x", name: "b" }, outcome: { status: "unknown" } },
      ],
    }),
    false,
  );
});

test("embedded schemas resolve locally and accepted form answers satisfy them", () => {
  const interaction = {
    kind: "form",
    message: "Choose count",
    schema: { type: "integer", minimum: 1 },
  };

  assert.equal(
    validateParams("interaction.resolved", {
      sessionId: "s",
      interaction,
      response: { status: "accepted", value: 1 },
    }),
    true,
  );
  assert.equal(
    validateParams("interaction.resolved", {
      sessionId: "s",
      interaction,
      response: { status: "accepted", value: 0 },
    }),
    false,
  );
  assert.equal(
    validateParams("catalog.changed", {
      catalog: "tools",
      entries: [
        { name: "x", inputSchema: { $ref: "https://example.invalid/schema" } },
      ],
    }),
    false,
  );
  assert.equal(
    validateParams("catalog.changed", {
      catalog: "tools",
      entries: [{ name: "x", inputSchema: { $ref: "#/definitions/missing" } }],
    }),
    false,
  );
  assert.equal(
    validateParams("catalog.changed", {
      catalog: "tools",
      entries: [
        {
          name: "x",
          inputSchema: {
            $schema: "https://json-schema.org/draft-07/schema#",
            type: "object",
          },
        },
      ],
    }),
    true,
  );
});

test("result schemas validate without coercing or adding defaults", () => {
  const result = defineResult<{ count: number }>({
    type: "object",
    properties: { count: { type: "number", default: 1 } },
    required: ["count"],
    additionalProperties: false,
  });

  const missing = {};

  assert.equal(result.validate({ count: 1 }), true);
  assert.equal(result.validate({ count: "1" }), false);
  assert.equal(result.validate(missing), false);
  assert.deepEqual(missing, {});
  assert.equal(result.validate({ count: Infinity }), false);
  assert.throws(() =>
    defineResult<string>({
      type: "string",
      $ref: "https://example.invalid/schema",
    }),
  );
});

test("the pinned schema digest matches the vendored definition", async () => {
  const { createHash } = await import("node:crypto");

  const source = await readFile(new URL("./schema.json", import.meta.url));

  const manifest: unknown = JSON.parse(
    await readFile(
      new URL("../../protocol-source.json", import.meta.url),
      "utf8",
    ),
  );

  assert.ok(
    typeof manifest === "object" &&
      manifest !== null &&
      "schemaSha256" in manifest,
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    manifest.schemaSha256,
  );
});

test("network permission origins reject paths hidden by URL normalization", () => {
  for (const origin of [
    "https://example.com/a/..",
    "https://example.com/%2e",
    "https:example.com",
    "https://@example.com",
  ]) {
    assert.equal(
      validateParams("permission.requested", {
        sessionId: "s",
        operation: { kind: "network", origin },
        options: [{ id: "allow", label: "Allow", decision: "allow" }],
      }),
      false,
      origin,
    );
  }
});
