import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { isRecord } from "../files.ts";
import { MANAGED } from "../install.ts";
import { VERSION } from "../version.ts";
import {
  aliased,
  claudeInput,
  grouped,
  identity,
  quiet,
  str,
} from "./command-hooks.ts";

const HOOKS = [
  { event: "SessionStart", timeout: 5 },
  { event: "UserPromptSubmit", timeout: 5 },
  { event: "PreToolUse", timeout: 5 },
  { event: "PostToolUse", timeout: 5 },
  { event: "PostToolUseFailure", timeout: 5 },
  { event: "Stop", timeout: 10 },
  { event: "SessionEnd", timeout: 5 },
] as const;

const map = aliased(identity(HOOKS.map((h) => h.event)), claudeInput, {
  guarded: false,
});

export const goose: Adapter = {
  id: "goose",
  name: "Goose",
  support: "observe",
  events: HOOKS.map((h) => h.event),
  detect: (env) => existsSync(join(env.home, ".config", "goose")),
  plan: (env, opts) => {
    const dir = join(
      opts.scope === "project" ? env.cwd : env.home,
      ".agents",
      "plugins",
      "aclp",
    );

    return {
      harness: "goose",
      scope: opts.scope,
      edits: [
        {
          kind: "file",
          path: join(dir, "plugin.json"),
          content: `${JSON.stringify(
            {
              name: "aclp",
              version: VERSION,
              description: `Reports goose events to ACLP servers. ${MANAGED}.`,
            },
            null,
            2,
          )}\n`,
        },
        {
          kind: "file",
          path: join(dir, "hooks", "hooks.json"),
          content: `${JSON.stringify(
            {
              hooks: grouped(opts.runtime, "goose", HOOKS, (command) => ({
                type: "command",
                command,
              })),
            },
            null,
            2,
          )}\n`,
        },
      ],
      notes: [
        "Goose hooks can block or observe but cannot add context, so servers observe goose prompts and tools.",
      ],
    };
  },
  map: (event, payload) =>
    map(event, {
      ...(isRecord(payload) ? payload : {}),
      ...(isRecord(payload) && str(payload.session_id) === undefined
        ? { session_id: payload.sessionId }
        : {}),
    }),
  render: quiet,
};
