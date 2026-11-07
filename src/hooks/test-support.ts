import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { type CallContext, createServer, defineResult } from "../index.ts";
import { type Runtime, SUPPORTED_EVENTS } from "./adapter.ts";
import type { Env } from "./env.ts";
import { addServer } from "./registry.ts";

export function tempEnv(
  t: TestContext,
  vars: Record<string, string> = {},
): Env {
  const home = mkdtempSync(join(tmpdir(), "aclp-hooks-"));

  t.after(() => rmSync(home, { recursive: true, force: true }));

  return {
    home,
    cwd: join(home, "project"),
    platform: process.platform,
    vars: { ACLP_CREDENTIALS: "file", ...vars },
  };
}

export const runtime: Runtime = {
  node: "/usr/local/bin/node",
  hook: "/opt/aclp/dist/aclp-hook.js",
  cli: "/opt/aclp/dist/aclp.js",
  module: "file:///opt/aclp/dist/runtime.js",
};

export async function listen(t: TestContext, server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Test server has no TCP address");
  }

  return `http://127.0.0.1:${address.port}`;
}

const context = defineResult<{ context: { content: string }[] }>({
  type: "object",
  properties: {
    context: {
      type: "array",
      items: {
        type: "object",
        properties: { content: { type: "string" } },
        required: ["content"],
      },
    },
  },
  required: ["context"],
});

export async function contextServer(
  t: Parameters<typeof tempEnv>[0],
  seen: { method: string; client?: string }[],
) {
  const note = (method: string) => (_params: unknown, ctx: CallContext) => {
    seen.push({
      method,
      ...(ctx.client === undefined ? {} : { client: ctx.client }),
    });
  };

  const server = createServer({
    "session.started": { handle: note("session.started") },
    "session.ended": { handle: note("session.ended") },
    "tool.requested": { handle: note("tool.requested") },
    "tool.finished": { handle: note("tool.finished") },
    "model.finished": { handle: note("model.finished") },
    "run.finished": { handle: note("run.finished") },
    "agent.started": { handle: note("agent.started") },
    "agent.finished": { handle: note("agent.finished") },
    "input.submitted": {
      result: context,
      handle: (params, ctx) => {
        note("input.submitted")(params, ctx);
        return { context: [{ content: "Remembered: prefer small PRs." }] };
      },
    },
  });

  return listen(t, server);
}

export function register(env: Env, url: string): void {
  addServer(env, {
    name: "memory",
    endpoint: `${url}/aclp`,
    harnesses: "all",
    events: [...SUPPORTED_EVENTS],
    requests: ["input.submitted"],
    auth: { type: "none" },
  });
}

export function withEnv<T>(env: Env, run: () => Promise<T>): Promise<T> {
  const saved = {
    HOME: process.env.HOME,
    ACLP_CONFIG_DIR: process.env.ACLP_CONFIG_DIR,
    ACLP_CREDENTIALS: process.env.ACLP_CREDENTIALS,
  };

  process.env.HOME = env.home;
  process.env.ACLP_CONFIG_DIR = `${env.home}/.config/aclp`;
  process.env.ACLP_CREDENTIALS = "file";

  return run().finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });
}

export async function settle(seen: unknown[], count: number): Promise<void> {
  for (let i = 0; i < 100 && seen.length < count; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
}
