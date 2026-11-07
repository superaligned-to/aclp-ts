import type { Message, Outcome, Rendered, Runtime } from "../adapter.ts";
import { isRecord } from "../files.ts";
import { type Usage, usageMessages } from "./transcript.ts";

export const MAX_OUTPUT_BYTES = 8_192;

export const CANONICAL = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "SubagentStart",
  "SubagentStop",
  "Stop",
] as const;

export type Canonical = (typeof CANONICAL)[number];

export function isCanonical(value: string): value is Canonical {
  return (CANONICAL as readonly string[]).includes(value);
}

export interface HookSpec {
  event: string;
  matcher?: string;
  timeout: number;
}

export interface HookInput {
  sessionId?: string;
  prompt?: string;
  tool?: string;
  callId?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  reason?: string;
  agentId?: string;
  agentType?: string;
  transcript?: string;
  agentTranscript?: string;
}

export interface MapOptions {
  guarded: boolean;
  usage?: (path: string) => Usage[];
}

type Handler = (command: string, timeout: number) => Record<string, unknown>;

export function quote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function hookLine(
  runtime: Runtime,
  harness: string,
  event: string,
): string {
  return `${quote(runtime.node)} ${quote(runtime.hook)} ${harness} ${event}`;
}

export const commandHandler: Handler = (command, timeout) => ({
  type: "command",
  command,
  timeout,
});

export function grouped(
  runtime: Runtime,
  harness: string,
  specs: readonly HookSpec[],
  handler: Handler = commandHandler,
): Record<string, unknown[]> {
  return Object.fromEntries(
    specs.map((s) => [
      s.event,
      [
        {
          ...(s.matcher === undefined ? {} : { matcher: s.matcher }),
          hooks: [handler(hookLine(runtime, harness, s.event), s.timeout)],
        },
      ],
    ]),
  );
}

export function flat(
  runtime: Runtime,
  harness: string,
  specs: readonly HookSpec[],
  handler: Handler,
): Record<string, unknown[]> {
  return Object.fromEntries(
    specs.map((s) => [
      s.event,
      [handler(hookLine(runtime, harness, s.event), s.timeout)],
    ]),
  );
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function claudeInput(payload: unknown): HookInput {
  if (!isRecord(payload)) {
    return {};
  }

  const p = payload;

  const out: HookInput = {};

  const set = <K extends keyof HookInput>(k: K, v: HookInput[K]) => {
    if (v !== undefined) {
      out[k] = v;
    }
  };

  set("sessionId", str(p.session_id));
  set("prompt", str(p.prompt));
  set("tool", str(p.tool_name));
  set("callId", str(p.tool_use_id));
  set("input", p.tool_input);
  set("output", p.tool_response);
  set("error", str(p.error));
  set("reason", str(p.source) ?? str(p.reason));
  set("agentId", str(p.agent_id));
  set("agentType", str(p.agent_type));
  set("transcript", str(p.transcript_path));
  set("agentTranscript", str(p.agent_transcript_path));
  return out;
}

export function outputText(
  value: unknown,
): { content: { type: "text"; text: string }[] } | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const text = typeof value === "string" ? value : JSON.stringify(value);

  const bytes = Buffer.from(text);

  const clipped =
    bytes.byteLength > MAX_OUTPUT_BYTES
      ? bytes.subarray(0, MAX_OUTPUT_BYTES).toString("utf8")
      : text;

  return { content: [{ type: "text", text: clipped }] };
}

export function toMessages(
  event: Canonical,
  h: HookInput,
  opts: MapOptions,
): Message[] {
  const sessionId = h.sessionId;

  if (sessionId === undefined) {
    return [];
  }

  const reason = h.reason === undefined ? {} : { reason: h.reason };

  const call =
    h.tool === undefined
      ? undefined
      : { ...(h.callId === undefined ? {} : { id: h.callId }), name: h.tool };

  const agent = {
    ...(h.agentId === undefined ? {} : { id: h.agentId }),
    ...(h.agentType === undefined ? {} : { name: h.agentType }),
  };

  const hasAgent = h.agentId !== undefined || h.agentType !== undefined;

  const usage = (path: string | undefined, agentId?: string): Message[] =>
    path === undefined || opts.usage === undefined
      ? []
      : usageMessages(sessionId, opts.usage(path), agentId);

  switch (event) {
    case "SessionStart":
      return [{ method: "session.started", params: { sessionId, ...reason } }];
    case "SessionEnd":
      return [{ method: "session.ended", params: { sessionId, ...reason } }];
    case "UserPromptSubmit":
      return h.prompt === undefined || h.prompt.trim() === ""
        ? []
        : [
            {
              method: "input.submitted",
              params: {
                sessionId,
                content: [{ type: "text", text: h.prompt }],
              },
              ...(opts.guarded ? { guarded: true } : {}),
            },
          ];
    case "PreToolUse":
      return call === undefined
        ? []
        : [
            {
              method: "tool.requested",
              params: {
                sessionId,
                call: { ...call, arguments: h.input ?? {} },
              },
            },
          ];
    case "PostToolUse":
    case "PostToolUseFailure": {
      if (call === undefined) {
        return [];
      }

      const output = outputText(h.output);

      const out = output === undefined ? {} : { output };

      return [
        {
          method: "tool.finished",
          params: {
            sessionId,
            call: {
              ...call,
              ...(h.input === undefined ? {} : { arguments: h.input }),
            },
            outcome:
              event === "PostToolUseFailure"
                ? {
                    status: "failed",
                    error: { message: h.error ?? "Tool failed" },
                    ...out,
                  }
                : { status: "succeeded", ...out },
          },
        },
      ];
    }
    case "SubagentStart":
      return hasAgent
        ? [{ method: "agent.started", params: { sessionId, agent } }]
        : [];
    case "SubagentStop":
      return [
        ...(hasAgent
          ? [
              {
                method: "agent.finished" as const,
                params: {
                  sessionId,
                  agent,
                  outcome: { status: "succeeded" as const },
                },
              },
            ]
          : []),
        ...usage(h.agentTranscript, h.agentId),
      ];
    case "Stop":
      return [
        {
          method: "run.finished",
          params: { sessionId, outcome: { status: "succeeded" } },
        },
        ...usage(h.transcript),
      ];
  }
}

export function aliased(
  names: Readonly<Record<string, Canonical>>,
  normalize: (payload: unknown) => HookInput,
  opts: MapOptions,
) {
  return async (event: string, payload: unknown): Promise<Message[]> => {
    const canonical = names[event];

    return canonical === undefined
      ? []
      : toMessages(canonical, normalize(payload), opts);
  };
}

export function identity(events: readonly string[]): Record<string, Canonical> {
  return Object.fromEntries(events.filter(isCanonical).map((e) => [e, e]));
}

export const quiet = (): Rendered => ({ exitCode: 0 });

export function failOpen(outcome: Outcome): Rendered {
  return outcome.blocked === undefined
    ? { exitCode: 0 }
    : {
        stderr: `ACLP could not add context to this prompt: ${outcome.blocked}\n`,
        exitCode: 0,
      };
}

export function joined(outcome: Outcome): string {
  return outcome.context.join("\n\n");
}

export function contextHook(promptEvent: string, hookEventName = promptEvent) {
  return (event: string, outcome: Outcome): Rendered => {
    if (event !== promptEvent) {
      return { exitCode: 0 };
    }

    if (outcome.blocked !== undefined) {
      return {
        stderr: `ACLP blocked this prompt: ${outcome.blocked}\n`,
        exitCode: 2,
      };
    }

    if (outcome.context.length === 0) {
      return { exitCode: 0 };
    }

    return {
      stdout: `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName,
          additionalContext: joined(outcome),
        },
      })}\n`,
      exitCode: 0,
    };
  };
}

export function mapCommandHook(
  event: string,
  payload: unknown,
  usage: (path: string) => Usage[],
): Message[] {
  return isCanonical(event)
    ? toMessages(event, claudeInput(payload), { guarded: true, usage })
    : [];
}

export const renderCommandHook = contextHook("UserPromptSubmit");
