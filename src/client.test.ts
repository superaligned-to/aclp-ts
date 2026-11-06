import assert from "node:assert/strict";
import { createServer as createHttpServer, type Server } from "node:http";
import { type TestContext, test } from "node:test";
import { createClient } from "./client.ts";
import {
  defineResult,
  type EventParams,
  type Result,
} from "./protocol/index.ts";
import { createServer } from "./server.ts";

interface ContextReply {
  context: string[];
}

const context = defineResult<ContextReply>({
  type: "object",
  properties: { context: { type: "array", items: { type: "string" } } },
  required: ["context"],
  additionalProperties: false,
});

const input: EventParams<"input.submitted"> = {
  sessionId: "session-1",
  content: [{ type: "text", text: "Create a TypeScript class." }],
};

async function listen(server: Server, t: TestContext): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Test server requires a TCP address.");
  }

  return `http://127.0.0.1:${address.port}/events`;
}

function requestBody(body: string): { id: string } {
  const value: unknown = JSON.parse(body);

  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string"
  ) {
    throw new Error("Test request has no id.");
  }

  return { id: value.id };
}

test("request returns schema-validated context from a real callback server", async (t) => {
  const server = createServer({
    "input.submitted": {
      result: context,
      handle: (params) => ({
        context: params.content.some(
          (block) => block.type === "text" && /\bclass\b/i.test(block.text),
        )
          ? ["Prefer pure functions and immutable values."]
          : [],
      }),
    },
  });

  const client = createClient({ url: await listen(server, t) });

  const reply = await client.request("input.submitted", input, context);

  assert.deepEqual(reply.context, [
    "Prefer pure functions and immutable values.",
  ]);
});

test("flush waits for admission while an observation callback remains unfinished", async (t) => {
  const release = Promise.withResolvers<void>();

  const started = Promise.withResolvers<void>();

  let finished = false;

  const server = createServer({
    "tool.finished": {
      handle: async () => {
        started.resolve();
        await release.promise;
        finished = true;
      },
    },
  });

  const client = createClient({ url: await listen(server, t) });

  try {
    client.notify("tool.finished", {
      sessionId: "session-1",
      call: { name: "shell" },
      outcome: { status: "succeeded" },
    });

    await client.flush();
    await started.promise;
    assert.equal(finished, false);
  } finally {
    release.resolve();
  }
});

test("notification rejection reaches diagnostics and flush", async (t) => {
  const diagnostics: Error[] = [];

  const server = createServer({}, { authorization: "Bearer installed-token" });

  const client = createClient({
    url: await listen(server, t),
    onError: (error) => diagnostics.push(error),
  });

  client.notify("session.started", { sessionId: "session-1" });

  await assert.rejects(client.flush(), AggregateError);
  assert.equal(diagnostics.length, 1);
  await client.flush();
});

test("client accepts remote endpoints but rejects credentials, fragments and other schemes", () => {
  for (const url of [
    "https://aclp.example.com/events",
    "http://example.com/events",
  ]) {
    assert.doesNotThrow(() => createClient({ url }));
  }

  for (const url of [
    "ftp://example.com/events",
    "http://user:password@localhost/events",
    "http://localhost/events#fragment",
  ]) {
    assert.throws(() => createClient({ url }), /endpoint/);
  }

  assert.throws(
    () =>
      createClient({ url: "http://localhost/events", client: { name: "" } }),
    /ClientInfo/,
  );

  assert.throws(
    () => createClient({ url: "http://localhost/events", timeoutMs: 0 }),
    /timeout/,
  );
});

test("client rejects an id mismatch or a result outside the installed schema", async (t) => {
  for (const mismatch of [true, false]) {
    const server = createHttpServer(async (request, response) => {
      let body = "";

      for await (const chunk of request) {
        body += String(chunk);
      }

      const { id } = requestBody(body);

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: mismatch ? "wrong-id" : id,
          result: mismatch ? { context: [] } : { context: "invalid" },
        }),
      );
    });

    const client = createClient({ url: await listen(server, t) });

    await assert.rejects(
      client.request("input.submitted", input, context),
      mismatch ? /mismatched/ : /schema/,
    );
  }
});

test("request deadline includes synchronous response validation", async (t) => {
  const server = createServer({
    "input.submitted": { result: context, handle: () => ({ context: [] }) },
  });

  const slowResult: Result<ContextReply> = {
    schema: context.schema,
    validate(value: unknown): value is ContextReply {
      const end = performance.now() + 200;

      while (performance.now() < end) {
        // A synchronous installed validator cannot yield to the deadline timer.
      }

      return context.validate(value);
    },
  };

  const client = createClient({ url: await listen(server, t), timeoutMs: 100 });

  await assert.rejects(
    client.request("input.submitted", input, slowResult),
    /deadline/,
  );
});

test("client bounds notification admission attempts before dispatch", async () => {
  const client = createClient({
    url: "http://127.0.0.1:1/events",
    onError: () => {},
  });

  for (let i = 0; i < 64; i += 1) {
    client.notify("session.started", { sessionId: "session-1" });
  }

  assert.throws(
    () => client.notify("session.started", { sessionId: "session-1" }),
    /capacity/,
  );
  await assert.rejects(client.flush(), AggregateError);
});

test("HTTP upgrades reject requests and notifications without retaining client capacity", {
  timeout: 2_000,
}, async (t) => {
  const server = createHttpServer((_request, response) => {
    response.writeHead(101, { connection: "Upgrade", upgrade: "websocket" });
    response.end();
  });

  const client = createClient({
    url: await listen(server, t),
    timeoutMs: 1_000,
    onError: () => {},
  });

  await assert.rejects(
    client.request("input.submitted", input, context),
    /upgrade/i,
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (let index = 0; index < 64; index += 1) {
      client.notify("session.started", { sessionId: "session-1" });
    }

    await assert.rejects(client.flush(), AggregateError);
  }
});
