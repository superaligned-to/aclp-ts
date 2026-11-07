import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, Message } from "../adapter.ts";
import { type Env, xdgConfig } from "../env.ts";
import { isRecord } from "../files.ts";
import { outputText } from "./command-hooks.ts";
import { pluginModule } from "./plugin-file.ts";

export const OPENCODE_EVENTS = [
  "session.started",
  "prompt",
  "tool.before",
  "tool.after",
  "session.deleted",
] as const;

function configRoot(env: Env): string {
  return join(xdgConfig(env), "opencode");
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function mapOpencode(event: string, payload: unknown): Message[] {
  if (!isRecord(payload)) {
    return [];
  }

  const sessionId = str(payload.sessionID);

  if (sessionId === undefined) {
    return [];
  }

  const tool = str(payload.tool);

  const id = str(payload.id);

  const call =
    tool === undefined
      ? undefined
      : { ...(id === undefined ? {} : { id }), name: tool };

  switch (event) {
    case "session.started":
      return [{ method: "session.started", params: { sessionId } }];
    case "session.deleted":
      return [
        { method: "session.ended", params: { sessionId, reason: "deleted" } },
      ];
    case "prompt": {
      const text = str(payload.text);

      return text === undefined || text.trim() === ""
        ? []
        : [
            {
              method: "input.submitted",
              params: { sessionId, content: [{ type: "text", text }] },
              guarded: true,
            },
          ];
    }
    case "tool.before":
      return call === undefined
        ? []
        : [
            {
              method: "tool.requested",
              params: {
                sessionId,
                call: { ...call, arguments: payload.input ?? {} },
              },
            },
          ];
    case "tool.after": {
      if (call === undefined) {
        return [];
      }

      const output = outputText(payload.output);

      const outcome =
        payload.status === "completed" || payload.status === undefined
          ? {
              status: "succeeded" as const,
              ...(output === undefined ? {} : { output }),
            }
          : {
              status: "failed" as const,
              error: { message: str(payload.error) ?? "Tool failed" },
            };

      return [
        {
          method: "tool.finished",
          params: {
            sessionId,
            call: {
              ...call,
              ...(payload.input === undefined
                ? {}
                : { arguments: payload.input }),
            },
            outcome,
          },
        },
      ];
    }
    default:
      return [];
  }
}

export const opencode: Adapter = {
  id: "opencode",
  name: "OpenCode",
  support: "lifecycle",
  events: OPENCODE_EVENTS,
  detect: (env) =>
    existsSync(configRoot(env)) || existsSync(join(env.home, ".opencode")),
  plan: (env, opts) => ({
    harness: "opencode",
    scope: opts.scope,
    edits: [
      {
        kind: "file",
        path:
          opts.scope === "project"
            ? join(env.cwd, ".opencode", "plugins", "aclp.js")
            : join(configRoot(env), "plugins", "aclp.js"),
        content: pluginModule(
          opts.runtime.module,
          "opencodePlugin",
          "opencode",
        ),
      },
    ],
    notes: [
      "OpenCode loads plugins at startup; restart it after installing. Token usage is not exposed to plugins.",
    ],
  }),
  map: async (event, payload) => mapOpencode(event, payload),
  render: () => ({ exitCode: 0 }),
};
