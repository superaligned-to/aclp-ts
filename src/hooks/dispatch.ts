import { join } from "node:path";
import {
  type Client,
  type ClientInfo,
  createClient,
  defineResult,
  type EventMap,
  type EventMethod,
  onErrorFor,
} from "../index.ts";
import type { HarnessId, Message, Outcome } from "./adapter.ts";
import { configDir, type Env } from "./env.ts";
import { readJson, writeJson } from "./files.ts";
import { authorization } from "./oauth.ts";
import { type ServerEntry, serversFor } from "./registry.ts";
import { CLIENT_NAME, VERSION } from "./version.ts";

export const NOTIFY_TIMEOUT_MS = 5_000;

export const REQUEST_TIMEOUT_MS = 10_000;

export const MAX_CONTEXT_BYTES = 32_768;

interface ContextReply {
  context: { content: string }[];
}

export const contextResult = defineResult<ContextReply>({
  type: "object",
  properties: {
    context: {
      type: "array",
      items: {
        type: "object",
        properties: { content: { type: "string" } },
        required: ["content"],
      },
    },
  },
  required: ["context"],
});

export interface Health {
  at: string;
  ok: boolean;
  error?: string;
}

export function healthPath(env: Env): string {
  return join(configDir(env), "health.json");
}

export function readHealth(env: Env): Record<string, Health> {
  const raw = readJson(healthPath(env)) ?? {};

  const out: Record<string, Health> = {};

  for (const [name, value] of Object.entries(raw)) {
    if (
      typeof value === "object" &&
      value !== null &&
      "ok" in value &&
      "at" in value
    ) {
      const { ok, at } = value;

      if (typeof ok === "boolean" && typeof at === "string") {
        out[name] = {
          ok,
          at,
          ...("error" in value && typeof value.error === "string"
            ? { error: value.error }
            : {}),
        };
      }
    }
  }

  return out;
}

function recordHealth(env: Env, results: Map<string, Error | undefined>): void {
  if (results.size === 0) {
    return;
  }

  try {
    const health = readHealth(env);

    const at = new Date().toISOString();

    for (const [name, error] of results) {
      health[name] =
        error === undefined
          ? { at, ok: true }
          : { at, ok: false, error: error.message };
    }

    writeJson(healthPath(env), health, 0o600);
  } catch {
    return;
  }
}

export function clientInfo(
  harness: HarnessId,
  harnessVersion?: string,
): ClientInfo {
  return {
    name: CLIENT_NAME,
    version: VERSION,
    harness: {
      name: harness,
      ...(harnessVersion === undefined ? {} : { version: harnessVersion }),
    },
  };
}

export function connect(
  env: Env,
  server: ServerEntry,
  client: ClientInfo,
  timeoutMs: number,
  onError: (error: Error) => void,
): Client {
  return createClient({
    url: server.endpoint,
    timeoutMs,
    client,
    onError,
    ...(server.auth.type === "none"
      ? {}
      : {
          authorization: async () => {
            const value = await authorization(env, server);

            if (value === undefined) {
              throw new Error(`${server.name} has no credential`);
            }

            return value;
          },
        }),
  });
}

function notify<M extends EventMethod>(
  client: Client,
  message: { method: M; params: EventMap[M] },
): void {
  client.notify(message.method, message.params);
}

function request<M extends EventMethod>(
  client: Client,
  message: { method: M; params: EventMap[M] },
): Promise<ContextReply> {
  return client.request(message.method, message.params, contextResult);
}

function cap(parts: string[]): string[] {
  const out: string[] = [];

  let used = 0;

  for (const part of parts) {
    const size = Buffer.byteLength(part);

    if (part.trim() === "" || used + size > MAX_CONTEXT_BYTES) {
      continue;
    }

    used += size;
    out.push(part);
  }

  return out;
}

export interface DispatchOptions {
  harnessVersion?: string;
  servers?: ServerEntry[];
}

export async function dispatch(
  env: Env,
  harness: HarnessId,
  messages: Message[],
  opts: DispatchOptions = {},
): Promise<Outcome> {
  const servers = opts.servers ?? serversFor(env, harness);

  const info = clientInfo(harness, opts.harnessVersion);

  const results = new Map<string, Error | undefined>();

  const context: string[] = [];

  let blocked: string | undefined;

  const work = servers.map(async (server) => {
    const wanted = messages.filter((m) => server.events.includes(m.method));

    if (wanted.length === 0) {
      return;
    }

    const guarded = wanted.filter(
      (m) => m.guarded === true && server.requests.includes(m.method),
    );

    const failures: Error[] = [];

    const timeout = guarded.length > 0 ? REQUEST_TIMEOUT_MS : NOTIFY_TIMEOUT_MS;

    try {
      const client = connect(env, server, info, timeout, (error) =>
        failures.push(error),
      );

      for (const message of wanted) {
        if (guarded.includes(message)) {
          try {
            const reply = await request(client, message);

            context.push(...reply.context.map((c) => c.content));
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : String(error);

            if (onErrorFor(message.method, server.onError) === "deny") {
              blocked ??= `${server.name}: ${reason}`;
            }

            failures.push(error instanceof Error ? error : new Error(reason));
          }
        } else {
          notify(client, message);
        }
      }

      await client.flush().catch(() => undefined);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));

      if (
        guarded.some((m) => onErrorFor(m.method, server.onError) === "deny")
      ) {
        blocked ??= `${server.name}: ${failures[0]?.message ?? "failed"}`;
      }
    }

    results.set(server.name, failures[0]);
  });

  await Promise.all(work);
  recordHealth(env, results);

  return blocked === undefined
    ? { context: cap(context) }
    : { context: [], blocked };
}
