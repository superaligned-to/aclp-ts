import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { HarnessId } from "./adapter.ts";
import type { DispatchOptions } from "./dispatch.ts";
import type { Env } from "./env.ts";
import { isRecord } from "./files.ts";
import { fire } from "./fire.ts";
import { VERSION } from "./version.ts";

export const CONTEXT_TOOL = "aclp_context";

const PROTOCOL = "2025-06-18";

const TOOL = {
  name: CONTEXT_TOOL,
  description:
    "Fetch context from the user's ACLP servers (for example long-term memory) for the current request. Call it at the start of a task with the user's request as the query, and again when the topic changes.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The user's request, in their words.",
      },
    },
    required: ["query"],
  },
};

type Reply = { result: unknown } | { error: { code: number; message: string } };

export interface McpOptions extends DispatchOptions {
  sessionId?: string;
}

async function call(
  harness: HarnessId,
  sessionId: string,
  params: unknown,
  env: Env,
  opts: DispatchOptions,
): Promise<Reply> {
  const args = isRecord(params) ? params.arguments : undefined;

  const query = isRecord(args) ? args.query : undefined;

  if (!isRecord(params) || params.name !== CONTEXT_TOOL) {
    return { error: { code: -32602, message: "Unknown tool" } };
  }

  if (typeof query !== "string" || query.trim() === "") {
    return { error: { code: -32602, message: "query must be a string" } };
  }

  const outcome = await fire(
    harness,
    "context",
    { session_id: sessionId, prompt: query },
    env,
    opts,
  );

  if (outcome.blocked !== undefined) {
    return {
      result: {
        content: [{ type: "text", text: `ACLP failed: ${outcome.blocked}` }],
        isError: true,
      },
    };
  }

  const text =
    outcome.context.length === 0
      ? "No context from ACLP servers."
      : outcome.context.join("\n\n");

  return { result: { content: [{ type: "text", text }] } };
}

async function handle(
  harness: HarnessId,
  sessionId: string,
  method: string,
  params: unknown,
  env: Env,
  opts: DispatchOptions,
): Promise<Reply> {
  switch (method) {
    case "initialize": {
      const requested = isRecord(params) ? params.protocolVersion : undefined;

      return {
        result: {
          protocolVersion: typeof requested === "string" ? requested : PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: "aclp", version: VERSION },
        },
      };
    }
    case "ping":
      return { result: {} };
    case "tools/list":
      return { result: { tools: [TOOL] } };
    case "tools/call":
      return call(harness, sessionId, params, env, opts);
    default:
      return { error: { code: -32601, message: `Unknown method ${method}` } };
  }
}

export async function serveMcp(
  harness: HarnessId,
  input: NodeJS.ReadableStream,
  write: (line: string) => void,
  env: Env,
  opts: McpOptions = {},
): Promise<void> {
  const sessionId = opts.sessionId ?? randomUUID();

  const pending: Promise<void>[] = [];

  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (line.trim() === "") {
      continue;
    }

    let msg: unknown;

    try {
      msg = JSON.parse(line);
    } catch {
      write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
      );
      continue;
    }

    if (!isRecord(msg) || typeof msg.method !== "string") {
      continue;
    }

    const { id, method, params } = msg;

    if (method === "initialize") {
      pending.push(
        fire(harness, "initialize", { session_id: sessionId }, env, opts).then(
          () => undefined,
        ),
      );
    }

    if (id === undefined) {
      continue;
    }

    pending.push(
      handle(harness, sessionId, method, params, env, opts).then((reply) =>
        write(`${JSON.stringify({ jsonrpc: "2.0", id, ...reply })}\n`),
      ),
    );
  }

  await Promise.all(pending);
  await fire(harness, "shutdown", { session_id: sessionId }, env, opts);
}
