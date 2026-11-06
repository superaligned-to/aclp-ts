# aclp-ts

TypeScript client and callback server for the [Agent Context Lifecycle Protocol](https://github.com/superaligned-to/aclp). The client sends typed lifecycle events over loopback HTTP; the server validates them, runs your callbacks and checks their results against a JSON Schema.

```sh
pnpm add @superaligned-to/aclp@0.1.0
```

## Example

```ts
import { createClient, createServer, defineResult } from "@superaligned-to/aclp";

interface ContextReply {
  context: string[];
}

const context = defineResult<ContextReply>({
  type: "object",
  properties: { context: { type: "array", items: { type: "string" } } },
  required: ["context"],
  additionalProperties: false,
});

const server = createServer({
  "input.submitted": {
    result: context,
    handle: ({ content }) => ({
      context: content.some((block) => block.type === "text" && /\bclass\b/i.test(block.text))
        ? ["Prefer pure functions and immutable values for TypeScript."]
        : [],
    }),
  },
});

await new Promise<void>((resolve) => server.listen(8787, "127.0.0.1", resolve));

const client = createClient({ url: "http://127.0.0.1:8787/events" });

const reply = await client.request("input.submitted", {
  sessionId: "session-1",
  content: [{ type: "text", text: "Create a TypeScript class." }],
}, context);
```

Notifications use `client.notify(method, params)` and `await client.flush()`. A runnable example with both delivery paths and shutdown:

```sh
pnpm example
```

## Development

```sh
pnpm install --frozen-lockfile
pnpm check
```

Licensed under [MIT](LICENSE).
