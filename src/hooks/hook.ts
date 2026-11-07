import { HARNESSES, isHarness, type Rendered } from "./adapter.ts";
import type { DispatchOptions } from "./dispatch.ts";
import type { Env } from "./env.ts";
import { fire } from "./fire.ts";
import { adapterFor } from "./harnesses.ts";

export const MAX_STDIN_BYTES = 4 * 1024 * 1024;

export async function readInput(
  stream: AsyncIterable<unknown>,
): Promise<string> {
  const chunks: Buffer[] = [];

  let size = 0;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));

    size += buf.byteLength;

    if (size > MAX_STDIN_BYTES) {
      throw new Error("Hook payload exceeds 4 MiB");
    }

    chunks.push(buf);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function runHook(
  argv: readonly string[],
  input: string,
  env: Env,
  opts: DispatchOptions = {},
): Promise<Rendered> {
  const [harness, event] = argv;

  if (harness === undefined || event === undefined || !isHarness(harness)) {
    return {
      stderr: `usage: aclp-hook <${HARNESSES.join("|")}> <native-event>\n`,
      exitCode: 0,
    };
  }

  let payload: unknown;

  try {
    payload = input.trim() === "" ? {} : JSON.parse(input);
  } catch {
    return { stderr: "aclp-hook: the hook payload is not JSON\n", exitCode: 0 };
  }

  const outcome = await fire(harness, event, payload, env, opts);

  return adapterFor(harness).render(event, outcome, payload);
}
