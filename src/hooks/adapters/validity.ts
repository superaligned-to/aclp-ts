import { createClient, type EventMap, type EventMethod } from "../../index.ts";
import type { Message } from "../adapter.ts";

function check<M extends EventMethod>(
  client: ReturnType<typeof createClient>,
  m: { method: M; params: EventMap[M] },
): void {
  client.notify(m.method, m.params);
}

export async function assertValid(messages: Message[]): Promise<void> {
  const client = createClient({
    url: "http://127.0.0.1:9/aclp",
    timeoutMs: 200,
    onError: () => undefined,
  });

  for (const message of messages) {
    check(client, message);
  }

  await client.flush().catch(() => undefined);
}
