import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "./adapter.ts";
import { dispatch, readHealth } from "./dispatch.ts";
import type { ServerEntry } from "./registry.ts";
import { tempEnv } from "./test-support.ts";

const down: ServerEntry = {
  name: "down",
  endpoint: "http://127.0.0.1:9/aclp",
  harnesses: "all",
  events: ["input.submitted", "tool.requested"],
  requests: ["input.submitted", "tool.requested"],
  auth: { type: "none" },
};

const prompt: Message = {
  method: "input.submitted",
  params: { sessionId: "s-1", content: [{ type: "text", text: "hi" }] },
  guarded: true,
};

const tool: Message = {
  method: "tool.requested",
  params: {
    sessionId: "s-1",
    call: { id: "c-1", name: "shell", arguments: { command: "ls" } },
  },
  guarded: true,
};

test("a failed prompt request fails open and is still recorded as unhealthy", async (t) => {
  const env = tempEnv(t);

  const outcome = await dispatch(env, "claude-code", [prompt], {
    servers: [down],
  });

  assert.equal(outcome.blocked, undefined);
  assert.deepEqual(outcome.context, []);
  assert.equal(readHealth(env).down?.ok, false);
});

test("a failed tool guard blocks unless the server allows on error", async (t) => {
  const env = tempEnv(t);

  const closed = await dispatch(env, "claude-code", [tool], {
    servers: [down],
  });

  assert.match(closed.blocked ?? "", /^down: /);

  const open = await dispatch(env, "claude-code", [tool], {
    servers: [{ ...down, onError: "allow" }],
  });

  assert.equal(open.blocked, undefined);

  const strict = await dispatch(env, "claude-code", [prompt], {
    servers: [{ ...down, onError: "deny" }],
  });

  assert.match(strict.blocked ?? "", /^down: /);
});
