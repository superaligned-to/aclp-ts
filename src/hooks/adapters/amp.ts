import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { xdgConfig } from "../env.ts";
import { isRecord } from "../files.ts";
import { aliased, type HookInput, str } from "./command-hooks.ts";
import { pluginModule } from "./plugin-file.ts";

export const AMP_EVENTS = [
  "session.start",
  "agent.start",
  "tool.call",
  "tool.result",
  "agent.end",
  "session.end",
] as const;

function normalize(payload: unknown): HookInput {
  if (!isRecord(payload)) {
    return {};
  }

  const out: HookInput = {};

  const sessionId = str(payload.threadId);

  const prompt = str(payload.message);

  const tool = str(payload.tool);

  const callId = str(payload.toolUseID);

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
    "agent.start": "UserPromptSubmit",
    "tool.call": "PreToolUse",
    "tool.result": "PostToolUse",
    "tool.error": "PostToolUseFailure",
    "agent.end": "Stop",
    "session.end": "SessionEnd",
  },
  normalize,
  { guarded: true },
);

export const amp: Adapter = {
  id: "amp",
  name: "Amp",
  support: "lifecycle",
  events: AMP_EVENTS,
  detect: (env) => existsSync(join(xdgConfig(env), "amp")),
  plan: (env, opts) => ({
    harness: "amp",
    scope: opts.scope,
    edits: [
      {
        kind: "file",
        path:
          opts.scope === "project"
            ? join(env.cwd, ".amp", "plugins", "aclp.ts")
            : join(xdgConfig(env), "amp", "plugins", "aclp.ts"),
        content: pluginModule(opts.runtime.module, "ampPlugin", "amp"),
      },
    ],
    notes: [
      "Amp loads plugins at startup or on plugin reload. Amp has no session end event; aclp reports session.ended when the plugin is disposed.",
    ],
  }),
  map: (event, payload) =>
    names(
      event === "tool.result" && isRecord(payload) && payload.status === "error"
        ? "tool.error"
        : event,
      payload,
    ),
  render: () => ({ exitCode: 0 }),
};
