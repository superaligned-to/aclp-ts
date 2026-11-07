import type { HarnessId, Outcome } from "./adapter.ts";
import { type DispatchOptions, dispatch } from "./dispatch.ts";
import { currentEnv, type Env } from "./env.ts";
import { adapterFor } from "./harnesses.ts";

export async function fire(
  harness: HarnessId,
  event: string,
  payload: unknown,
  env: Env = currentEnv(),
  opts: DispatchOptions = {},
): Promise<Outcome> {
  const messages = await adapterFor(harness).map(event, payload, env);

  if (messages.length === 0) {
    return { context: [] };
  }

  return dispatch(env, harness, messages, opts);
}
