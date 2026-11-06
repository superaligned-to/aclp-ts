import { endpoint, send } from "./client-http.ts";
import {
  type DiscoveryDocument,
  decodeJson,
  isDiscoveryDocument,
} from "./protocol/index.ts";

export interface DiscoverOptions {
  timeoutMs?: number;
  ca?: string;
}

export async function discover(
  url: string,
  options: DiscoverOptions = {},
): Promise<DiscoveryDocument> {
  const target = new URL("/.well-known/aclp", endpoint(url));

  const reply = await send(target, {
    method: "GET",
    headers: { accept: "application/json" },
    deadline: performance.now() + (options.timeoutMs ?? 5_000),
    ...(options.ca === undefined ? {} : { ca: options.ca }),
  });

  if (reply.status !== 200 || !reply.json) {
    throw new Error(`ACLP discovery failed with HTTP ${reply.status}.`);
  }

  const document = decodeJson(reply.body);

  if (!isDiscoveryDocument(document)) {
    throw new Error("Invalid ACLP discovery document.");
  }

  return document;
}
