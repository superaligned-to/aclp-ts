import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import {
  decodeJson,
  type EventMap,
  type EventMethod,
  encodeJson,
  isResponse,
  MAX_BODY_BYTES,
  type Result,
  validateParams,
} from "./protocol/index.ts";

export interface ClientOptions {
  url: string;
  authorization?: string;
  timeoutMs?: number;
  onError?: (error: Error) => void;
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

function endpoint(value: string): URL {
  const url = new URL(value);

  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "ACLP requires a loopback HTTP endpoint without URL credentials or a fragment.",
    );
  }

  return url;
}

async function post(
  url: URL,
  body: Uint8Array,
  authorization: string | undefined,
  deadline: number,
): Promise<{ status: number; body: Uint8Array }> {
  const remaining = deadline - performance.now();

  if (remaining <= 0) {
    throw new Error("ACLP request deadline exceeded.");
  }

  return new Promise((resolve, reject) => {
    let complete = false;

    const fail = (error: Error): void => {
      complete = true;
      reject(error);
    };

    const request = httpRequest({
      hostname:
        url.hostname === "localhost"
          ? "127.0.0.1"
          : url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port || 80,
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers: {
        host: url.host,
        "content-type": "application/json",
        "content-length": body.byteLength,
        ...(authorization === undefined ? {} : { authorization }),
      },
      maxHeaderSize: 16_384,
    });

    const timer = setTimeout(() => {
      request.destroy(new Error("ACLP request deadline exceeded."));
    }, remaining);

    timer.unref();
    request.once("error", fail);
    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      fail(new Error("ACLP does not support HTTP protocol upgrades."));
    });
    request.once("close", () => {
      clearTimeout(timer);

      if (!complete) {
        fail(new Error("ACLP connection closed before a complete response."));
      }
    });
    request.once("response", (response) => {
      const chunks: Uint8Array[] = [];

      let length = 0;

      response.on("data", (chunk: unknown) => {
        if (!(chunk instanceof Uint8Array)) {
          request.destroy(new Error("ACLP response contains invalid bytes."));
          return;
        }

        length += chunk.byteLength;

        if (length > MAX_BODY_BYTES) {
          request.destroy(new Error("ACLP response exceeds 1 MiB."));
          response.destroy();
          return;
        }

        chunks.push(chunk);
      });

      response.once("error", fail);
      response.once("aborted", () =>
        reject(new Error("ACLP response was interrupted.")),
      );
      response.once("end", () => {
        const status = response.statusCode;

        if (status === undefined) {
          reject(new Error("ACLP response has no HTTP status."));
          return;
        }

        if (
          status === 200 &&
          response.headers["content-type"]
            ?.split(";", 1)[0]
            ?.trim()
            .toLowerCase() !== "application/json"
        ) {
          reject(
            new Error("ACLP result requires Content-Type application/json."),
          );
          return;
        }

        complete = true;
        resolve({ status, body: Buffer.concat(chunks) });
      });
    });

    request.end(body);
  });
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
      const response = await post(url, body, options.authorization, deadline);

      if (response.status !== 200) {
        throw new Error(`ACLP request failed with HTTP ${response.status}.`);
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
      .then(() => post(url, body, options.authorization, deadline))
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
