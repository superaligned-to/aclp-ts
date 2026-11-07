import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { claudeCode } from "./claude-code.ts";
import { codex } from "./codex.ts";
import { MAX_OUTPUT_BYTES, renderCommandHook } from "./command-hooks.ts";
import { assertValid } from "./validity.ts";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const payloads: Record<string, Record<string, unknown>> = JSON.parse(
  readFileSync(fixture("claude-code.json"), "utf8")
    .replaceAll("@@TRANSCRIPT@@", fixture("claude-transcript.jsonl"))
    .replaceAll("@@AGENT_TRANSCRIPT@@", fixture("claude-transcript.jsonl")),
);

async function map(event: string) {
  return claudeCode.map(event, payloads[event]);
}

test("every recorded Claude Code event maps to valid ACLP messages", async () => {
  const methods: Record<string, string[]> = {};

  for (const event of claudeCode.events) {
    const messages = await map(event);

    await assertValid(messages);
    methods[event] = messages.map((m) => m.method);
  }

  assert.deepEqual(methods, {
    SessionStart: ["session.started"],
    UserPromptSubmit: ["input.submitted"],
    PreToolUse: ["tool.requested"],
    PostToolUse: ["tool.finished"],
    PostToolUseFailure: ["tool.finished"],
    SubagentStart: ["agent.started"],
    SubagentStop: ["agent.finished", "model.finished", "model.finished"],
    Stop: ["run.finished", "model.finished", "model.finished"],
    SessionEnd: ["session.ended"],
  });
});

test("only the prompt is a guarded request", async () => {
  for (const event of claudeCode.events) {
    for (const message of await map(event)) {
      assert.equal(
        message.guarded === true,
        message.method === "input.submitted",
        event,
      );
    }
  }
});

test("turn usage comes from the transcript, de-duplicated by message id", async () => {
  const usage = (await map("Stop"))
    .filter((m) => m.method === "model.finished")
    .map((m) => m.params);

  assert.deepEqual(usage, [
    {
      sessionId: "s-1",
      model: { name: "claude-opus-5-5" },
      modelCallId: "msg_a",
      outcome: { status: "succeeded" },
      usage: { inputTokens: 2103, outputTokens: 55, cachedInputTokens: 2000 },
    },
    {
      sessionId: "s-1",
      model: { name: "claude-opus-5-5" },
      modelCallId: "msg_b",
      outcome: { status: "succeeded" },
      usage: { inputTokens: 2105, outputTokens: 12, cachedInputTokens: 2100 },
    },
  ]);

  const agent = (await map("SubagentStop")).filter(
    (m) => m.method === "model.finished",
  );

  assert.ok(
    agent.every(
      (m) => m.method === "model.finished" && m.params.agentId === "a-1",
    ),
  );
});

test("tool results keep arguments and clip long output", async () => {
  const [finished] = await claudeCode.map("PostToolUse", {
    ...payloads.PostToolUse,
    tool_response: "x".repeat(MAX_OUTPUT_BYTES * 2),
  });

  assert.ok(finished?.method === "tool.finished");
  assert.deepEqual(finished.params.call, {
    id: "toolu_1",
    name: "Bash",
    arguments: { command: "pnpm test" },
  });

  const output =
    finished.params.outcome.status === "succeeded"
      ? finished.params.outcome.output
      : undefined;

  assert.equal(
    output?.content[0]?.type === "text" && output.content[0].text.length,
    MAX_OUTPUT_BYTES,
  );
});

test("payloads without a session or prompt produce nothing", async () => {
  assert.deepEqual(
    await claudeCode.map("UserPromptSubmit", { prompt: "hi" }),
    [],
  );
  assert.deepEqual(
    await claudeCode.map("UserPromptSubmit", { session_id: "s", prompt: "  " }),
    [],
  );
  assert.deepEqual(await claudeCode.map("Unknown", { session_id: "s" }), []);
  assert.deepEqual(await claudeCode.map("SessionStart", "nope"), []);
});

test("prompt results render as additional context, failures block, other events stay silent", () => {
  assert.deepEqual(
    renderCommandHook("UserPromptSubmit", { context: ["a", "b"] }),
    {
      stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "a\n\nb" } })}\n`,
      exitCode: 0,
    },
  );
  assert.deepEqual(
    renderCommandHook("UserPromptSubmit", {
      context: [],
      blocked: "memory: down",
    }),
    {
      stderr: "ACLP blocked this prompt: memory: down\n",
      exitCode: 2,
    },
  );
  assert.deepEqual(renderCommandHook("UserPromptSubmit", { context: [] }), {
    exitCode: 0,
  });
  assert.deepEqual(
    renderCommandHook("PostToolUse", { context: ["x"], blocked: "y" }),
    { exitCode: 0 },
  );
});

test("Codex uses the same payload shape with rollout token counts for usage", async () => {
  const messages = await codex.map("Stop", {
    session_id: "c-1",
    transcript_path: fixture("codex-transcript.jsonl"),
  });

  await assertValid(messages);
  assert.deepEqual(
    messages.map((m) =>
      m.method === "model.finished" ? m.params.usage : m.method,
    ),
    [
      "run.finished",
      { inputTokens: 1200, outputTokens: 90, cachedInputTokens: 800 },
    ],
  );
  assert.deepEqual(
    (
      await codex.map("UserPromptSubmit", { session_id: "c-1", prompt: "hi" })
    )[0]?.method,
    "input.submitted",
  );
});
