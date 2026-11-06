import { randomUUID } from "node:crypto";
import type { OutgoingHttpHeaders } from "node:http";
import { endpoint, type Reply, send } from "./client-http.ts";
import {
  type ClientInfo,
  decodeJson,
  type EventMap,
  type EventMethod,
  encodeJson,
  isClientInfo,
  isResponse,
  type Result,
  validateParams,
} from "./protocol/index.ts";

export type Authorization = string | (() => string | Promise<string>);

export interface ClientOptions {
  url: string;
  authorization?: Authorization;
  timeoutMs?: number;
  onError?: (error: Error) => void;
  client?: ClientInfo;
  events?: readonly string[];
  ca?: string;
}

export interface Client {
  request<M extends EventMethod, T>(
    method: M,
    params: EventMap[M],
    result: Result<T>,
  ): Promise<T>;
  notify<M extends EventMethod>(method: M, params: EventMap[M]): void;
  flush(): Promise<void>;
}

const MAX_PENDING = 64;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function product(name: string, version: string | undefined): string {
  return version === undefined ? name : `${name}/${version}`;
}

export function clientHeader(client: ClientInfo): string {
  const tokens = [product(client.name, client.version)];

  if (client.harness !== undefined) {
    tokens.push(product(client.harness.name, client.harness.version));
  }

  return tokens.join(" ");
}

export function createClient(options: ClientOptions): Client {
  const url = endpoint(options.url);

  const timeoutMs = options.timeoutMs ?? 5_000;

  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647
  ) {
    throw new Error("ACLP timeout must be a positive finite timer duration.");
  }

  if (options.client !== undefined && !isClientInfo(options.client)) {
    throw new Error("ACLP client identity does not match ClientInfo.");
  }

  const identity =
    options.client === undefined ? undefined : clientHeader(options.client);

  if (identity !== undefined && /[^\t\x20-\x7e]/.test(identity)) {
    throw new Error("ACLP client identity must be printable ASCII.");
  }

  const consented =
    options.events === undefined ? undefined : new Set(options.events);

  const pending = new Set<Promise<void>>();

  const failures: Error[] = [];

  let active = 0;

  function prepare<M extends EventMethod>(
    method: M,
    params: EventMap[M],
    id?: string,
  ): Uint8Array {
    if (active >= MAX_PENDING) {
      throw new Error("ACLP client capacity exhausted.");
    }

    if (
      consented !== undefined &&
      !consented.has(method) &&
      !method.startsWith("client.")
    ) {
      throw new Error(`ACLP method ${method} is not consented.`);
    }

    const body = encodeJson({
      jsonrpc: "2.0",
      method,
      params,
      ...(id === undefined ? {} : { id }),
    });

    if (!validateParams(method, params)) {
      throw new Error(`Invalid ACLP parameters for ${method}.`);
    }

    return body;
  }

  async function post(body: Uint8Array, deadline: number): Promise<Reply> {
    const headers: OutgoingHttpHeaders = {
      "content-type": "application/json",
      "content-length": body.byteLength,
    };

    const authorization =
      typeof options.authorization === "function"
        ? await options.authorization()
        : options.authorization;

    if (authorization !== undefined) {
      headers.authorization = authorization;
    }

    if (identity !== undefined) {
      headers["aclp-client"] = identity;
    }

    return send(url, {
      method: "POST",
      headers,
      body,
      deadline,
      ...(options.ca === undefined ? {} : { ca: options.ca }),
    });
  }

  async function request<M extends EventMethod, T>(
    method: M,
    params: EventMap[M],
    result: Result<T>,
  ): Promise<T> {
    const deadline = performance.now() + timeoutMs;

    const id = randomUUID();

    const body = prepare(method, params, id);

    active += 1;

    try {
      const response = await post(body, deadline);

      if (response.status !== 200) {
        throw new Error(`ACLP request failed with HTTP ${response.status}.`);
      }

      if (!response.json) {
        throw new Error("ACLP result requires Content-Type application/json.");
      }

      const message = decodeJson(response.body);

      if (!isResponse(message) || message.id !== id) {
        throw new Error("Invalid or mismatched ACLP response.");
      }

      if (message.error !== undefined) {
        throw new Error(
          `ACLP callback failed (${message.error.code}): ${message.error.message}`,
        );
      }

      if (!result.validate(message.result)) {
        throw new Error(
          "ACLP callback result does not match its installed schema.",
        );
      }

      if (performance.now() >= deadline) {
        throw new Error("ACLP request deadline exceeded.");
      }

      return message.result;
    } finally {
      active -= 1;
    }
  }

  function notify<M extends EventMethod>(method: M, params: EventMap[M]): void {
    const deadline = performance.now() + timeoutMs;

    const body = prepare(method, params);

    active += 1;

    const task = Promise.resolve()
      .then(() => post(body, deadline))
      .then((response) => {
        if (response.status !== 202 || response.body.byteLength !== 0) {
          throw new Error(
            `ACLP notification was not admitted (HTTP ${response.status}).`,
          );
        }
      })
      .catch((error: unknown) => {
        const failure = asError(error);

        if (failures.length < MAX_PENDING) {
          failures.push(failure);
        }

        try {
          if (options.onError === undefined) {
            process.emitWarning(failure);
          } else {
            options.onError(failure);
          }
        } catch (diagnosticError) {
          process.emitWarning(asError(diagnosticError));
        }
      })
      .finally(() => {
        active -= 1;
        pending.delete(task);
      });

    pending.add(task);
  }

  async function flush(): Promise<void> {
    while (pending.size > 0) {
      await Promise.all(pending);
    }

    if (failures.length > 0) {
      throw new AggregateError(
        failures.splice(0),
        "ACLP notification delivery failed.",
      );
    }
  }

  return { request, notify, flush };
}
