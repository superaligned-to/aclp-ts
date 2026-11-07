import { randomUUID } from "node:crypto";
import { currentEnv } from "../env.ts";
import { fire } from "../fire.ts";
import { field, method, text } from "./plugin-file.ts";

interface Recall {
  pending: Promise<string[]>;
  message?: Record<string, unknown>;
}

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  return Array.isArray(content)
    ? content
        .flatMap((p) => (field(p, "type") === "text" ? [field(p, "text")] : []))
        .filter((t) => typeof t === "string")
        .join("\n")
    : "";
}

function lastUser(messages: unknown[]): [number, unknown] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];

    if (
      field(m, "role") === "user" &&
      field(field(m, "metadata"), "source") !== "aclp"
    ) {
      return [i, m];
    }
  }

  return undefined;
}

export function clinePlugin() {
  const env = currentEnv();

  let sessionId: string | undefined;

  const recalls = new Map<string, Recall>();

  const send = (event: string, payload: Record<string, unknown>) =>
    sessionId === undefined
      ? Promise.resolve(undefined)
      : fire("cline-cli", event, { ...payload, sessionId }, env);

  const toolPayload = (ctx: unknown) => ({
    toolName: field(field(ctx, "toolCall"), "toolName"),
    toolCallId: field(field(ctx, "toolCall"), "toolCallId"),
    input: field(ctx, "input"),
  });

  return {
    name: "aclp",
    manifest: { capabilities: ["hooks"] },
    setup(_api: unknown, ctx: unknown) {
      sessionId = text(field(field(ctx, "session"), "sessionId"));
      recalls.clear();
      void send("session.start", {});

      const id = sessionId;

      method(
        ctx,
        "onDispose",
      )?.(async () => {
        if (id !== undefined) {
          await fire("cline-cli", "session.end", { sessionId: id }, env);
        }
      });
    },
    hooks: {
      async beforeModel(ctx: unknown) {
        const messages = field(field(ctx, "request"), "messages");

        const found = Array.isArray(messages) ? lastUser(messages) : undefined;

        if (!Array.isArray(messages) || found === undefined) {
          return undefined;
        }

        const [index, user] = found;

        const prompt = textOf(field(user, "content"));

        const key = text(field(user, "id")) ?? prompt;

        if (prompt.trim() === "") {
          return undefined;
        }

        let recall = recalls.get(key);

        if (recall === undefined) {
          recall = {
            pending: send("prompt", { prompt })
              .then((o) => o?.context ?? [])
              .catch(() => []),
          };
          recalls.set(key, recall);
        }

        const parts = await recall.pending;

        if (parts.length === 0) {
          return undefined;
        }

        recall.message ??= {
          id: `aclp:${randomUUID()}`,
          role: "user",
          content: [{ type: "text", text: parts.join("\n\n") }],
          metadata: { source: "aclp" },
        };

        return {
          messages: [
            ...messages.slice(0, index),
            recall.message,
            ...messages.slice(index),
          ],
        };
      },
      async beforeTool(ctx: unknown) {
        await send("tool.before", toolPayload(ctx)).catch(() => undefined);
        return undefined;
      },
      async afterTool(ctx: unknown) {
        await send("tool.after", {
          ...toolPayload(ctx),
          isError: field(field(ctx, "result"), "isError") === true,
          output: field(field(ctx, "result"), "output"),
        }).catch(() => undefined);
        return undefined;
      },
      async afterRun(ctx: unknown) {
        await send("run.after", {
          usage: field(field(ctx, "result"), "usage"),
        }).catch(() => undefined);
        return undefined;
      },
    },
  };
}
