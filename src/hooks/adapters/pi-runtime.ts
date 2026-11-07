import { currentEnv } from "../env.ts";
import { isRecord } from "../files.ts";
import { fire } from "../fire.ts";
import { method } from "./plugin-file.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function sessionId(ctx: unknown): string | undefined {
  const id = method(field(ctx, "sessionManager"), "getSessionId")?.();

  return typeof id === "string" && id !== "" ? id : undefined;
}

export function piExtension(
  harness: "pi" | "omp" = "pi",
): (pi: unknown) => void {
  return (pi) => {
    const env = currentEnv();

    const pending = new Map<string, string[]>();

    const on = (name: string, handler: Handler): void => {
      method(pi, "on")?.(name, async (event: unknown, ctx: unknown) => {
        try {
          return await handler(event, ctx);
        } catch {
          return undefined;
        }
      });
    };

    const forward = (name: string) => async (event: unknown, ctx: unknown) => {
      const id = sessionId(ctx);

      if (id !== undefined) {
        await fire(
          harness,
          name,
          { ...(isRecord(event) ? event : {}), sessionId: id },
          env,
        );
      }

      return undefined;
    };

    on("session_start", forward("session_start"));
    on("tool_call", forward("tool_call"));
    on("tool_result", forward("tool_result"));
    on("message_end", forward("message_end"));
    on("agent_end", forward("agent_end"));
    on("session_shutdown", forward("session_shutdown"));

    method(pi, "on")?.("input", async (event: unknown, ctx: unknown) => {
      const id = sessionId(ctx);

      if (id === undefined) {
        return undefined;
      }

      const outcome = await fire(
        harness,
        "input",
        { ...(isRecord(event) ? event : {}), sessionId: id },
        env,
      );

      if (outcome.blocked !== undefined) {
        method(field(ctx, "ui"), "notify")?.(
          `ACLP blocked this prompt: ${outcome.blocked}`,
          "error",
        );
        return { handled: true };
      }

      pending.set(id, outcome.context);
      return undefined;
    });

    on("before_agent_start", async (_event, ctx) => {
      const id = sessionId(ctx);

      const parts = id === undefined ? undefined : pending.get(id);

      if (id === undefined || parts === undefined) {
        return undefined;
      }

      pending.delete(id);

      return parts.length === 0
        ? undefined
        : {
            message: {
              customType: "aclp-context",
              content: parts.join("\n\n"),
              display: false,
            },
          };
    });
  };
}
