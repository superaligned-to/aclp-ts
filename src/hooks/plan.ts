import type { HarnessId, Plan, Runtime, Scope } from "./adapter.ts";
import type { Env } from "./env.ts";
import { adapterFor } from "./harnesses.ts";
import { stableRuntime } from "./runtime-files.ts";

export function plan(
  harness: HarnessId,
  env: Env,
  scope: Scope = "user",
  runtime: Runtime = stableRuntime(env),
): Plan {
  return adapterFor(harness).plan(env, { scope, runtime });
}
