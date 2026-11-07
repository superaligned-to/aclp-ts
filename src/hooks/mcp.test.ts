import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { CONTEXT_TOOL, serveMcp } from "./mcp.ts";
import { contextServer, register, settle, tempEnv } from "./test-support.ts";

test("aclp mcp serves a context tool that forwards to ACLP servers with harness identity", async (t) => {
  const env = tempEnv(t);

  const seen: { method: string; client?: string }[] = [];

  register(env, await contextServer(t, seen));

  const input = new PassThrough();

  const out: string[] = [];

  const done = serveMcp(
    "claude-desktop",
    input,
    (line) => out.push(line),
    env,
    { sessionId: "m-1" },
  );

  const send = (msg: unknown) => input.write(`${JSON.stringify(msg)}\n`);

  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {} },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: CONTEXT_TOOL, arguments: { query: "retries?" } },
  });
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "x" } });
  input.write("not json\n");
  input.end();
  await done;

  const replies = new Map(
    out.map((l) => JSON.parse(l)).map((r) => [r.id, r] as const),
  );

  assert.equal(replies.get(1)?.result.serverInfo.name, "aclp");
  assert.equal(replies.get(1)?.result.protocolVersion, "2025-06-18");
  assert.deepEqual(
    replies.get(2)?.result.tools.map((x: { name: string }) => x.name),
    [CONTEXT_TOOL],
  );
  assert.deepEqual(replies.get(3)?.result, {
    content: [{ type: "text", text: "Remembered: prefer small PRs." }],
  });
  assert.equal(replies.get(4)?.error.code, -32602);
  assert.equal(replies.get(null)?.error.code, -32700);

  await settle(seen, 3);
  assert.deepEqual(
    seen.map((s) => s.method),
    ["session.started", "input.submitted", "session.ended"],
  );
  assert.ok(seen.every((s) => s.client === "aclp/0.1.0 claude-desktop"));
});
