import { readFileSync, statSync } from "node:fs";
import type { Message } from "../adapter.ts";
import { isRecord } from "../files.ts";

const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;

export interface Usage {
  id?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function lines(path: string): unknown[] {
  try {
    if (statSync(path).size > MAX_TRANSCRIPT_BYTES) {
      return [];
    }

    return readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line) => {
        try {
          return line.trim() === "" ? [] : [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function promptLine(entry: Record<string, unknown>): boolean {
  if (
    entry.type !== "user" ||
    !isRecord(entry.message) ||
    entry.isMeta === true
  ) {
    return false;
  }

  const content = entry.message.content;

  return (
    typeof content === "string" ||
    (Array.isArray(content) &&
      content.some((c) => isRecord(c) && c.type === "text"))
  );
}

export function claudeTurnUsage(path: string): Usage[] {
  const entries = lines(path).filter(isRecord);

  let start = 0;

  entries.forEach((entry, idx) => {
    if (promptLine(entry)) {
      start = idx + 1;
    }
  });

  const seen = new Map<string, Usage>();

  for (const entry of entries.slice(start)) {
    const message = entry.message;

    if (
      entry.type !== "assistant" ||
      !isRecord(message) ||
      !isRecord(message.usage)
    ) {
      continue;
    }

    const id =
      typeof message.id === "string" ? message.id : `line-${seen.size}`;

    const u = message.usage;

    const cached = count(u.cache_read_input_tokens);

    seen.set(id, {
      id,
      ...(typeof message.model === "string" ? { model: message.model } : {}),
      inputTokens:
        count(u.input_tokens) + count(u.cache_creation_input_tokens) + cached,
      outputTokens: count(u.output_tokens),
      cachedInputTokens: cached,
    });
  }

  return [...seen.values()];
}

export function codexTurnUsage(path: string): Usage[] {
  const entries = lines(path).filter(isRecord);

  const out: Usage[] = [];

  let model: string | undefined;

  for (const entry of entries) {
    const payload = isRecord(entry.payload) ? entry.payload : {};

    if (entry.type === "turn_context" && typeof payload.model === "string") {
      model = payload.model;
    }

    if (entry.type !== "event_msg") {
      continue;
    }

    if (payload.type === "user_message") {
      out.length = 0;
    }

    const usage = isRecord(payload.info)
      ? payload.info.last_token_usage
      : undefined;

    if (payload.type === "token_count" && isRecord(usage)) {
      out.push({
        ...(model === undefined ? {} : { model }),
        inputTokens: count(usage.input_tokens),
        outputTokens: count(usage.output_tokens),
        cachedInputTokens: count(usage.cached_input_tokens),
      });
    }
  }

  return out;
}

export function usageMessages(
  sessionId: string,
  usages: Usage[],
  agentId?: string,
): Message[] {
  return usages.map((u) => ({
    method: "model.finished",
    params: {
      sessionId,
      ...(agentId === undefined ? {} : { agentId }),
      ...(u.model === undefined ? {} : { model: { name: u.model } }),
      ...(u.id === undefined ? {} : { modelCallId: u.id }),
      outcome: { status: "succeeded" },
      usage: {
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cachedInputTokens: u.cachedInputTokens,
      },
    },
  }));
}
