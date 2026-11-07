import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Adapter } from "../adapter.ts";
import type { Env } from "../env.ts";
import { mapPi, PI_EVENTS } from "./pi.ts";
import { pluginModule } from "./plugin-file.ts";

function root(env: Env): string {
  return resolve(env.home, env.vars.PI_CONFIG_DIR || ".omp");
}

export const omp: Adapter = {
  id: "omp",
  name: "OMP (oh-my-pi)",
  support: "lifecycle",
  events: PI_EVENTS,
  detect: (env) => existsSync(root(env)),
  plan: (env, opts) => ({
    harness: "omp",
    scope: opts.scope,
    edits: [
      {
        kind: "file",
        path:
          opts.scope === "project"
            ? join(env.cwd, ".omp", "extensions", "aclp.ts")
            : join(root(env), "agent", "extensions", "aclp.ts"),
        content: pluginModule(opts.runtime.module, "piExtension", "omp"),
      },
    ],
    notes: [
      "OMP scans extensions at startup; restart it after installing. Named profiles (OMP_PROFILE) have their own extensions directory and are not covered.",
    ],
  }),
  map: async (event, payload) => mapPi(event, payload),
  render: () => ({ exitCode: 0 }),
};
