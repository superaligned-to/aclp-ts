import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { createClient } from "./client.ts";
import { discover } from "./discover.ts";
import { defineResult } from "./protocol/index.ts";
import { type CallContext, createServer } from "./server.ts";

const context = defineResult<{ context: string[] }>({
  type: "object",
  properties: { context: { type: "array", items: { type: "string" } } },
  required: ["context"],
  additionalProperties: false,
});

const input = {
  sessionId: "session-1",
  content: [{ type: "text" as const, text: "hello" }],
};

const identity = {
  name: "aclp-hooks",
  version: "0.1.0",
  harness: { name: "claude-code", version: "2.1.4" },
};

async function listen(server: Server, t: TestContext): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  t.after(async () => {
    const closed = once(server, "close");

    server.closeAllConnections();
    server.close();
    await closed;
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Test server has no TCP address");
  }

  return address.port;
}

function certificate(t: TestContext): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "aclp-tls-"));

  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const key = join(dir, "key.pem");

  const cert = join(dir, "cert.pem");

  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );

  return { key: readFileSync(key, "utf8"), cert: readFileSync(cert, "utf8") };
}

function raw(
  port: number,
  host: string,
  body: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/events",
      method: "POST",
      headers: { host, "content-type": "application/json", ...headers },
    });

    request.on("error", reject);
    request.on("response", (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.end(body);
  });
}

test("requests and notifications reach an HTTPS server trusted through a custom CA", async (t) => {
  const tls = certificate(t);

  const methods: string[] = [];

  const server = createHttpsServer(tls, async (request, response) => {
    let text = "";

    for await (const chunk of request) {
      text += String(chunk);
    }

    const message: unknown = JSON.parse(text);

    assert.ok(
      typeof message === "object" && message !== null && "method" in message,
    );
    methods.push(String(message.method));

    if ("id" in message) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { context: ["tls"] },
        }),
      );
      return;
    }

    response.writeHead(202);
    response.end();
  });

  const port = await listen(server, t);

  const client = createClient({
    url: `https://localhost:${port}/events`,
    ca: tls.cert,
  });

  assert.deepEqual(await client.request("input.submitted", input, context), {
    context: ["tls"],
  });
  client.notify("session.started", { sessionId: "session-1" });
  await client.flush();
  assert.deepEqual(methods, ["input.submitted", "session.started"]);

  const untrusted = createClient({ url: `https://localhost:${port}/events` });

  await assert.rejects(
    untrusted.request("input.submitted", input, context),
    /certificate/,
  );
});

test("named public hosts are served only with authorization", async (t) => {
  assert.throws(
    () => createServer({}, { hosts: ["aclp.example.com"] }),
    /authorization/,
  );
  assert.throws(
    () =>
      createServer(
        {},
        { hosts: ["aclp.example.com:443"], authorization: "Bearer t" },
      ),
    /host name/,
  );

  let calls = 0;

  const server = createServer(
    {
      "session.started": {
        handle: () => {
          calls += 1;
        },
      },
    },
    { hosts: ["aclp.example.com"], authorization: "Bearer t" },
  );

  const port = await listen(server, t);

  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "session.started",
    params: { sessionId: "session-1" },
  });

  assert.equal(
    await raw(port, "aclp.example.com", body, { authorization: "Bearer t" }),
    202,
  );
  assert.equal(
    await raw(port, "aclp.example.com:443", body, {
      authorization: "Bearer t",
    }),
    202,
  );
  assert.equal(await raw(port, "aclp.example.com", body, {}), 401);
  assert.equal(
    await raw(port, "other.example.com", body, { authorization: "Bearer t" }),
    403,
  );
  assert.equal(
    await raw(port, "aclp.example.com", body, {
      authorization: "Bearer t",
      origin: "https://aclp.example.com",
    }),
    403,
  );
  assert.equal(calls, 2);
});

test("callbacks see the client identity and clients send only consented events", async (t) => {
  const seen: CallContext[] = [];

  const server = createServer(
    {
      "input.submitted": {
        result: context,
        handle: (_params, call) => {
          seen.push(call);
          return { context: [] };
        },
      },
    },
    { authorization: "Bearer rotated-2" },
  );

  const port = await listen(server, t);

  let refreshed = 0;

  const client = createClient({
    url: `http://127.0.0.1:${port}/events`,
    client: identity,
    events: ["input.submitted"],
    onError: () => undefined,
    authorization: async () => {
      refreshed += 1;
      return `Bearer rotated-${refreshed + 1}`;
    },
  });

  await client.request("input.submitted", input, context);
  assert.deepEqual(seen, [{ client: "aclp-hooks/0.1.0 claude-code/2.1.4" }]);
  assert.throws(
    () => client.notify("session.started", { sessionId: "s" }),
    /not consented/,
  );
  assert.doesNotThrow(() =>
    client.notify("client.unregistered", { client: identity }),
  );
  await assert.rejects(client.flush(), AggregateError);
});

test("discovery describes registered callbacks and rejects invalid documents", async (t) => {
  const server = createServer(
    {
      "input.submitted": { result: context, handle: () => ({ context: [] }) },
      "tool.finished": { handle: () => undefined },
    },
    {
      authorization: "Bearer t",
      discovery: {
        endpoint: "https://aclp.example.com/events",
        name: "Example",
      },
    },
  );

  const port = await listen(server, t);

  assert.deepEqual(await discover(`http://127.0.0.1:${port}/anything`), {
    name: "Example",
    endpoint: "https://aclp.example.com/events",
    auth: { methods: ["token"] },
    events: ["input.submitted", "tool.finished"],
    requests: ["input.submitted"],
  });

  const plain = await listen(createServer({}), t);

  await assert.rejects(discover(`http://127.0.0.1:${plain}`), /HTTP 404/);

  assert.throws(
    () =>
      createServer(
        {},
        {
          discovery: {
            endpoint: "https://aclp.example.com/events",
            auth: { methods: ["oauth"] },
          },
        },
      ),
    /discovery/,
  );
});
