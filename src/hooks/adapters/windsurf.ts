import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { isRecord } from "../files.ts";
import { type HookInput, quiet, str } from "./command-hooks.ts";
import { hookAdapter } from "./hook-adapter.ts";

const TOOLS: Readonly<Record<string, string>> = {
  pre_run_command: "run_command",
  post_run_command: "run_command",
  pre_mcp_tool_use: "mcp_tool",
  post_mcp_tool_use: "mcp_tool",
  post_write_code: "write_code",
};

function normalize(payload: unknown): HookInput {
  if (!isRecord(payload)) {
    return {};
  }

  const info = isRecord(payload.tool_info) ? payload.tool_info : {};

  const action = str(payload.agent_action_name) ?? "";

  const tool = str(info.mcp_tool_name) ?? TOOLS[action];

  const sessionId = str(payload.trajectory_id);

  const prompt = str(info.user_prompt);

  const callId = str(payload.execution_id);

  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(prompt === undefined ? {} : { prompt }),
    ...(tool === undefined ? {} : { tool, input: info }),
    ...(callId === undefined || tool === undefined ? {} : { callId }),
  };
}

export const windsurf: Adapter = hookAdapter({
  id: "windsurf",
  name: "Windsurf",
  support: "observe",
  home: (env) => join(env.home, ".codeium", "windsurf"),
  path: (env, opts) =>
    opts.scope === "project"
      ? join(env.cwd, ".windsurf", "hooks.json")
      : join(env.home, ".codeium", "windsurf", "hooks.json"),
  layout: "flat",
  handler: (command) => ({ command, show_output: false }),
  hooks: [
    { event: "pre_user_prompt", timeout: 0 },
    { event: "pre_run_command", timeout: 0 },
    { event: "post_run_command", timeout: 0 },
    { event: "pre_mcp_tool_use", timeout: 0 },
    { event: "post_mcp_tool_use", timeout: 0 },
    { event: "post_write_code", timeout: 0 },
    { event: "post_cascade_response", timeout: 0 },
  ],
  names: {
    pre_user_prompt: "UserPromptSubmit",
    pre_run_command: "PreToolUse",
    post_run_command: "PostToolUse",
    pre_mcp_tool_use: "PreToolUse",
    post_mcp_tool_use: "PostToolUse",
    post_write_code: "PostToolUse",
    post_cascade_response: "Stop",
  },
  normalize,
  render: quiet,
  notes: [
    "Cascade hooks can block but cannot add context, so servers observe Windsurf prompts and tools. Windsurf has no session start or end hooks.",
  ],
});
