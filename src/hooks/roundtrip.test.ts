import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type CallContext,
  createServer,
  defineResult,
  discover,
} from "../index.ts";
import { configDir, type Env } from "./env.ts";
import { install, status, uninstall } from "./install.ts";
import { plan } from "./plan.ts";
import { listServers } from "./registry.ts";
import { planServer, registerServer, unregisterServer } from "./servers.ts";
import { listen, tempEnv } from "./test-support.ts";

const context = defineResult<{ context: { id: string; content: string }[] }>({
  type: "object",
  properties: {
    context: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, content: { type: "string" } },
        required: ["id", "content"],
        additionalProperties: false,
      },
    },
  },
  required: ["context"],
  additionalProperties: false,
});

interface Seen {
  method: string;
  client: string | undefined;
  params: unknown;
}

function recorder(seen: Seen[]) {
  const note =
    (method: string) =>
    (params: unknown, ctx: CallContext): void => {
      seen.push({ method, client: ctx.client, params });
    };

  return createServer({
    "client.registered": { handle: note("client.registered") },
    "client.unregistered": { handle: note("client.unregistered") },
    "tool.finished": { handle: note("tool.finished") },
    "input.submitted": {
      result: context,
      handle: (params, ctx) => {
        note("input.submitted")(params, ctx);
        return {
          context: [
            { id: "m-1", content: "The uploader retries three times." },
          ],
        };
      },
    },
  });
}

const runtime = {
  node: process.execPath,
  hook: fileURLToPath(new URL("./aclp-hook.ts", import.meta.url)),
  cli: fileURLToPath(new URL("./aclp.ts", import.meta.url)),
  module: new URL("./runtime.ts", import.meta.url).href,
};

interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}

function fireInstalled(
  env: Env,
  settings: string,
  event: string,
  payload: unknown,
): Promise<Ran> {
  const doc = JSON.parse(readFileSync(settings, "utf8"));

  const command: string = doc.hooks[event][0].hooks[0].command;

  const child = spawn("/bin/sh", ["-c", command], {
    env: {
      PATH: process.env.PATH,
      HOME: env.home,
      ACLP_CONFIG_DIR: configDir(env),
      ACLP_CREDENTIALS: "file",
    },
  });

  let stdout = "";

  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdin.end(JSON.stringify(payload));

  return new Promise((resolve) =>
    child.on("close", (status) => resolve({ status, stdout, stderr })),
  );
}

async function eventually(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("install → server add → hook fire → server remove → uninstall, with harness identity", async (t) => {
  const env = tempEnv(t);

  const seen: Seen[] = [];

  const server = recorder(seen);

  const origin = await listen(t, server);

  const p = plan("claude-code", env, "user", runtime);

  install(p);
  assert.equal(status(p).installed, true);

  const discovery = await discover(origin).catch(() => undefined);

  const entry = await planServer({
    name: "memory",
    url: `${origin}/aclp`,
    harnesses: ["claude-code"],
    discovery: discovery ?? null,
  });

  assert.equal(
    await registerServer(env, { ...entry, requests: ["input.submitted"] }),
    undefined,
  );

  const registered = seen.find((s) => s.method === "client.registered");

  assert.match(registered?.client ?? "", /^aclp\/0\.1\.0 claude-code$/);

  const settings = join(env.home, ".claude", "settings.json");

  const prompt = await fireInstalled(env, settings, "UserPromptSubmit", {
    session_id: "s-1",
    prompt: "Add a retry",
  });

  assert.equal(prompt.status, 0, prompt.stderr);
  assert.deepEqual(JSON.parse(prompt.stdout), {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: "The uploader retries three times.",
    },
  });

  const submitted = seen.find((s) => s.method === "input.submitted");

  assert.deepEqual(submitted?.params, {
    sessionId: "s-1",
    content: [{ type: "text", text: "Add a retry" }],
  });
  assert.match(submitted?.client ?? "", /claude-code/);

  const tool = await fireInstalled(env, settings, "PostToolUse", {
    session_id: "s-1",
    tool_name: "Bash",
    tool_input: { command: "ls" },
    tool_response: "README.md",
  });

  assert.equal(tool.status, 0, tool.stderr);
  await eventually(() => seen.some((s) => s.method === "tool.finished"));
  assert.ok(seen.some((s) => s.method === "tool.finished"));

  assert.equal(await unregisterServer(env, "memory"), true);
  await eventually(() => seen.some((s) => s.method === "client.unregistered"));
  assert.ok(seen.some((s) => s.method === "client.unregistered"));
  assert.deepEqual(listServers(env), []);

  const silent = await fireInstalled(env, settings, "UserPromptSubmit", {
    session_id: "s-1",
    prompt: "Again",
  });

  assert.equal(silent.stdout, "");
  assert.equal(seen.filter((s) => s.method === "input.submitted").length, 1);

  uninstall(p);
  assert.equal(status(p).installed, false);
});

test("a failed prompt request fails open by default and blocks only when the server denies on error", async (t) => {
  const env = tempEnv(t);

  const p = plan("claude-code", env, "user", runtime);

  install(p);

  const down = await planServer({
    name: "down",
    url: "http://127.0.0.1:9/aclp",
    harnesses: "all",
    discovery: null,
  });

  await registerServer(env, { ...down, requests: ["input.submitted"] });

  const settings = join(env.home, ".claude", "settings.json");

  const allowed = await fireInstalled(env, settings, "UserPromptSubmit", {
    session_id: "s-1",
    prompt: "hi",
  });

  assert.equal(allowed.status, 0, allowed.stderr);

  await registerServer(env, {
    ...down,
    requests: ["input.submitted"],
    onError: "deny",
  });

  assert.equal(listServers(env)[0]?.onError, "deny");

  const blocked = await fireInstalled(env, settings, "UserPromptSubmit", {
    session_id: "s-1",
    prompt: "hi",
  });

  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /ACLP blocked this prompt: down:/);

  await registerServer(env, { ...down, requests: [] });

  const open = await fireInstalled(env, settings, "UserPromptSubmit", {
    session_id: "s-1",
    prompt: "hi",
  });

  assert.equal(open.status, 0, open.stderr);
});
