import {
  type ClientInfo,
  type DiscoveryDocument,
  defineResult,
  discover,
  type OnError,
} from "../index.ts";
import { HARNESSES, type HarnessId, SUPPORTED_EVENTS } from "./adapter.ts";
import {
  type Credential,
  deleteCredential,
  saveCredential,
} from "./credentials.ts";
import { clientInfo, connect, NOTIFY_TIMEOUT_MS } from "./dispatch.ts";
import type { Env } from "./env.ts";
import { DEFAULT_CLIENT_ID } from "./oauth.ts";
import {
  addServer,
  findServer,
  removeServer,
  type ServerEntry,
  updateServer,
  validateName,
} from "./registry.ts";
import { CLIENT_NAME, VERSION } from "./version.ts";

const anyResult = defineResult<Record<string, unknown>>({
  type: "object",
  required: [],
});

export interface AddOptions {
  name: string;
  url: string;
  harnesses: "all" | HarnessId[];
  events?: string[];
  token?: string;
  discovery?: DiscoveryDocument | null;
  onError?: OnError;
}

export function supportedEvents(
  discovery: DiscoveryDocument | undefined,
): string[] {
  const supported: readonly string[] = SUPPORTED_EVENTS;

  return discovery === undefined
    ? [...supported]
    : supported.filter((m) => discovery.events.includes(m));
}

async function lookup(url: string): Promise<DiscoveryDocument | undefined> {
  try {
    return await discover(url);
  } catch {
    return undefined;
  }
}

function harnessList(
  harnesses: "all" | HarnessId[],
): (HarnessId | undefined)[] {
  return harnesses === "all" ? [undefined] : harnesses;
}

function identity(harness: HarnessId | undefined): ClientInfo {
  return harness === undefined
    ? { name: CLIENT_NAME, version: VERSION }
    : clientInfo(harness);
}

async function announce(
  env: Env,
  server: ServerEntry,
  method: "client.registered" | "client.updated" | "client.unregistered",
): Promise<void> {
  for (const harness of harnessList(server.harnesses)) {
    const who = identity(harness);

    const client = connect(
      env,
      server,
      who,
      NOTIFY_TIMEOUT_MS,
      () => undefined,
    );

    if (method === "client.unregistered") {
      client.notify(method, { client: who });
    } else if (server.requests.includes(method)) {
      await client.request(
        method,
        { client: who, events: server.events },
        anyResult,
      );
    } else {
      client.notify(method, { client: who, events: server.events });
    }

    await client.flush();
  }
}

export async function planServer(opts: AddOptions): Promise<ServerEntry> {
  validateName(opts.name);

  const discovery =
    opts.discovery === null
      ? undefined
      : (opts.discovery ?? (await lookup(opts.url)));

  const offered = supportedEvents(discovery);

  const events =
    opts.events === undefined
      ? offered
      : offered.filter((m) => opts.events?.includes(m));

  const oauth = discovery?.auth.oauth;

  const auth: ServerEntry["auth"] =
    opts.token !== undefined
      ? { type: "token" }
      : oauth !== undefined &&
          discovery?.auth.methods.includes("oauth") === true
        ? {
            type: "oauth",
            tokenEndpoint: oauth.token_endpoint,
            clientId: oauth.client_id ?? DEFAULT_CLIENT_ID,
          }
        : discovery?.auth.methods.includes("token") === true
          ? { type: "token" }
          : { type: "none" };

  return {
    name: opts.name,
    endpoint: discovery?.endpoint ?? opts.url,
    harnesses: opts.harnesses,
    events,
    requests: (discovery?.requests ?? []).filter((m) => events.includes(m)),
    auth,
    ...(opts.onError === undefined ? {} : { onError: opts.onError }),
  };
}

export async function registerServer(
  env: Env,
  server: ServerEntry,
  credential?: Credential,
): Promise<Error | undefined> {
  addServer(env, server);

  if (credential !== undefined) {
    saveCredential(env, server.name, credential);
  }

  return announce(env, server, "client.registered").then(
    () => undefined,
    (error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
  );
}

export async function setEvents(
  env: Env,
  name: string,
  events: string[],
  onError?: OnError,
): Promise<ServerEntry> {
  const current = findServer(env, name);

  const supported: readonly string[] = SUPPORTED_EVENTS;

  const chosen = events.filter((m) => supported.includes(m));

  const next = updateServer(env, name, {
    events: chosen,
    requests: current.requests.filter((m) => chosen.includes(m)),
    ...(onError === undefined ? {} : { onError }),
  });

  await announce(env, next, "client.updated");
  return next;
}

export async function unregisterServer(
  env: Env,
  name: string,
): Promise<boolean> {
  const current = findServer(env, name);

  await announce(env, current, "client.unregistered").catch(() => undefined);
  deleteCredential(env, name);
  return removeServer(env, name);
}

export function allHarnesses(): HarnessId[] {
  return [...HARNESSES];
}
