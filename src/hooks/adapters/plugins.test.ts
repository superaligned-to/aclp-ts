import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contextServer,
  register,
  settle,
  tempEnv,
  withEnv,
} from "../test-support.ts";
import { opencode } from "./opencode.ts";
import { opencodePlugin } from "./opencode-runtime.ts";
import { pi } from "./pi.ts";
import { piExtension } from "./pi-runtime.ts";
import { assertValid } from "./validity.ts";

test("OpenCode events map to valid ACLP messages", async () => {
  const cases: [string, unknown][] = [
    ["session.started", { sessionID: "o-1" }],
    ["prompt", { sessionID: "o-1", text: "Refactor the parser" }],
    [
      "tool.before",
      { sessionID: "o-1", id: "c-1", tool: "bash", input: { command: "ls" } },
    ],
    [
      "tool.after",
      {
        sessionID: "o-1",
        id: "c-1",
        tool: "bash",
        input: { command: "ls" },
        status: "completed",
        output: "a\nb",
      },
    ],
    [
      "tool.after",
      {
        sessionID: "o-1",
        id: "c-2",
        tool: "bash",
        status: "error",
        error: "boom",
      },
    ],
    ["session.deleted", { sessionID: "o-1" }],
  ];

  for (const [event, payload] of cases) {
    const messages = await opencode.map(event, payload);

    assert.equal(messages.length, 1, event);
    await assertValid(messages);
  }
});

test("Pi events map to valid ACLP messages, including model usage", async () => {
  const usage = await pi.map("message_end", {
    sessionId: "p-1",
    message: {
      role: "assistant",
      model: "gpt-6.1-sol",
      usage: { input: 10, output: 20, cacheRead: 300, cacheWrite: 5 },
    },
  });

  assert.deepEqual(usage[0]?.params, {
    sessionId: "p-1",
    model: { name: "gpt-6.1-sol" },
    outcome: { status: "succeeded" },
    usage: { inputTokens: 315, outputTokens: 20, cachedInputTokens: 300 },
  });

  for (const [event, payload] of [
    ["session_start", { sessionId: "p-1" }],
    ["input", { sessionId: "p-1", text: "hello", source: "interactive" }],
    [
      "tool_call",
      {
        sessionId: "p-1",
        toolCallId: "t-1",
        toolName: "bash",
        input: { command: "ls" },
      },
    ],
    [
      "tool_result",
      {
        sessionId: "p-1",
        toolCallId: "t-1",
        toolName: "bash",
        input: {},
        content: [{ type: "text", text: "ok" }],
        isError: false,
      },
    ],
    ["agent_end", { sessionId: "p-1", messages: [] }],
    ["session_shutdown", { sessionId: "p-1" }],
  ] as const) {
    const messages = await pi.map(event, payload);

    assert.equal(messages.length, 1, event);
    await assertValid(messages);
  }

  assert.deepEqual(
    await pi.map("input", { sessionId: "p-1", text: "x", source: "extension" }),
    [],
  );
});

test("the OpenCode plugin injects server context into the system prompt", async (t) => {
  const env = tempEnv(t);

  const seen: { method: string; client?: string }[] = [];

  register(env, await contextServer(t, seen));

  const hooks = new Map<
    string,
    (input: unknown, output: unknown) => Promise<void>
  >();

  const ctx = {
    session: {
      hook: async (
        name: string,
        fn: (i: unknown, o: unknown) => Promise<void>,
      ) => hooks.set(`session.${name}`, fn),
    },
    tool: {
      hook: async (
        name: string,
        fn: (i: unknown, o: unknown) => Promise<void>,
      ) => hooks.set(`tool.${name}`, fn),
    },
  };

  await withEnv(env, async () => {
    await opencodePlugin().setup(ctx);

    await hooks.get("session.prompt")?.(
      { sessionID: "o-1", prompt: { text: "Refactor the parser" } },
      {},
    );

    const system: unknown[] = [];

    await hooks.get("session.context")?.({ sessionID: "o-1", system }, {});
    assert.deepEqual(system, [
      { type: "text", text: "Remembered: prefer small PRs." },
    ]);

    await hooks.get("tool.execute.after")?.(
      { sessionID: "o-1", id: "c-1", tool: "bash", input: { command: "ls" } },
      { output: "a" },
    );
  });

  await settle(seen, 3);
  assert.deepEqual(
    seen.map((s) => s.method),
    ["session.started", "input.submitted", "tool.finished"],
  );
  assert.ok(seen.every((s) => s.client === "aclp/0.1.0 opencode"));
});

test("the Pi extension adds server context before the agent starts", async (t) => {
  const env = tempEnv(t);

  const seen: { method: string; client?: string }[] = [];

  register(env, await contextServer(t, seen));

  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => Promise<unknown>
  >();

  const piApi = {
    on: (name: string, fn: (e: unknown, c: unknown) => Promise<unknown>) =>
      handlers.set(name, fn),
  };

  const ctx = { sessionManager: { getSessionId: () => "p-1" } };

  await withEnv(env, async () => {
    piExtension()(piApi);

    assert.equal(
      await handlers.get("input")?.(
        { type: "input", text: "hello", source: "interactive" },
        ctx,
      ),
      undefined,
    );

    const injected = await handlers.get("before_agent_start")?.(
      { type: "before_agent_start", reason: "prompt" },
      ctx,
    );

    assert.deepEqual(injected, {
      message: {
        customType: "aclp-context",
        content: "Remembered: prefer small PRs.",
        display: false,
      },
    });
    assert.equal(
      await handlers.get("before_agent_start")?.({}, ctx),
      undefined,
    );

    await handlers.get("message_end")?.(
      {
        message: {
          role: "assistant",
          model: "m",
          usage: { input: 1, output: 2 },
        },
      },
      ctx,
    );
  });

  await settle(seen, 2);
  assert.deepEqual(
    seen.map((s) => s.method),
    ["input.submitted", "model.finished"],
  );
});
