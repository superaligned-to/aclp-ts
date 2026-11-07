import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { isRecord } from "../files.ts";
import { type HookInput, quiet, str } from "./command-hooks.ts";
import { hookAdapter } from "./hook-adapter.ts";

function normalize(payload: unknown): HookInput {
  if (!isRecord(payload)) {
    return {};
  }

  const p = payload;

  const out: HookInput = {};

  const sessionId = str(p.conversation_id) ?? str(p.session_id);

  const prompt = str(p.user_prompt) ?? str(p.prompt);

  const tool = str(p.tool_name);

  const error = str(p.tool_error);

  if (sessionId !== undefined) out.sessionId = sessionId;
  if (prompt !== undefined) out.prompt = prompt;
  if (tool !== undefined) out.tool = tool;
  if (p.tool_input !== undefined) out.input = p.tool_input;
  if (p.tool_output !== undefined) out.output = p.tool_output;
  if (error !== undefined) out.error = error;
  return out;
}

export const auggie: Adapter = hookAdapter({
  id: "auggie",
  name: "Auggie CLI",
  support: "observe",
  home: (env) => join(env.home, ".augment"),
  path: (env, opts) =>
    join(
      opts.scope === "project" ? env.cwd : env.home,
      ".augment",
      "settings.json",
    ),
  hooks: [
    { event: "SessionStart", timeout: 5_000 },
    { event: "PromptSubmit", timeout: 5_000 },
    { event: "PreToolUse", timeout: 5_000 },
    { event: "PostToolUse", timeout: 5_000 },
    { event: "Stop", timeout: 10_000 },
    { event: "SessionEnd", timeout: 5_000 },
  ],
  names: {
    SessionStart: "SessionStart",
    PromptSubmit: "UserPromptSubmit",
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    Stop: "Stop",
    SessionEnd: "SessionEnd",
  },
  normalize,
  render: quiet,
  notes: [
    "Auggie runs PromptSubmit and SessionStart hooks in the background and never adds their output to the agent context, so servers observe prompts but cannot add context.",
  ],
});
