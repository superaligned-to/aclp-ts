import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import {
  addServer,
  listServers,
  registryPath,
  removeServer,
  type ServerEntry,
  serversFor,
} from "./registry.ts";
import { tempEnv } from "./test-support.ts";

const memory: ServerEntry = {
  name: "memory",
  endpoint: "http://127.0.0.1:8788/aclp",
  harnesses: ["claude-code"],
  events: ["input.submitted", "tool.finished"],
  requests: ["input.submitted"],
  auth: { type: "none" },
};

test("servers are stored once per name in a private registry", (t) => {
  const env = tempEnv(t);

  addServer(env, memory);
  addServer(env, { ...memory, events: ["input.submitted"] });

  assert.deepEqual(
    listServers(env).map((s) => s.events),
    [["input.submitted"]],
  );
  assert.equal(statSync(registryPath(env)).mode & 0o777, 0o600);
  assert.equal(removeServer(env, "memory"), true);
  assert.equal(removeServer(env, "memory"), false);
  assert.deepEqual(listServers(env), []);
});

test("servers apply only to the harnesses they were registered for", (t) => {
  const env = tempEnv(t);

  addServer(env, memory);
  addServer(env, { ...memory, name: "everywhere", harnesses: "all" });

  assert.deepEqual(
    serversFor(env, "claude-code").map((s) => s.name),
    ["memory", "everywhere"],
  );
  assert.deepEqual(
    serversFor(env, "codex").map((s) => s.name),
    ["everywhere"],
  );
});

test("registration rejects bad names, non-http endpoints and requests outside consent", (t) => {
  const env = tempEnv(t);

  assert.throws(
    () => addServer(env, { ...memory, name: "Bad Name" }),
    /names use/,
  );
  assert.throws(
    () => addServer(env, { ...memory, endpoint: "ftp://example.com" }),
    /http\(s\)/,
  );
  assert.throws(
    () => addServer(env, { ...memory, endpoint: "https://u:p@example.com" }),
    /credentials/,
  );
  assert.throws(
    () => addServer(env, { ...memory, requests: ["model.finished"] }),
    /not shared/,
  );
  assert.deepEqual(listServers(env), []);
});

test("entries written by other tools are ignored and preserved", (t) => {
  const env = tempEnv(t);

  const legacy = { id: "memory", manifest: { transport: { type: "stdio" } } };

  addServer(env, memory);

  const path = registryPath(env);

  writeFileSync(
    path,
    JSON.stringify({ version: 1, servers: [legacy, ...listServers(env)] }),
  );

  assert.deepEqual(
    listServers(env).map((s) => s.name),
    ["memory"],
  );
  removeServer(env, "memory");
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
    version: 1,
    servers: [legacy],
  });
});
