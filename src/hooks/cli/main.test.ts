import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createServer, defineResult } from "../../index.ts";
import { readCredential } from "../credentials.ts";
import { listServers } from "../registry.ts";
import { listen, tempEnv } from "../test-support.ts";
import { main } from "./main.ts";
import type { Ui } from "./ui.ts";

function quiet(lines: string[] = []): Ui {
  const log = (m: string): void => {
    lines.push(m);
  };

  return {
    interactive: false,
    intro: () => undefined,
    outro: () => undefined,
    info: log,
    success: log,
    warn: log,
    note: (m, title) => log(`${title}: ${m}`),
    confirm: async () => true,
    text: async () => "",
    secret: async () => "",
    select: async (_m, choices) =>
      choices[0]?.value ?? Promise.reject(new Error("no choice")),
    multiselect: async (_m, _c, initial) => initial,
    open: () => undefined,
  };
}

test("install, status and uninstall run without prompts for detected harnesses", async (t) => {
  const env = tempEnv(t);

  mkdirSync(join(env.home, ".claude"), { recursive: true });

  const lines: string[] = [];

  let out = "";

  const io = { env, ui: quiet(lines), write: (s: string) => (out += s) };

  assert.equal(await main(["install"], io), 0);
  assert.ok(
    lines.some((l) => l === "Claude Code: installed"),
    lines.join("\n"),
  );
  assert.ok(
    readFileSync(join(env.home, ".claude", "settings.json"), "utf8").includes(
      "aclp-hook",
    ),
  );

  assert.equal(await main(["status", "--json"], io), 0);

  const rows = JSON.parse(out);

  assert.deepEqual(
    rows
      .filter((r: { installed: boolean }) => r.installed)
      .map((r: { harness: string }) => r.harness),
    ["claude-code"],
  );

  assert.equal(await main(["uninstall", "--yes"], io), 0);
  assert.ok(lines.includes("Claude Code: removed"));
});

test("server add discovers the endpoint, stores the token and records consent", async (t) => {
  const env = tempEnv(t);

  const ok = defineResult<{ context: { content: string }[] }>({
    type: "object",
    properties: {
      context: {
        type: "array",
        items: {
          type: "object",
          properties: { content: { type: "string" } },
          required: ["content"],
        },
      },
    },
    required: ["context"],
  });

  const registered: unknown[] = [];

  const server = createServer(
    {
      "client.registered": { handle: (params) => void registered.push(params) },
      "client.updated": { handle: (params) => void registered.push(params) },
      "input.submitted": { result: ok, handle: () => ({ context: [] }) },
      "tool.finished": { handle: () => undefined },
    },
    { authorization: "Bearer t-1" },
  );

  const origin = await listen(t, server);

  const io = { env, ui: quiet(), write: () => undefined };

  const code = await main(
    [
      "server",
      "add",
      "local",
      "--url",
      origin,
      "--harness",
      "claude-code",
      "--events",
      "input.submitted,tool.finished",
      "--token",
      "t-1",
    ],
    io,
  );

  assert.equal(code, 0);

  const [entry] = listServers(env);

  assert.equal(entry?.auth.type, "token");
  assert.deepEqual(entry?.events, ["input.submitted", "tool.finished"]);
  assert.deepEqual(entry?.harnesses, ["claude-code"]);
  assert.equal(readCredential(env, "local")?.accessToken, "t-1");
  assert.equal(registered.length, 1);

  assert.equal(
    await main(["server", "events", "local", "--events", "tool.finished"], io),
    0,
  );
  assert.deepEqual(listServers(env)[0]?.events, ["tool.finished"]);
  assert.deepEqual(listServers(env)[0]?.requests, []);
  assert.equal(registered.length, 2);

  assert.equal(await main(["server", "logout", "local"], io), 0);
  assert.equal(readCredential(env, "local"), undefined);
  assert.equal(await main(["server", "remove", "local", "--yes"], io), 0);
  assert.deepEqual(listServers(env), []);
});

test("unknown commands and missing arguments fail with usage", async (t) => {
  const env = tempEnv(t);

  const lines: string[] = [];

  let out = "";

  const io = { env, ui: quiet(lines), write: (s: string) => (out += s) };

  assert.equal(await main(["frobnicate"], io), 1);
  assert.match(out, /Usage:/);
  assert.equal(await main(["server", "add"], io), 1);
  assert.ok(lines.some((l) => /needs a name/.test(l)));
  assert.equal(await main(["install", "notaharness"], io), 1);
  assert.equal(await main(["--version"], io), 0);
});
