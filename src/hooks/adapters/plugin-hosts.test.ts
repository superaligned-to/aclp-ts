import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contextServer,
  register,
  settle,
  tempEnv,
  withEnv,
} from "../test-support.ts";
import { ampPlugin } from "./amp-runtime.ts";
import { clinePlugin } from "./cline-runtime.ts";
import { openclawPlugin } from "./openclaw-runtime.ts";
import { piExtension } from "./pi-runtime.ts";

type Handler = (event: unknown, ctx?: unknown) => Promise<unknown>;

const CONTEXT = "Remembered: prefer small PRs.";

async function harness(t: Parameters<typeof tempEnv>[0]) {
  const env = tempEnv(t);

  const seen: { method: string; client?: string }[] = [];

  register(env, await contextServer(t, seen));

  return { env, seen };
}

test("the OMP extension uses Pi's events and identifies as omp", async (t) => {
  const { env, seen } = await harness(t);

  const handlers = new Map<string, Handler>();

  const ctx = { sessionManager: { getSessionId: () => "m-1" } };

  const result = await withEnv(env, async () => {
    piExtension("omp")({
      on: (name: string, fn: Handler) => handlers.set(name, fn),
    });
    await handlers.get("input")?.({ text: "Ship it", source: "user" }, ctx);
    return handlers.get("before_agent_start")?.({}, ctx);
  });

  assert.deepEqual(result, {
    message: { customType: "aclp-context", content: CONTEXT, display: false },
  });
  await settle(seen, 1);
  assert.deepEqual(seen, [
    { method: "input.submitted", client: "aclp/0.1.0 omp" },
  ]);
});

test("the Amp plugin returns server context as a hidden message", async (t) => {
  const { env, seen } = await harness(t);

  const handlers = new Map<string, Handler>();

  const disposers: (() => Promise<void>)[] = [];

  const thread = { id: "T-1" };

  const reply = await withEnv(env, async () => {
    ampPlugin()({
      on: (name: string, fn: Handler) => handlers.set(name, fn),
      onDispose: (fn: () => Promise<void>) => disposers.push(fn),
    });
    await handlers.get("session.start")?.({ thread });

    const out = await handlers.get("agent.start")?.({
      thread,
      message: "Refactor the cache",
    });

    await handlers.get("tool.result")?.({
      thread,
      tool: "Bash",
      toolUseID: "toolu_1",
      status: "done",
    });
    await Promise.all(disposers.map((d) => d()));
    return out;
  });

  assert.deepEqual(reply, { message: { content: CONTEXT, display: false } });
  await settle(seen, 4);
  assert.deepEqual(
    seen.map((s) => s.method),
    ["session.started", "input.submitted", "tool.finished", "session.ended"],
  );
  assert.ok(seen.every((s) => s.client === "aclp/0.1.0 amp"));
});

test("the Cline plugin inserts context before the newest user message once per prompt", async (t) => {
  const { env, seen } = await harness(t);

  const plugin = clinePlugin();

  const disposers: (() => Promise<void>)[] = [];

  const user = {
    id: "u-1",
    role: "user",
    content: [{ type: "text", text: "Add docs" }],
  };

  const request = {
    messages: [{ id: "s", role: "system", content: "sys" }, user],
  };

  const [first, second] = await withEnv(env, async () => {
    plugin.setup(
      {},
      {
        session: { sessionId: "l-1" },
        onDispose: (fn: () => Promise<void>) => disposers.push(fn),
      },
    );

    const a = await plugin.hooks.beforeModel({ request });

    const b = await plugin.hooks.beforeModel({ request });

    await plugin.hooks.afterRun({
      result: { usage: { inputTokens: 10, outputTokens: 2 } },
    });
    await Promise.all(disposers.map((d) => d()));
    return [a, b];
  });

  assert.deepEqual(first, second);

  assert.equal(first?.messages.length, 3);
  assert.partialDeepStrictEqual(first, {
    messages: [
      { role: "system" },
      { role: "user", content: [{ type: "text", text: CONTEXT }] },
      user,
    ],
  });
  await settle(seen, 5);
  assert.deepEqual(seen.map((s) => s.method).sort(), [
    "input.submitted",
    "model.finished",
    "run.finished",
    "session.ended",
    "session.started",
  ]);
});

test("the OpenClaw plugin prepends context in before_prompt_build", async (t) => {
  const { env, seen } = await harness(t);

  const handlers = new Map<string, Handler>();

  const reply = await withEnv(env, async () => {
    openclawPlugin().register({
      on: (name: string, fn: Handler) => handlers.set(name, fn),
    });
    await handlers.get("session_start")?.({ sessionId: "x-1" }, {});

    const out = await handlers.get("before_prompt_build")?.(
      { prompt: "Book a table" },
      { sessionId: "x-1" },
    );

    await handlers.get("after_tool_call")?.(
      { toolName: "browser", params: {}, result: "ok", durationMs: 3 },
      { sessionId: "x-1" },
    );
    return out;
  });

  assert.deepEqual(reply, { prependContext: CONTEXT });
  await settle(seen, 3);
  assert.deepEqual(
    seen.map((s) => s.method),
    ["session.started", "input.submitted", "tool.finished"],
  );
  assert.ok(seen.every((s) => s.client === "aclp/0.1.0 openclaw"));
});
