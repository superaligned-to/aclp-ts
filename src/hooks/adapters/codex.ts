import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, PlanOptions } from "../adapter.ts";
import { type Env, envPath } from "../env.ts";
import {
  grouped,
  type HookSpec,
  mapCommandHook,
  renderCommandHook,
} from "./command-hooks.ts";
import { codexTurnUsage } from "./transcript.ts";

export const CODEX_HOOKS: readonly HookSpec[] = [
  { event: "SessionStart", timeout: 5 },
  { event: "UserPromptSubmit", timeout: 15 },
  { event: "PreToolUse", matcher: "*", timeout: 5 },
  { event: "PostToolUse", matcher: "*", timeout: 5 },
  { event: "SubagentStart", timeout: 5 },
  { event: "SubagentStop", timeout: 10 },
  { event: "Stop", timeout: 10 },
  { event: "SessionEnd", timeout: 5 },
];

function codexHome(env: Env): string {
  return envPath(env, "CODEX_HOME", join(env.home, ".codex"));
}

function hooksPath(env: Env, opts: PlanOptions): string {
  return opts.scope === "project"
    ? join(env.cwd, ".codex", "hooks.json")
    : join(codexHome(env), "hooks.json");
}

export const codex: Adapter = {
  id: "codex",
  name: "Codex",
  support: "lifecycle",
  events: CODEX_HOOKS.map((h) => h.event),
  detect: (env) => existsSync(codexHome(env)),
  plan: (env, opts) => ({
    harness: "codex",
    scope: opts.scope,
    edits: [
      {
        kind: "hooks",
        root: "hooks",
        path: hooksPath(env, opts),
        entries: grouped(opts.runtime, "codex", CODEX_HOOKS),
      },
    ],
    notes: [
      "Codex asks you to review and trust new hooks (/hooks) before they run.",
    ],
  }),
  map: async (event, payload) => mapCommandHook(event, payload, codexTurnUsage),
  render: renderCommandHook,
};
