import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { isRecord } from "../files.ts";
import {
  aliased,
  claudeInput,
  failOpen,
  hookLine,
  joined,
  str,
} from "./command-hooks.ts";

const HOOKS = [
  { event: "SessionStart", timeout: 5 },
  { event: "PromptSubmit", timeout: 15 },
  { event: "PreToolUse", timeout: 5 },
  { event: "PostToolUse", timeout: 5 },
  { event: "AgentStop", timeout: 10 },
  { event: "SessionEnd", timeout: 5 },
] as const;

const map = aliased(
  {
    SessionStart: "SessionStart",
    PromptSubmit: "UserPromptSubmit",
    PreToolUse: "PreToolUse",
    PostToolUse: "PostToolUse",
    AgentStop: "Stop",
    SessionEnd: "SessionEnd",
  },
  claudeInput,
  { guarded: true },
);

export const kiroCli: Adapter = {
  id: "kiro-cli",
  name: "Kiro CLI",
  support: "lifecycle",
  events: HOOKS.map((h) => h.event),
  detect: (env) => existsSync(join(env.home, ".kiro")),
  plan: (env, opts) => ({
    harness: "kiro-cli",
    scope: opts.scope,
    edits: [
      {
        kind: "file",
        path: join(
          opts.scope === "project" ? env.cwd : env.home,
          ".kiro",
          "hooks",
          "aclp.json",
        ),
        content: `${JSON.stringify(
          {
            version: "v1",
            hooks: HOOKS.map((h) => ({
              name: `aclp ${h.event}`,
              trigger: h.event,
              action: {
                type: "command",
                command: hookLine(opts.runtime, "kiro-cli", h.event),
              },
              timeout: h.timeout,
            })),
          },
          null,
          2,
        )}\n`,
      },
    ],
    notes: [
      "Kiro CLI V3 adds a command hook's stdout to the agent context; it cannot block a prompt, so a failed guarded request lets the prompt through without context.",
    ],
  }),
  map: (event, payload, env) =>
    map(event, {
      ...(isRecord(payload) ? payload : {}),
      prompt:
        (isRecord(payload) ? str(payload.prompt) : undefined) ??
        env?.vars.USER_PROMPT,
    }),
  render: (event, outcome) => {
    if (event !== "PromptSubmit") {
      return { exitCode: 0 };
    }

    return outcome.blocked !== undefined || outcome.context.length === 0
      ? failOpen(outcome)
      : { stdout: `${joined(outcome)}\n`, exitCode: 0 };
  },
};
