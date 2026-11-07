import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, Message } from "../adapter.ts";
import { isRecord } from "../files.ts";
import { MANAGED } from "../install.ts";
import { VERSION } from "../version.ts";
import { aliased, type HookInput, str } from "./command-hooks.ts";
import { pluginModule } from "./plugin-file.ts";
import { usageMessages } from "./transcript.ts";

export const OPENCLAW_EVENTS = [
  "session_start",
  "before_prompt_build",
  "before_tool_call",
  "after_tool_call",
  "llm_output",
  "agent_end",
  "session_end",
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

  const error = str(payload.error);

  const reason = str(payload.reason);

  if (sessionId !== undefined) out.sessionId = sessionId;
  if (prompt !== undefined) out.prompt = prompt;
  if (tool !== undefined) out.tool = tool;
  if (callId !== undefined) out.callId = callId;
  if (payload.params !== undefined) out.input = payload.params;
  if (payload.result !== undefined) out.output = payload.result;
  if (error !== undefined) out.error = error;
  if (reason !== undefined) out.reason = reason;
  return out;
}

const names = aliased(
  {
    session_start: "SessionStart",
    before_prompt_build: "UserPromptSubmit",
    before_tool_call: "PreToolUse",
    after_tool_call: "PostToolUse",
    after_tool_call_failed: "PostToolUseFailure",
    agent_end: "Stop",
    session_end: "SessionEnd",
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

  if (sessionId === undefined || u.input === undefined) {
    return [];
  }

  const cached = count(u.cacheRead);

  return usageMessages(sessionId, [
    {
      inputTokens: count(u.input) + count(u.cacheWrite) + cached,
      outputTokens: count(u.output),
      cachedInputTokens: cached,
    },
  ]);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const openclaw: Adapter = {
  id: "openclaw",
  name: "OpenClaw",
  support: "lifecycle",
  events: OPENCLAW_EVENTS,
  detect: (env) => existsSync(join(env.home, ".openclaw")),
  plan: (env, opts) => {
    const dir = join(env.home, ".openclaw", "extensions", "aclp");

    return {
      harness: "openclaw",
      scope: "user",
      edits: [
        {
          kind: "file",
          path: join(dir, "package.json"),
          content: json({
            name: "aclp-openclaw",
            version: VERSION,
            private: true,
            type: "module",
            description: `${MANAGED}.`,
            openclaw: { extensions: ["./index.js"] },
          }),
        },
        {
          kind: "file",
          path: join(dir, "openclaw.plugin.json"),
          content: json({
            id: "aclp",
            name: "ACLP",
            description: `Reports OpenClaw events to ACLP servers and adds their context to prompts. ${MANAGED}.`,
            configSchema: {
              type: "object",
              additionalProperties: false,
              properties: {},
            },
          }),
        },
        {
          kind: "file",
          path: join(dir, "index.js"),
          content: pluginModule(
            opts.runtime.module,
            "openclawPlugin",
            "openclaw",
          ),
        },
      ],
      notes: [
        "Enable the plugin and its prompt hooks, then restart the gateway: openclaw plugins enable aclp && openclaw config set plugins.entries.aclp.hooks.allowConversationAccess true --strict-json",
        "OpenClaw plugins are installed per user; --project has no effect.",
      ],
    };
  },
  map: async (event, payload) => {
    const failed =
      event === "after_tool_call" &&
      isRecord(payload) &&
      payload.error !== undefined &&
      payload.error !== null;

    return event === "llm_output"
      ? usage(payload)
      : names(failed ? "after_tool_call_failed" : event, payload);
  },
  render: () => ({ exitCode: 0 }),
};
