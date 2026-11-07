import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { xdgConfig } from "../env.ts";
import { contextHook, identity } from "./command-hooks.ts";
import { hookAdapter } from "./hook-adapter.ts";

const HOOKS = [
  { event: "SessionStart", timeout: 5 },
  { event: "UserPromptSubmit", timeout: 15 },
  { event: "PreToolUse", timeout: 5 },
  { event: "PostToolUse", timeout: 5 },
  { event: "Stop", timeout: 10 },
  { event: "SessionEnd", timeout: 5 },
] as const;

export const devinCli: Adapter = hookAdapter({
  id: "devin-cli",
  name: "Devin CLI",
  support: "lifecycle",
  home: (env) => join(xdgConfig(env), "devin"),
  path: (env, opts) =>
    opts.scope === "project"
      ? join(env.cwd, ".devin", "config.json")
      : join(xdgConfig(env), "devin", "config.json"),
  hooks: HOOKS,
  names: identity(HOOKS.map((h) => h.event)),
  render: contextHook("UserPromptSubmit"),
  notes: [
    "Devin CLI also runs hooks from ~/.claude/settings.json unless read_config_from.claude is false; with both installed, servers receive each Devin event twice (once as claude-code).",
  ],
});
