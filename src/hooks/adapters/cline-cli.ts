import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, Message } from "../adapter.ts";
import { isRecord } from "../files.ts";
import { aliased, type HookInput, str } from "./command-hooks.ts";
import { pluginModule } from "./plugin-file.ts";
import { usageMessages } from "./transcript.ts";

export const CLINE_EVENTS = [
  "session.start",
  "prompt",
  "tool.before",
  "tool.after",
  "run.after",
  "session.end",
] as const;

function normalize(payload: unknown): HookInput {
  if (!isRecord(payload)) {
    return {};
  }

  const out: HookInput = {};

  const sessionId = str(payload.sessionId);

  const prompt = str(payload.prompt);

  const tool = str(payload.toolName);

  const callId = str(payload.toolCallId);

  if (sessionId !== undefined) out.sessionId = sessionId;
  if (prompt !== undefined) out.prompt = prompt;
  if (tool !== undefined) out.tool = tool;
  if (callId !== undefined) out.callId = callId;
  if (payload.input !== undefined) out.input = payload.input;
  if (payload.output !== undefined) out.output = payload.output;
  return out;
}

const names = aliased(
  {
    "session.start": "SessionStart",
    prompt: "UserPromptSubmit",
    "tool.before": "PreToolUse",
    "tool.after": "PostToolUse",
    "tool.failed": "PostToolUseFailure",
    "run.after": "Stop",
    "session.end": "SessionEnd",
  },
  normalize,
  { guarded: true },
);

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function usage(payload: unknown): Message[] {
  const sessionId = isRecord(payload) ? str(payload.sessionId) : undefined;

  const u = isRecord(payload) && isRecord(payload.usage) ? payload.usage : {};

  if (sessionId === undefined || u.inputTokens === undefined) {
    return [];
  }

  return usageMessages(sessionId, [
    {
      inputTokens: count(u.inputTokens),
      outputTokens: count(u.outputTokens),
      cachedInputTokens: count(u.cacheReadTokens),
    },
  ]);
}

export const clineCli: Adapter = {
  id: "cline-cli",
  name: "Cline CLI/SDK",
  support: "lifecycle",
  events: CLINE_EVENTS,
  detect: (env) => existsSync(join(env.home, ".cline")),
  plan: (env, opts) => ({
    harness: "cline-cli",
    scope: opts.scope,
    edits: [
      {
        kind: "file",
        path: join(
          opts.scope === "project" ? env.cwd : env.home,
          ".cline",
          "plugins",
          "aclp.ts",
        ),
        content: pluginModule(opts.runtime.module, "clinePlugin", "cline-cli"),
      },
    ],
    notes: [
      "Covers the Cline CLI and SDK, which discover ~/.cline/plugins; the VS Code and JetBrains extensions do not load these plugins.",
    ],
  }),
  map: async (event, payload) => {
    const failed =
      event === "tool.after" && isRecord(payload) && payload.isError === true;

    const messages = await names(failed ? "tool.failed" : event, payload);

    return event === "run.after" ? [...messages, ...usage(payload)] : messages;
  },
  render: () => ({ exitCode: 0 }),
};
