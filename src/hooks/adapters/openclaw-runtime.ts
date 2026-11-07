import { currentEnv } from "../env.ts";
import { fire } from "../fire.ts";
import { OPENCLAW_EVENTS } from "./openclaw.ts";
import { field, method, text } from "./plugin-file.ts";

export interface OpenclawPlugin {
  id: string;
  register: (api: unknown) => void;
}

function sessionOf(event: unknown, ctx: unknown): string | undefined {
  return (
    text(field(event, "sessionId")) ??
    text(field(ctx, "sessionId")) ??
    text(field(ctx, "sessionKey"))
  );
}

export function openclawPlugin(): OpenclawPlugin {
  return {
    id: "aclp",
    register: (api) => {
      const env = currentEnv();

      const send = async (name: string, event: unknown, ctx: unknown) => {
        const sessionId = sessionOf(event, ctx);

        return sessionId === undefined
          ? undefined
          : fire(
              "openclaw",
              name,
              {
                ...(typeof event === "object" && event !== null ? event : {}),
                sessionId,
              },
              env,
            );
      };

      for (const name of OPENCLAW_EVENTS) {
        method(api, "on")?.(name, async (event: unknown, ctx: unknown) => {
          try {
            const outcome = await send(name, event, ctx);

            if (
              name !== "before_prompt_build" ||
              outcome === undefined ||
              outcome.context.length === 0
            ) {
              return undefined;
            }

            return { prependContext: outcome.context.join("\n\n") };
          } catch {
            return undefined;
          }
        });
      }
    },
  };
}
