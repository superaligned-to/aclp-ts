import type {
  ClientRequest,
  IncomingMessage,
  OutgoingHttpHeaders,
} from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { MAX_BODY_BYTES } from "./protocol/index.ts";

export interface Exchange {
  method: "GET" | "POST";
  headers: OutgoingHttpHeaders;
  body?: Uint8Array;
  deadline: number;
  ca?: string;
}

export interface Reply {
  status: number;
  json: boolean;
  body: Uint8Array;
}

export function endpoint(value: string): URL {
  const url = new URL(value);

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "ACLP requires an HTTP or HTTPS endpoint without URL credentials or a fragment.",
    );
  }

  return url;
}

function isJson(response: IncomingMessage): boolean {
  return (
    response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json"
  );
}

function open(url: URL, exchange: Exchange): ClientRequest {
  const hostname =
    url.hostname === "localhost"
      ? "127.0.0.1"
      : url.hostname.replace(/^\[|\]$/g, "");

  const options = {
    hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method: exchange.method,
    headers: { host: url.host, ...exchange.headers },
    maxHeaderSize: 16_384,
  };

  if (url.protocol === "http:") {
    return httpRequest(options);
  }

  return httpsRequest({
    ...options,
    ...(url.hostname.startsWith("[") ? {} : { servername: url.hostname }),
    ...(exchange.ca === undefined ? {} : { ca: exchange.ca }),
  });
}

export async function send(url: URL, exchange: Exchange): Promise<Reply> {
  const remaining = exchange.deadline - performance.now();

  if (remaining <= 0) {
    throw new Error("ACLP request deadline exceeded.");
  }

  return new Promise((resolve, reject) => {
    let complete = false;

    const fail = (error: Error): void => {
      complete = true;
      reject(error);
    };

    const request = open(url, exchange);

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

        complete = true;
        resolve({
          status,
          json: isJson(response),
          body: Buffer.concat(chunks),
        });
      });
    });

    request.end(exchange.body);
  });
}
