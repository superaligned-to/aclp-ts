import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeJson,
  encodeJson,
  isEnvelope,
  isEventMethod,
  MAX_BODY_BYTES,
  validateParams,
} from "./index.ts";

test("framework servers validate messages through the package entry point", () => {
  const message = decodeJson(
    encodeJson({
      jsonrpc: "2.0",
      method: "session.started",
      params: { sessionId: "s" },
    }),
  );

  assert.equal(MAX_BODY_BYTES, 1_048_576);
  assert.equal(isEnvelope(message), true);
  assert.equal(isEventMethod("session.started"), true);
  assert.equal(validateParams("session.started", { sessionId: "s" }), true);
  assert.equal(validateParams("session.started", {}), false);
});
