import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { xdgConfig } from "../env.ts";
import {
  aliased,
  claudeInput,
  hookLine,
  quiet,
  quote,
} from "./command-hooks.ts";

const HOOKS = [
  { event: "SessionStart", timeout: 5 },
  { event: "PreToolUse", timeout: 5 },
  { event: "PostToolUse", timeout: 5 },
  { event: "PostToolUseFailure", timeout: 5 },
  { event: "TurnEnd", timeout: 10 },
  { event: "SessionEnd", timeout: 2 },
] as const;

export const crush: Adapter = {
  id: "crush",
  name: "Crush",
  support: "observe",
  events: HOOKS.map((h) => h.event),
  detect: (env) => existsSync(join(xdgConfig(env), "crush")),
  plan: (env, opts) => ({
    harness: "crush",
    scope: opts.scope,
    edits: [
      {
        kind: "block",
        path:
          opts.scope === "project"
            ? join(env.cwd, ".crushrc")
            : join(xdgConfig(env), "crush", "crushrc"),
        comment: "#",
        content: HOOKS.map(
          (h) =>
            `hook add ${h.event} --name aclp --command ${quote(hookLine(opts.runtime, "crush", h.event))} --timeout ${h.timeout}`,
        ).join("\n"),
      },
    ],
    notes: [
      "Crush's TurnStart hook carries no prompt text, so servers do not receive Crush prompts; tools, turn ends and sessions are reported.",
    ],
  }),
  map: aliased(
    {
      SessionStart: "SessionStart",
      PreToolUse: "PreToolUse",
      PostToolUse: "PostToolUse",
      PostToolUseFailure: "PostToolUseFailure",
      TurnEnd: "Stop",
      SessionEnd: "SessionEnd",
    },
    claudeInput,
    { guarded: false },
  ),
  render: quiet,
};
