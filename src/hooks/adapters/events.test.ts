import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isHarness, type Outcome } from "../adapter.ts";
import { ADAPTERS } from "../harnesses.ts";
import { tempEnv } from "../test-support.ts";
import { assertValid } from "./validity.ts";

interface Case {
  event: string;
  payload: unknown;
  methods: string[];
}

const fixtures: Record<string, Case[]> = JSON.parse(
  readFileSync(new URL("./fixtures/events.json", import.meta.url), "utf8"),
);

for (const [harness, cases] of Object.entries(fixtures)) {
  test(`${harness} native payloads map to valid ACLP messages`, async (t) => {
    assert.ok(isHarness(harness));

    const adapter = ADAPTERS[harness];

    const env = tempEnv(t);

    for (const c of cases) {
      assert.ok(adapter.events.includes(c.event), `${c.event} is installed`);

      const messages = await adapter.map(c.event, c.payload, env);

      assert.deepEqual(
        messages.map((m) => m.method),
        c.methods,
        `${harness} ${c.event}`,
      );
      await assertValid(messages);
    }
  });
}

const context: Outcome = { context: ["Remembered: small PRs."] };

const blocked: Outcome = { context: [], blocked: "memory: timeout" };

const prompts: [string, string, RegExp, number][] = [
  ["gemini-cli", "BeforeAgent", /"hookEventName":"BeforeAgent"/, 2],
  ["qwen-code", "UserPromptSubmit", /"additionalContext"/, 2],
  ["droid", "UserPromptSubmit", /"additionalContext"/, 2],
  ["devin-cli", "UserPromptSubmit", /"additionalContext"/, 2],
  ["kiro-cli", "PromptSubmit", /^Remembered: small PRs\.\n$/, 0],
  ["copilot-cli", "userPromptTransformed", /"modifiedTransformedPrompt"/, 0],
  ["hermes", "pre_llm_call", /^\{"context":"Remembered/, 0],
];

test("prompt hooks render context natively and block only where the harness can", () => {
  for (const [harness, event, shape, exitCode] of prompts) {
    assert.ok(isHarness(harness));

    const adapter = ADAPTERS[harness];

    const payload = { transformedPrompt: "Fix CI" };

    assert.match(
      adapter.render(event, context, payload).stdout ?? "",
      shape,
      harness,
    );
    assert.equal(
      adapter.render(event, blocked, payload).exitCode,
      exitCode,
      harness,
    );
    assert.deepEqual(adapter.render("SessionEnd", context, payload), {
      exitCode: 0,
    });
  }

  assert.match(
    ADAPTERS["copilot-cli"].render("userPromptTransformed", context, {
      transformedPrompt: "Fix CI",
    }).stdout ?? "",
    /Remembered: small PRs\.\\n\\nFix CI"/,
  );
  assert.deepEqual(
    ADAPTERS.hermes.render("pre_llm_call", blocked).stdout,
    '{"blocked":"memory: timeout"}\n',
  );
});

test("observe-only harnesses never print context and send prompts as notifications", async () => {
  for (const harness of ["cursor", "windsurf", "auggie", "goose"] as const) {
    const adapter = ADAPTERS[harness];

    assert.equal(adapter.support, "observe");

    const prompt = fixtures[harness]?.find(
      (c) => c.methods[0] === "input.submitted",
    );

    assert.ok(prompt);

    const [message] = await adapter.map(prompt.event, prompt.payload);

    assert.equal(message?.guarded, undefined);
    assert.doesNotMatch(
      adapter.render(prompt.event, context).stdout ?? "",
      /Remembered/,
    );
  }

  assert.equal(
    ADAPTERS.cursor.render("beforeSubmitPrompt", context).stdout,
    '{"continue":true}\n',
  );
});

test("Kiro reads the prompt from USER_PROMPT when stdin omits it", async (t) => {
  const env = tempEnv(t, { USER_PROMPT: "From the environment" });

  const [message] = await ADAPTERS["kiro-cli"].map(
    "PromptSubmit",
    { session_id: "k-1" },
    env,
  );

  assert.equal(message?.method, "input.submitted");
  assert.deepEqual(message?.params, {
    sessionId: "k-1",
    content: [{ type: "text", text: "From the environment" }],
  });
});
