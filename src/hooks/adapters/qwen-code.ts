import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { contextHook, identity } from "./command-hooks.ts";
import { hookAdapter } from "./hook-adapter.ts";

const HOOKS = [
  { event: "SessionStart", timeout: 5 },
  { event: "UserPromptSubmit", timeout: 15 },
  { event: "PreToolUse", timeout: 5 },
  { event: "PostToolUse", timeout: 5 },
  { event: "PostToolUseFailure", timeout: 5 },
  { event: "SubagentStart", timeout: 5 },
  { event: "SubagentStop", timeout: 10 },
  { event: "Stop", timeout: 10 },
  { event: "SessionEnd", timeout: 5 },
] as const;

export const qwenCode: Adapter = hookAdapter({
  id: "qwen-code",
  name: "Qwen Code",
  support: "lifecycle",
  home: (env) => join(env.home, ".qwen"),
  path: (env, opts) =>
    join(
      opts.scope === "project" ? env.cwd : env.home,
      ".qwen",
      "settings.json",
    ),
  hooks: HOOKS,
  names: identity(HOOKS.map((h) => h.event)),
  render: contextHook("UserPromptSubmit"),
  notes: [
    "Qwen Code loads project hooks only in trusted folders; user hooks always load.",
  ],
});
