import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { isRecord } from "../files.ts";
import { type HookInput, str } from "./command-hooks.ts";
import { hookAdapter } from "./hook-adapter.ts";

function normalize(payload: unknown): HookInput {
  if (!isRecord(payload)) {
    return {};
  }

  const p = payload;

  const out: HookInput = {};

  const pick: [keyof HookInput, string | undefined][] = [
    ["sessionId", str(p.conversation_id) ?? str(p.session_id)],
    ["prompt", str(p.prompt)],
    ["tool", str(p.tool_name)],
    ["callId", str(p.tool_use_id)],
    ["error", str(p.error_message)],
    ["reason", str(p.reason) ?? str(p.status)],
    ["agentId", str(p.subagent_id)],
    ["agentType", str(p.subagent_type)],
  ];

  for (const [k, v] of pick) {
    if (v !== undefined) {
      Object.assign(out, { [k]: v });
    }
  }

  if (p.tool_input !== undefined) out.input = p.tool_input;
  if (p.tool_output !== undefined) out.output = p.tool_output;
  return out;
}

export const cursor: Adapter = hookAdapter({
  id: "cursor",
  name: "Cursor",
  support: "observe",
  home: (env) => join(env.home, ".cursor"),
  path: (env, opts) =>
    join(
      opts.scope === "project" ? env.cwd : env.home,
      ".cursor",
      "hooks.json",
    ),
  layout: "flat",
  extra: { version: 1 },
  handler: (command, timeout) => ({ command, timeout }),
  hooks: [
    { event: "sessionStart", timeout: 5 },
    { event: "beforeSubmitPrompt", timeout: 5 },
    { event: "postToolUse", timeout: 5 },
    { event: "postToolUseFailure", timeout: 5 },
    { event: "subagentStart", timeout: 5 },
    { event: "subagentStop", timeout: 5 },
    { event: "stop", timeout: 5 },
    { event: "sessionEnd", timeout: 5 },
  ],
  names: {
    sessionStart: "SessionStart",
    beforeSubmitPrompt: "UserPromptSubmit",
    postToolUse: "PostToolUse",
    postToolUseFailure: "PostToolUseFailure",
    subagentStart: "SubagentStart",
    subagentStop: "SubagentStop",
    stop: "Stop",
    sessionEnd: "SessionEnd",
  },
  normalize,
  render: (event) =>
    event === "beforeSubmitPrompt"
      ? { stdout: '{"continue":true}\n', exitCode: 0 }
      : { exitCode: 0 },
  notes: [
    "Cursor can add context only at session start and after tools, not before a prompt, so servers observe Cursor prompts. aclp does not hook preToolUse because a Cursor permission hook must answer allow or deny.",
  ],
});
