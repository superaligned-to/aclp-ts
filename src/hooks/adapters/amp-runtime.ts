import { currentEnv } from "../env.ts";
import { fire } from "../fire.ts";
import { field, method, text } from "./plugin-file.ts";

type Handler = (event: unknown) => Promise<unknown>;

export function ampPlugin(): (amp: unknown) => void {
  return (amp) => {
    const env = currentEnv();

    const threads = new Set<string>();

    const on = (name: string, handler: Handler): void => {
      method(amp, "on")?.(name, async (event: unknown) => {
        try {
          return await handler(event);
        } catch {
          return undefined;
        }
      });
    };

    const send = async (name: string, event: unknown) => {
      const threadId = text(field(field(event, "thread"), "id"));

      if (threadId === undefined) {
        return undefined;
      }

      threads.add(threadId);

      const tool = field(event, "tool");

      return fire(
        "amp",
        name,
        {
          threadId,
          message: field(event, "message"),
          tool: text(tool) ?? text(field(tool, "name")),
          toolUseID: field(event, "toolUseID") ?? field(tool, "id"),
          input: field(event, "input") ?? field(tool, "input"),
          output: field(event, "output"),
          status: field(event, "status"),
        },
        env,
      );
    };

    const observe = (name: string) => async (event: unknown) => {
      await send(name, event);
      return undefined;
    };

    on("session.start", observe("session.start"));
    on("tool.call", observe("tool.call"));
    on("tool.result", observe("tool.result"));
    on("agent.end", observe("agent.end"));

    on("agent.start", async (event) => {
      const outcome = await send("agent.start", event);

      if (outcome === undefined || outcome.context.length === 0) {
        return undefined;
      }

      return {
        message: { content: outcome.context.join("\n\n"), display: false },
      };
    });

    method(
      amp,
      "onDispose",
    )?.(async () => {
      const ids = [...threads];

      threads.clear();
      await Promise.all(
        ids.map((threadId) =>
          fire("amp", "session.end", { threadId }, env).catch(() => undefined),
        ),
      );
    });
  };
}
