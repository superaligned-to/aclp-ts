import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, Message } from "../adapter.ts";
import { type Env, envPath } from "../env.ts";
import { isRecord } from "../files.ts";
import {
  type Canonical,
  failOpen,
  flat,
  type HookInput,
  joined,
  str,
  toMessages,
} from "./command-hooks.ts";

const HOOKS = [
  { event: "sessionStart", timeout: 5 },
  { event: "userPromptTransformed", timeout: 15 },
  { event: "preToolUse", timeout: 5 },
  { event: "postToolUse", timeout: 5 },
  { event: "postToolUseFailure", timeout: 5 },
  { event: "subagentStart", timeout: 5 },
  { event: "subagentStop", timeout: 5 },
  { event: "agentStop", timeout: 5 },
  { event: "sessionEnd", timeout: 5 },
] as const;

const NAMES: Readonly<Record<string, Canonical>> = {
  sessionStart: "SessionStart",
  userPromptTransformed: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  agentStop: "Stop",
  sessionEnd: "SessionEnd",
};

function home(env: Env): string {
  return envPath(env, "COPILOT_HOME", join(env.home, ".copilot"));
}

function args(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function errorText(value: unknown): string | undefined {
  return str(value) ?? (isRecord(value) ? str(value.message) : undefined);
}

function normalize(p: Record<string, unknown>): HookInput {
  const result = isRecord(p.toolResult) ? p.toolResult : {};

  const fields: HookInput = {};

  const sessionId = str(p.sessionId);

  const prompt = str(p.prompt);

  const tool = str(p.toolName);

  const error = errorText(p.error);

  const agent = str(p.agentName);

  const reason = str(p.source) ?? str(p.reason) ?? str(p.stopReason);

  if (sessionId !== undefined) fields.sessionId = sessionId;
  if (prompt !== undefined) fields.prompt = prompt;
  if (tool !== undefined) fields.tool = tool;
  if (p.toolArgs !== undefined) fields.input = args(p.toolArgs);
  if (result.textResultForLlm !== undefined)
    fields.output = result.textResultForLlm;
  if (error !== undefined) fields.error = error;
  if (agent !== undefined) fields.agentType = agent;
  if (reason !== undefined) fields.reason = reason;
  return fields;
}

async function map(event: string, payload: unknown): Promise<Message[]> {
  const name = NAMES[event];

  if (name === undefined || !isRecord(payload)) {
    return [];
  }

  const failed =
    name === "PostToolUse" &&
    isRecord(payload.toolResult) &&
    payload.toolResult.resultType === "failure";

  return toMessages(failed ? "PostToolUseFailure" : name, normalize(payload), {
    guarded: true,
  });
}

export const copilotCli: Adapter = {
  id: "copilot-cli",
  name: "GitHub Copilot CLI",
  support: "lifecycle",
  events: HOOKS.map((h) => h.event),
  detect: (env) => existsSync(home(env)),
  plan: (env, opts) => ({
    harness: "copilot-cli",
    scope: opts.scope,
    edits: [
      {
        kind: "file",
        path:
          opts.scope === "project"
            ? join(env.cwd, ".github", "hooks", "aclp.json")
            : join(home(env), "hooks", "aclp.json"),
        content: `${JSON.stringify(
          {
            version: 1,
            hooks: flat(opts.runtime, "copilot-cli", HOOKS, (command, t) => ({
              type: "command",
              command,
              timeoutSec: t,
            })),
          },
          null,
          2,
        )}\n`,
      },
    ],
    notes: [
      "Copilot CLI adds context by rewriting the transformed prompt; it cannot block a prompt, so a failed guarded request lets the prompt through without context.",
    ],
  }),
  map,
  render: (event, outcome, payload) => {
    if (event !== "userPromptTransformed") {
      return { exitCode: 0 };
    }

    const original = isRecord(payload) ? str(payload.transformedPrompt) : "";

    if (outcome.blocked !== undefined || outcome.context.length === 0) {
      return failOpen(outcome);
    }

    return {
      stdout: `${JSON.stringify({
        modifiedTransformedPrompt: `${joined(outcome)}\n\n${original ?? ""}`,
      })}\n`,
      exitCode: 0,
    };
  },
};
