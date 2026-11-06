import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import test from "node:test";
import { MAX_BODY_BYTES } from "./protocol/index.ts";
import { createServer } from "./server.ts";

test("incomplete HTTP bodies time out", { timeout: 8_000 }, async (context) => {
  const server = createServer({});

  context.after(async () => {
    const closed = once(server, "close");

    server.closeAllConnections();
    server.close();
    await closed;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("HTTP test server has no TCP address");
  }

  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${address.port}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "100",
      },
    });

    request.on("error", reject);
    request.on("response", (response) => {
      response.resume();
      response.once("error", reject);
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.write("{");
  });

  assert.equal(status, 408);
});

function rawStatus(port: number, message: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");

    let text = "";

    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString("latin1");
    });
    socket.once("error", reject);
    socket.once("close", () => {
      resolve(Number(text.split(" ", 2)[1]));
    });
    socket.write(message);
  });
}

test("oversized bodies are rejected whether declared or streamed", async (context) => {
  const server = createServer({});

  context.after(async () => {
    const closed = once(server, "close");

    server.closeAllConnections();
    server.close();
    await closed;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("HTTP test server has no TCP address");
  }

  const head = `POST /events HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\nContent-Type: application/json\r\n`;

  const chunk = "x".repeat(MAX_BODY_BYTES);

  // Each message ends at the byte that breaks the limit; unread bytes make the server reset the connection.
  const declared = `${head}Content-Length: ${MAX_BODY_BYTES + 1}\r\n\r\n`;

  const streamed = `${head}Transfer-Encoding: chunked\r\n\r\n${chunk.length.toString(16)}\r\n${chunk}\r\n1\r\nx`;

  assert.equal(await rawStatus(address.port, declared), 413);
  assert.equal(await rawStatus(address.port, streamed), 413);
});
