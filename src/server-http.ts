import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_BODY_BYTES } from "./protocol/index.ts";

const READ_TIMEOUT_MS = 5_000;

export class HttpFailure extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isLoopback(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

export function validateTransport(
  request: IncomingMessage,
  authorization: string | undefined,
): void {
  if (
    !isLoopback(request.socket.remoteAddress) ||
    !isLoopback(request.socket.localAddress)
  ) {
    throw new HttpFailure(403, "Loopback HTTP required");
  }

  const host = request.headers.host;
  let hostCount = 0;

  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "host") {
      hostCount += 1;
    }
  }

  if (host === undefined || hostCount !== 1) {
    throw new HttpFailure(403, "Invalid Host");
  }

  let target: URL;

  try {
    target = new URL(`http://${host}`);
  } catch {
    throw new HttpFailure(403, "Invalid Host");
  }

  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.host.toLowerCase() !== host.toLowerCase() ||
    Number(target.port || "80") !== request.socket.localPort ||
    target.username !== "" ||
    target.password !== "" ||
    target.pathname !== "/" ||
    target.search !== "" ||
    target.hash !== "" ||
    !request.url?.startsWith("/") ||
    request.url.startsWith("//") ||
    request.headers.origin !== undefined
  ) {
    throw new HttpFailure(403, "Invalid request origin");
  }

  if (authorization !== undefined) {
    const expected = createHash("sha256").update(authorization).digest();
    const supplied = createHash("sha256")
      .update(request.headers.authorization ?? "")
      .digest();

    if (!timingSafeEqual(expected, supplied)) {
      throw new HttpFailure(401, "Authorization required");
    }
  }

  if (request.method !== "POST") {
    throw new HttpFailure(405, "POST required");
  }

  if (
    request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    throw new HttpFailure(415, "application/json required");
  }

  if (Number(request.headers["content-length"] ?? 0) > MAX_BODY_BYTES) {
    throw new HttpFailure(413, "Request body too large");
  }
}

export function readBody(request: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    const cleanup = (): void => {
      clearTimeout(timer);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("aborted", onAborted);
    };

    const fail = (error: Error): void => {
      cleanup();
      request.pause();
      reject(error);
    };

    const onData = (chunk: unknown): void => {
      if (!Buffer.isBuffer(chunk)) {
        fail(new HttpFailure(400, "Invalid request encoding"));
        return;
      }

      size += chunk.byteLength;

      if (size > MAX_BODY_BYTES) {
        fail(new HttpFailure(413, "Request body too large"));
        return;
      }

      chunks.push(chunk);
    };

    const onEnd = (): void => {
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };

    const onError = (error: Error): void => {
      fail(error);
    };

    const onAborted = (): void => {
      fail(new HttpFailure(400, "Incomplete request body"));
    };

    const timer = setTimeout(() => {
      fail(new HttpFailure(408, "Request body timed out"));
    }, READ_TIMEOUT_MS);

    timer.unref();
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
  });
}

export function sendEmpty(response: ServerResponse, status: number): void {
  if (!response.destroyed && !response.writableEnded) {
    response.statusCode = status;
    response.end();
  }
}

export function sendBytes(
  response: ServerResponse,
  status: number,
  body: Uint8Array,
): void {
  if (!response.destroyed && !response.writableEnded) {
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": body.byteLength,
    });
    response.end(body);
  }
}
