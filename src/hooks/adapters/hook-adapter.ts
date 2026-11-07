import { existsSync } from "node:fs";
import type {
  Adapter,
  HarnessId,
  Outcome,
  PlanOptions,
  Rendered,
  Support,
} from "../adapter.ts";
import type { Env } from "../env.ts";
import {
  aliased,
  type Canonical,
  claudeInput,
  commandHandler,
  flat,
  grouped,
  type HookInput,
  type HookSpec,
} from "./command-hooks.ts";
import type { Usage } from "./transcript.ts";

export interface HookAdapterSpec {
  id: HarnessId;
  name: string;
  support: Support;
  home: (env: Env) => string;
  path: (env: Env, opts: PlanOptions) => string;
  root?: (env: Env, path: string) => "hooks" | null;
  layout?: "grouped" | "flat";
  hooks: readonly HookSpec[];
  names: Readonly<Record<string, Canonical>>;
  handler?: (command: string, timeout: number) => Record<string, unknown>;
  extra?: Record<string, unknown>;
  normalize?: (payload: unknown) => HookInput;
  usage?: (path: string) => Usage[];
  render: (event: string, outcome: Outcome, payload?: unknown) => Rendered;
  notes: readonly string[];
}

export function hookAdapter(spec: HookAdapterSpec): Adapter {
  const layout = spec.layout === "flat" ? flat : grouped;

  return {
    id: spec.id,
    name: spec.name,
    support: spec.support,
    events: spec.hooks.map((h) => h.event),
    detect: (env) => existsSync(spec.home(env)),
    plan: (env, opts) => {
      const path = spec.path(env, opts);

      return {
        harness: spec.id,
        scope: opts.scope,
        edits: [
          {
            kind: "hooks",
            path,
            root: spec.root === undefined ? "hooks" : spec.root(env, path),
            entries: layout(
              opts.runtime,
              spec.id,
              spec.hooks,
              spec.handler ?? commandHandler,
            ),
            ...(spec.extra === undefined ? {} : { extra: spec.extra }),
          },
        ],
        notes: [...spec.notes],
      };
    },
    map: aliased(spec.names, spec.normalize ?? claudeInput, {
      guarded: spec.support === "lifecycle",
      ...(spec.usage === undefined ? {} : { usage: spec.usage }),
    }),
    render: spec.render,
  };
}
