import assert from "node:assert/strict";
import { once } from "node:events";
import type { ClientRequest, IncomingHttpHeaders, Server } from "node:http";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { defineResult, MAX_BODY_BYTES } from "./protocol/index.ts";
import { createServer } from "./server.ts";

const contextResult = defineResult<{ context: string[] }>({
  type: "object",
  properties: { context: { type: "array", items: { type: "string" } } },
  required: ["context"],
  additionalProperties: false,
});

const input = {
  jsonrpc: "2.0",
  method: "input.submitted",
  params: {
    sessionId: "session-1",
    content: [{ type: "text", text: "class" }],
  },
  id: "input-1",
};

const tool = {
  jsonrpc: "2.0",
  method: "tool.finished",
  params: {
    sessionId: "session-1",
    call: { name: "shell" },
    outcome: { status: "succeeded" },
  },
};

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("HTTP test server has no TCP address");
  }

  return `http://127.0.0.1:${address.port}/events`;
}

async function close(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });

  server.closeAllConnections();
  await closed;
}

function post(
  url: string,
  body: string | Uint8Array,
  headers: Record<string, string> = {},
  method = "POST",
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
    });

    request.on("error", reject);
    request.on("response", (response) => {
      let text = "";

      response.setEncoding("utf8");
      response.on("data", (chunk: unknown) => {
        if (typeof chunk !== "string") {
          reject(new Error("Test response was not decoded as UTF-8"));
          return;
        }

        text += chunk;
      });
      response.once("error", reject);
      response.once("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: text,
        });
      });
    });

    request.end(body);
  });
}

test("requests return a validated result with the matching id", async () => {
  const server = createServer({
    "input.submitted": {
      result: contextResult,
      handle: ({ content }) => ({ context: [content.length.toString()] }),
    },
  });

  const url = await listen(server);

  try {
    const reply = await post(url, JSON.stringify(input));

    assert.equal(reply.status, 200);
    assert.deepEqual(JSON.parse(reply.body), {
      jsonrpc: "2.0",
      id: "input-1",
      result: { context: ["1"] },
    });
  } finally {
    await close(server);
  }
});

test("notifications acknowledge admission without awaiting callback completion", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let finished = false;

  const server = createServer({
    "tool.finished": {
      handle: async () => {
        entered.resolve();
        await release.promise;
        finished = true;
      },
    },
  });

  const url = await listen(server);

  try {
    const reply = await post(url, JSON.stringify(tool));
    assert.equal(reply.status, 202);
    assert.equal(reply.body, "");
    await entered.promise;
    assert.equal(finished, false);
    release.resolve();
    await setImmediate();
    assert.equal(finished, true);
  } finally {
    release.resolve();
    await close(server);
  }
});

test("callback failures, invalid results and oversized results become internal errors", async () => {
  for (const handle of [
    () => {
      throw new Error("Private failure detail");
    },
    () => ({ context: "invalid" }),
    () => ({ context: ["x".repeat(MAX_BODY_BYTES)] }),
  ]) {
    const errors: Error[] = [];
    const server = createServer(
      { "input.submitted": { result: contextResult, handle } },
      { onError: (error) => errors.push(error) },
    );
    const url = await listen(server);

    try {
      const reply = await post(url, JSON.stringify(input));

      assert.equal(reply.status, 200);
      assert.deepEqual(JSON.parse(reply.body), {
        jsonrpc: "2.0",
        id: "input-1",
        error: { code: -32603, message: "Internal error" },
      });
      assert.equal(errors.length, 1);
      assert.equal(reply.body.includes("Private failure"), false);
    } finally {
      await close(server);
    }
  }
});

test("invalid messages never invoke callbacks and notification errors have empty bodies", async () => {
  let calls = 0;
  const server = createServer({
    "input.submitted": {
      result: contextResult,
      handle: () => {
        calls += 1;
        return { context: [] };
      },
    },
  });
  const url = await listen(server);

  const cases: [string | Uint8Array, number, number | undefined][] = [
    ["{", 400, -32700],
    [new Uint8Array([255]), 400, -32700],
    [
      '{"jsonrpc":"2.0","id":"x","id":"y","method":"input.submitted","params":{}}',
      400,
      -32700,
    ],
    [JSON.stringify({ ...input, extra: true }), 400, -32600],
    [JSON.stringify({ ...input, id: "é".repeat(65) }), 400, -32600],
    [JSON.stringify({ ...input, method: "unknown.event" }), 200, -32601],
    [JSON.stringify({ ...input, params: {} }), 200, -32602],
    [JSON.stringify({ ...tool, method: "unknown.event" }), 400, undefined],
    [JSON.stringify({ ...tool, params: {} }), 400, undefined],
    [JSON.stringify({ ...tool, extra: true }), 400, undefined],
  ];

  try {
    for (const [body, status, code] of cases) {
      const reply = await post(url, body);

      assert.equal(reply.status, status);

      if (code === undefined) {
        assert.equal(reply.body, "");
      } else {
        const parsed: unknown = JSON.parse(reply.body);
        assert.equal(typeof parsed, "object");
        assert.match(reply.body, new RegExp(`"code":${code}`));
      }
    }

    assert.equal(calls, 0);
  } finally {
    await close(server);
  }
});

test("notification-only callbacks reject requests before executing", async () => {
  let calls = 0;
  const server = createServer({
    "tool.finished": {
      handle: () => {
        calls += 1;
      },
    },
  });
  const url = await listen(server);

  try {
    const reply = await post(url, JSON.stringify({ ...tool, id: "request-1" }));

    assert.equal(reply.status, 200);
    assert.deepEqual(JSON.parse(reply.body), {
      jsonrpc: "2.0",
      id: "request-1",
      error: { code: -32601, message: "Method not found" },
    });
    assert.equal(calls, 0);
  } finally {
    await close(server);
  }
});

test("configured authorization and loopback Host checks precede dispatch", async () => {
  let calls = 0;
  const server = createServer(
    {
      "tool.finished": {
        handle: () => {
          calls += 1;
        },
      },
    },
    { authorization: "Bearer local-test-credential" },
  );
  const url = await listen(server);

  try {
    const denied = await post(url, JSON.stringify(tool));
    assert.equal(denied.status, 401);
    assert.equal(denied.headers["www-authenticate"], 'Bearer realm="aclp"');
    assert.equal(denied.body, "");

    const wrong = await post(url, JSON.stringify(tool), {
      Authorization: "Bearer wrong",
    });
    assert.equal(wrong.status, 401);

    const invalidHost = await post(url, JSON.stringify(tool), {
      Authorization: "Bearer local-test-credential",
      Host: "example.com",
    });
    assert.equal(invalidHost.status, 403);

    const browser = await post(url, JSON.stringify(tool), {
      Authorization: "Bearer local-test-credential",
      Origin: "https://example.com",
    });
    assert.equal(browser.status, 403);
    assert.equal(calls, 0);

    const accepted = await post(url, JSON.stringify(tool), {
      Authorization: "Bearer local-test-credential",
    });
    assert.equal(accepted.status, 202);
    await setImmediate();
    assert.equal(calls, 1);
  } finally {
    await close(server);
  }

  assert.throws(() => createServer({}, { authorization: "missing-scheme" }));
  assert.throws(() =>
    createServer({}, { authorization: "Bearer credential\r\nHost: attacker" }),
  );
});

test("HTTP method and content type are bounded before callbacks", async () => {
  const server = createServer({});
  const url = await listen(server);

  try {
    assert.equal((await post(url, "", {}, "GET")).status, 405);
    assert.equal(
      (await post(url, "{}", { "Content-Type": "text/plain" })).status,
      415,
    );
  } finally {
    await close(server);
  }
});

test("notification callback failures remain diagnostics", async () => {
  const reported = Promise.withResolvers<Error>();
  const server = createServer(
    {
      "tool.finished": {
        handle: () => {
          throw new Error("Observation failed");
        },
      },
    },
    { onError: reported.resolve },
  );
  const url = await listen(server);

  try {
    const reply = await post(url, JSON.stringify(tool));

    assert.equal(reply.status, 202);
    assert.equal(reply.body, "");
    assert.equal((await reported.promise).message, "Observation failed");
  } finally {
    await close(server);
  }
});

test("callback capacity remains reserved after callers disconnect", async () => {
  const admitted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const drained = Promise.withResolvers<void>();
  let entered = 0;
  let completed = 0;

  const server = createServer({
    "input.submitted": {
      result: contextResult,
      handle: async () => {
        entered += 1;
        if (entered === 32) {
          admitted.resolve();
        }
        await release.promise;
        completed += 1;
        if (completed === 32) {
          drained.resolve();
        }
        return { context: [] };
      },
    },
  });
  const url = await listen(server);
  const pending: ClientRequest[] = [];

  try {
    for (let index = 0; index < 32; index += 1) {
      const request = httpRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      request.on("error", () => undefined);
      request.end(JSON.stringify({ ...input, id: `input-${index}` }));
      pending.push(request);
    }

    await admitted.promise;
    for (const request of pending) {
      request.destroy();
    }
    await setImmediate();

    assert.equal((await post(url, JSON.stringify(input))).status, 429);
    release.resolve();
    await drained.promise;
    await setImmediate();
    assert.equal((await post(url, JSON.stringify(input))).status, 200);
  } finally {
    release.resolve();
    for (const request of pending) {
      request.destroy();
    }
    await close(server);
  }
});
