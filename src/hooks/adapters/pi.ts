import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, Message } from "../adapter.ts";
import { type Env, envPath } from "../env.ts";
import { isRecord } from "../files.ts";
import { outputText } from "./command-hooks.ts";
import { pluginModule } from "./plugin-file.ts";
import { usageMessages } from "./transcript.ts";

export const PI_EVENTS = [
  "session_start",
  "input",
  "tool_call",
  "tool_result",
  "message_end",
  "agent_end",
  "session_shutdown",
] as const;

function agentDir(env: Env): string {
  return envPath(env, "PI_CODING_AGENT_DIR", join(env.home, ".pi", "agent"));
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function usage(sessionId: string, message: unknown): Message[] {
  if (
    !isRecord(message) ||
    message.role !== "assistant" ||
    !isRecord(message.usage)
  ) {
    return [];
  }

  const u = message.usage;

  const cached = count(u.cacheRead);

  const model = str(message.model);

  const id = str(message.responseId);

  return usageMessages(sessionId, [
    {
      ...(model === undefined ? {} : { model }),
      ...(id === undefined ? {} : { id }),
      inputTokens: count(u.input) + count(u.cacheWrite) + cached,
      outputTokens: count(u.output),
      cachedInputTokens: cached,
    },
  ]);
}

export function mapPi(event: string, payload: unknown): Message[] {
  if (!isRecord(payload)) {
    return [];
  }

  const sessionId = str(payload.sessionId);

  if (sessionId === undefined) {
    return [];
  }

  const tool = str(payload.toolName);

  const id = str(payload.toolCallId);

  const call =
    tool === undefined
      ? undefined
      : { ...(id === undefined ? {} : { id }), name: tool };

  switch (event) {
    case "session_start":
      return [{ method: "session.started", params: { sessionId } }];
    case "session_shutdown":
      return [
        { method: "session.ended", params: { sessionId, reason: "shutdown" } },
      ];
    case "input": {
      const text = str(payload.text);

      return text === undefined ||
        text.trim() === "" ||
        payload.source === "extension"
        ? []
        : [
            {
              method: "input.submitted",
              params: { sessionId, content: [{ type: "text", text }] },
              guarded: true,
            },
          ];
    }
    case "tool_call":
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
    case "tool_result": {
      if (call === undefined) {
        return [];
      }

      const output = outputText(
        Array.isArray(payload.content)
          ? payload.content
              .filter((c) => isRecord(c) && c.type === "text")
              .map((c) => (isRecord(c) ? c.text : ""))
              .join("\n")
          : undefined,
      );

      const outcome =
        payload.isError === true
          ? {
              status: "failed" as const,
              error: { message: "Tool failed" },
              ...(output === undefined ? {} : { output }),
            }
          : {
              status: "succeeded" as const,
              ...(output === undefined ? {} : { output }),
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
    case "message_end":
      return usage(sessionId, payload.message);
    case "agent_end":
      return [
        {
          method: "run.finished",
          params: { sessionId, outcome: { status: "succeeded" } },
        },
      ];
    default:
      return [];
  }
}

export const pi: Adapter = {
  id: "pi",
  name: "Pi",
  support: "lifecycle",
  events: PI_EVENTS,
  detect: (env) => existsSync(agentDir(env)),
  plan: (env, opts) => ({
    harness: "pi",
    scope: opts.scope,
    edits: [
      {
        kind: "file",
        path:
          opts.scope === "project"
            ? join(env.cwd, ".pi", "extensions", "aclp.ts")
            : join(agentDir(env), "extensions", "aclp.ts"),
        content: pluginModule(opts.runtime.module, "piExtension", "pi"),
      },
    ],
    notes: [
      "Pi discovers extensions at startup; run /reload or restart it after installing.",
    ],
  }),
  map: async (event, payload) => mapPi(event, payload),
  render: () => ({ exitCode: 0 }),
};
