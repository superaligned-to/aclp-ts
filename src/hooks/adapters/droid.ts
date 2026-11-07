import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { contextHook, identity } from "./command-hooks.ts";
import { hookAdapter } from "./hook-adapter.ts";

const HOOKS = [
  { event: "SessionStart", timeout: 5 },
  { event: "UserPromptSubmit", timeout: 15 },
  { event: "PreToolUse", timeout: 5 },
  { event: "PostToolUse", timeout: 5 },
  { event: "SubagentStop", timeout: 10 },
  { event: "Stop", timeout: 10 },
  { event: "SessionEnd", timeout: 5 },
] as const;

export const droid: Adapter = hookAdapter({
  id: "droid",
  name: "Factory Droid",
  support: "lifecycle",
  home: (env) => join(env.home, ".factory"),
  path: (env, opts) => {
    const dir = join(opts.scope === "project" ? env.cwd : env.home, ".factory");

    const standalone = join(dir, "hooks.json");

    return existsSync(standalone) ? standalone : join(dir, "settings.json");
  },
  root: (_env, path) => (basename(path) === "hooks.json" ? null : "hooks"),
  hooks: HOOKS,
  names: identity(HOOKS.map((h) => h.event)),
  render: contextHook("UserPromptSubmit"),
  notes: [
    "Droid prefers hooks.json over the hooks key in settings.json; aclp writes to whichever one Droid reads.",
  ],
});
