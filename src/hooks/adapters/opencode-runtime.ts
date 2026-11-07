import { currentEnv } from "../env.ts";
import { isRecord } from "../files.ts";
import { fire } from "../fire.ts";
import { method } from "./plugin-file.ts";

type Handler = (input: unknown, output: unknown) => Promise<void>;

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

async function hook(
  target: unknown,
  name: string,
  handler: Handler,
): Promise<void> {
  await method(target, "hook")?.(name, handler);
}

export function opencodePlugin(): {
  id: string;
  setup: (ctx: unknown) => Promise<void>;
} {
  return {
    id: "aclp",
    setup: async (ctx) => {
      const env = currentEnv();

      const started = new Set<string>();

      const context = new Map<string, string[]>();

      const start = async (sessionID: string): Promise<void> => {
        if (started.has(sessionID)) {
          return;
        }

        started.add(sessionID);
        await fire("opencode", "session.started", { sessionID }, env);
      };

      const session = field(ctx, "session");

      const tool = field(ctx, "tool");

      await hook(session, "prompt", async (input) => {
        const sessionID = text(field(input, "sessionID"));

        if (sessionID === undefined) {
          return;
        }

        await start(sessionID);

        const outcome = await fire(
          "opencode",
          "prompt",
          { sessionID, text: text(field(field(input, "prompt"), "text")) },
          env,
        );

        if (outcome.blocked !== undefined) {
          throw new Error(`ACLP blocked this prompt: ${outcome.blocked}`);
        }

        context.set(sessionID, outcome.context);
      });

      await hook(session, "context", async (input) => {
        const sessionID = text(field(input, "sessionID"));

        const system = field(input, "system");

        const parts =
          sessionID === undefined ? undefined : context.get(sessionID);

        if (
          sessionID === undefined ||
          parts === undefined ||
          !Array.isArray(system)
        ) {
          return;
        }

        context.delete(sessionID);

        if (parts.length > 0) {
          system.push({ type: "text", text: parts.join("\n\n") });
        }
      });

      const toolEvent =
        (event: string) => async (input: unknown, output: unknown) => {
          const sessionID = text(field(input, "sessionID"));

          if (sessionID === undefined) {
            return;
          }

          await start(sessionID);
          await fire(
            "opencode",
            event,
            {
              sessionID,
              id: field(input, "id") ?? field(input, "callID"),
              tool: field(input, "tool"),
              input: field(input, "input") ?? field(input, "args"),
              status: field(input, "status") ?? field(output, "status"),
              output: field(output, "output") ?? field(input, "output"),
            },
            env,
          );
        };

      await hook(tool, "execute.before", toolEvent("tool.before"));
      await hook(tool, "execute.after", toolEvent("tool.after"));

      const subscribe = method(field(ctx, "event"), "subscribe");

      const stream: unknown = subscribe?.({});

      if (!isAsyncIterable(stream)) {
        return;
      }

      void (async () => {
        try {
          for await (const raw of stream) {
            const type = field(raw, "type");

            const sessionID =
              text(field(field(raw, "properties"), "sessionID")) ??
              text(field(raw, "sessionID"));

            if (type === "session.deleted" && sessionID !== undefined) {
              started.delete(sessionID);
              await fire("opencode", "session.deleted", { sessionID }, env);
            }
          }
        } catch {
          return;
        }
      })();
    },
  };
}
