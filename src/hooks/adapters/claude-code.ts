import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, PlanOptions } from "../adapter.ts";
import type { Env } from "../env.ts";
import {
  grouped,
  type HookSpec,
  mapCommandHook,
  renderCommandHook,
} from "./command-hooks.ts";
import { claudeTurnUsage } from "./transcript.ts";

export const CLAUDE_HOOKS: readonly HookSpec[] = [
  { event: "SessionStart", timeout: 5 },
  { event: "UserPromptSubmit", timeout: 15 },
  { event: "PreToolUse", matcher: "*", timeout: 5 },
  { event: "PostToolUse", matcher: "*", timeout: 5 },
  { event: "PostToolUseFailure", matcher: "*", timeout: 5 },
  { event: "SubagentStart", timeout: 5 },
  { event: "SubagentStop", timeout: 10 },
  { event: "Stop", timeout: 10 },
  { event: "SessionEnd", timeout: 5 },
];

function settingsPath(env: Env, opts: PlanOptions): string {
  return opts.scope === "project"
    ? join(env.cwd, ".claude", "settings.json")
    : join(
        env.vars.CLAUDE_CONFIG_DIR ?? join(env.home, ".claude"),
        "settings.json",
      );
}

export const claudeCode: Adapter = {
  id: "claude-code",
  name: "Claude Code",
  support: "lifecycle",
  events: CLAUDE_HOOKS.map((h) => h.event),
  detect: (env) =>
    existsSync(env.vars.CLAUDE_CONFIG_DIR ?? join(env.home, ".claude")),
  plan: (env, opts) => ({
    harness: "claude-code",
    scope: opts.scope,
    edits: [
      {
        kind: "hooks",
        root: "hooks",
        path: settingsPath(env, opts),
        entries: grouped(opts.runtime, "claude-code", CLAUDE_HOOKS),
      },
    ],
    notes: [
      "Claude Code loads hooks at session start; restart running sessions.",
    ],
  }),
  map: async (event, payload) =>
    mapCommandHook(event, payload, claudeTurnUsage),
  render: renderCommandHook,
};
