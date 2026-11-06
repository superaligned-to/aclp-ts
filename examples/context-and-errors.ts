import { once } from "node:events";
import { createClient, createServer, defineResult } from "../src/index.ts";

interface ContextReply {
  context: string[];
}

const context = defineResult<ContextReply>({
  type: "object",
  properties: { context: { type: "array", items: { type: "string" } } },
  required: ["context"],
  additionalProperties: false,
});

let errorCount = 0;

const observed = Promise.withResolvers<void>();

const server = createServer({
  "input.submitted": {
    result: context,
    handle: (input) => ({
      context: input.content.some(
        (block) => block.type === "text" && /\bclass\b/i.test(block.text),
      )
        ? [
            "Prefer pure functions, immutable values and composition for TypeScript.",
          ]
        : [],
    }),
  },
  "tool.finished": {
    handle: ({ outcome }) => {
      const output = "output" in outcome ? outcome.output : undefined;

      for (const block of output?.content ?? []) {
        if (block.type === "text") {
          errorCount += block.text.match(/\berror\b/gi)?.length ?? 0;
        }
      }

      observed.resolve();
    },
  },
});

server.listen(0, "127.0.0.1");
await once(server, "listening");

const address = server.address();

if (address === null || typeof address === "string") {
  throw new Error("Expected a loopback TCP listener.");
}

const client = createClient({ url: `http://127.0.0.1:${address.port}/events` });

try {
  const reply = await client.request(
    "input.submitted",
    {
      sessionId: "example-session",
      content: [
        {
          type: "text",
          text: "Create a TypeScript class for parsing configuration.",
        },
      ],
    },
    context,
  );

  console.log("Context to apply before the model request:", reply.context);

  client.notify("tool.finished", {
    sessionId: "example-session",
    call: { name: "shell", arguments: { command: "pnpm test" } },
    outcome: {
      status: "failed",
      output: {
        content: [
          {
            type: "text",
            text: "error: missing name\nerror: missing return type",
          },
        ],
      },
    },
  });

  await client.flush();
  await observed.promise;

  console.log("Observed errors:", errorCount);
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
