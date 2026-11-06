import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer as createHttpServer } from "node:http";
import {
  decodeJson,
  type EventMap,
  type EventMethod,
  encodeJson,
  isEnvelope,
  isEventMethod,
  isRecord,
  type Result,
  validateParams,
} from "./protocol/index.ts";
import {
  HttpFailure,
  readBody,
  sendBytes,
  sendEmpty,
  validateTransport,
} from "./server-http.ts";

const MAX_ACTIVE_CALLBACKS = 32;

export interface Callback<P> {
  handle: (params: P) => unknown | Promise<unknown>;
  result?: Result<unknown>;
}

export type Callbacks = {
  [M in EventMethod]?: Callback<EventMap[M]>;
};

export interface ServerOptions {
  authorization?: string;
  onError?: (error: Error) => void;
}

function requestId(value: unknown): string | null {
  if (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    Buffer.byteLength(value.id) <= 128
  ) {
    return value.id;
  }

  return null;
}

function isNotification(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.jsonrpc === "2.0" &&
    typeof value.method === "string" &&
    value.method.length > 0 &&
    !Object.hasOwn(value, "id")
  );
}

function sendError(
  response: ServerResponse,
  status: number,
  id: string | null,
  code: number,
  message: string,
): void {
  sendBytes(
    response,
    status,
    encodeJson({ jsonrpc: "2.0", id, error: { code, message } }),
  );
}

export function createServer(
  callbacks: Callbacks,
  options: ServerOptions = {},
): Server {
  const scheme = options.authorization?.match(
    /^([!#$%&'*+.^_`|~0-9A-Za-z-]+) +\S[^\r\n]*$/,
  )?.[1];

  if (options.authorization !== undefined && scheme === undefined) {
    throw new Error("Authorization must contain an HTTP scheme and credential");
  }

  let active = 0;

  const report = (error: unknown): void => {
    const diagnostic =
      error instanceof Error
        ? error
        : new Error("Callback failed", { cause: error });

    try {
      if (options.onError === undefined) {
        process.emitWarning(diagnostic);
      } else {
        options.onError(diagnostic);
      }
    } catch (failure) {
      process.emitWarning(
        new Error("Callback diagnostic failed", { cause: failure }),
      );
    }
  };

  const dispatch = async <M extends EventMethod>(
    method: M,
    params: EventMap[M],
    id: string | undefined,
    response: ServerResponse,
    release: () => void,
  ): Promise<boolean> => {
    const callback = callbacks[method];

    if (
      callback === undefined ||
      (id !== undefined && callback.result === undefined)
    ) {
      if (id === undefined) {
        sendEmpty(response, 400);
      } else {
        sendError(response, 200, id, -32601, "Method not found");
      }

      return false;
    }

    if (id === undefined) {
      void Promise.resolve()
        .then(() => callback.handle(params))
        .catch(report)
        .finally(release);
      sendEmpty(response, 202);
      return true;
    }

    try {
      const result = await callback.handle(params);

      if (callback.result === undefined || !callback.result.validate(result)) {
        throw new Error("Callback result does not satisfy its schema");
      }

      sendBytes(response, 200, encodeJson({ jsonrpc: "2.0", id, result }));
    } catch (error) {
      report(error);
      sendError(response, 200, id, -32603, "Internal error");
    }

    return false;
  };

  const receive = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    let retained = false;
    let reserved = false;

    const release = (): void => {
      if (reserved) {
        reserved = false;
        active -= 1;
      }
    };

    try {
      validateTransport(request, options.authorization);

      if (active >= MAX_ACTIVE_CALLBACKS) {
        throw new HttpFailure(429, "Admission capacity exhausted");
      }

      active += 1;
      reserved = true;

      const body = await readBody(request);
      let message: unknown;

      try {
        message = decodeJson(body);
      } catch {
        sendError(response, 400, null, -32700, "Parse error");
        return;
      }

      if (!isEnvelope(message)) {
        if (isNotification(message)) {
          sendEmpty(response, 400);
        } else {
          sendError(
            response,
            400,
            requestId(message),
            -32600,
            "Invalid request",
          );
        }

        return;
      }

      if (!isEventMethod(message.method)) {
        if (message.id === undefined) {
          sendEmpty(response, 400);
        } else {
          sendError(response, 200, message.id, -32601, "Method not found");
        }

        return;
      }

      if (!validateParams(message.method, message.params)) {
        if (message.id === undefined) {
          sendEmpty(response, 400);
        } else {
          sendError(response, 200, message.id, -32602, "Invalid params");
        }

        return;
      }

      retained = await dispatch(
        message.method,
        message.params,
        message.id,
        response,
        release,
      );
    } catch (error) {
      response.setHeader("Connection", "close");
      request.resume();

      if (error instanceof HttpFailure) {
        if (error.status === 401 && scheme !== undefined) {
          response.setHeader("WWW-Authenticate", `${scheme} realm="aclp"`);
        }

        if (error.status === 405) {
          response.setHeader("Allow", "POST");
        }

        sendEmpty(response, error.status);
      } else {
        report(error);
        sendEmpty(response, 400);
      }
    } finally {
      if (!retained) {
        release();
      }
    }
  };

  const server = createHttpServer(
    {
      headersTimeout: 5_000,
      requestTimeout: 5_000,
      connectionsCheckingInterval: 1_000,
      maxHeaderSize: 16_384,
    },
    (request, response) => {
      void receive(request, response).catch(report);
    },
  );

  server.maxConnections = 64;
  return server;
}
