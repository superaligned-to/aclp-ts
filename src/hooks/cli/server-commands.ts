import {
  type DiscoveryDocument,
  discover,
  isOnError,
  type OnError,
} from "../../index.ts";
import { SUPPORTED_EVENTS } from "../adapter.ts";
import {
  type Credential,
  deleteCredential,
  saveCredential,
} from "../credentials.ts";
import type { Env } from "../env.ts";
import {
  DEFAULT_CLIENT_ID,
  loginWithBrowser,
  loginWithDevice,
  type OAuthMetadata,
} from "../oauth.ts";
import { findServer, listServers, type ServerEntry } from "../registry.ts";
import {
  planServer,
  registerServer,
  setEvents,
  supportedEvents,
  unregisterServer,
} from "../servers.ts";
import { parseHarnesses } from "./harness-commands.ts";
import type { Ui } from "./ui.ts";

export interface ServerFlags {
  name?: string;
  url?: string;
  harnesses: string[];
  all: boolean;
  events?: string;
  token?: string;
  oauth?: string;
  onError?: string;
  yes: boolean;
}

function onError(value: string | undefined): OnError | undefined {
  if (value === undefined || isOnError(value)) {
    return value;
  }

  throw new Error(`--on-error is allow or deny, not ${value}`);
}

function csv(value: string | undefined): string[] | undefined {
  return value === undefined
    ? undefined
    : value
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v !== "");
}

async function consent(
  ui: Ui,
  offered: string[],
  preset: string[] | undefined,
  current?: string[],
): Promise<string[]> {
  if (preset !== undefined) {
    const unknown = preset.filter((m) => !offered.includes(m));

    if (unknown.length > 0) {
      throw new Error(
        `Not offered by this server or not supported: ${unknown.join(", ")}`,
      );
    }

    return preset;
  }

  if (!ui.interactive) {
    return current ?? offered;
  }

  return ui.multiselect(
    "Which events may this server receive?",
    offered.map((m) => ({ value: m, label: m })),
    current ?? offered,
  );
}

async function obtain(
  ui: Ui,
  server: ServerEntry,
  meta: OAuthMetadata | undefined,
  flags: ServerFlags,
): Promise<Credential | undefined> {
  if (server.auth.type === "none") {
    return undefined;
  }

  if (flags.token !== undefined) {
    return { accessToken: flags.token };
  }

  if (server.auth.type === "token" || meta === undefined) {
    if (!ui.interactive) {
      throw new Error(`${server.name} needs a token; pass --token`);
    }

    return { accessToken: await ui.secret(`Token for ${server.name}`) };
  }

  const device =
    flags.oauth === "device" || (flags.oauth === undefined && !ui.interactive);

  const clientId = meta.client_id ?? DEFAULT_CLIENT_ID;

  if (device) {
    return loginWithDevice({
      meta,
      clientId,
      show: (code, url) => ui.note(`Open ${url}\nand enter ${code}`, "Sign in"),
    });
  }

  return loginWithBrowser({
    meta,
    clientId,
    open: (url) => {
      ui.info(
        `Opening your browser to sign in. If it does not open, visit:\n${url}`,
      );
      ui.open(url);
    },
  });
}

async function lookup(url: string): Promise<DiscoveryDocument | undefined> {
  try {
    return await discover(url);
  } catch {
    return undefined;
  }
}

export async function addCommand(
  env: Env,
  ui: Ui,
  flags: ServerFlags,
): Promise<void> {
  const name =
    flags.name ??
    (ui.interactive ? await ui.text("Server name", "memory") : undefined);

  const url =
    flags.url ??
    (ui.interactive
      ? await ui.text("Server URL", "http://127.0.0.1:8788")
      : undefined);

  if (name === undefined || url === undefined) {
    throw new Error("aclp server add needs a name and --url");
  }

  const policy = onError(flags.onError);

  const discovery = await lookup(url);

  if (discovery === undefined) {
    ui.warn(
      `No discovery document at ${url}; using the URL as the ACLP endpoint.`,
    );
  }

  const named = parseHarnesses(flags.harnesses);

  const harnesses = flags.all || named.length === 0 ? "all" : named;

  const events = await consent(
    ui,
    supportedEvents(discovery),
    csv(flags.events),
  );

  const server = await planServer({
    name,
    url,
    harnesses,
    events,
    ...(flags.token === undefined ? {} : { token: flags.token }),
    discovery: discovery ?? null,
    ...(policy === undefined ? {} : { onError: policy }),
  });

  const credential = await obtain(ui, server, discovery?.auth.oauth, flags);

  const failure = await registerServer(env, server, credential);

  ui.success(
    `${server.name} receives ${server.events.length} events from ${harnesses === "all" ? "every harness" : harnesses.join(", ")}.`,
  );

  if (failure !== undefined) {
    ui.warn(
      `${server.name} did not acknowledge the registration: ${failure.message}`,
    );
  }
}

export async function eventsCommand(
  env: Env,
  ui: Ui,
  name: string,
  flags: ServerFlags,
): Promise<void> {
  const server = findServer(env, name);

  const policy = onError(flags.onError);

  const offered = supportedEvents(await lookup(server.endpoint));

  const events = await consent(ui, offered, csv(flags.events), server.events);

  await setEvents(env, name, events, policy);
  ui.success(
    `${name} now receives ${events.length} events${policy === undefined ? "" : ` and fails ${policy === "allow" ? "open" : "closed"} on error`}.`,
  );
}

export async function loginCommand(
  env: Env,
  ui: Ui,
  name: string,
  flags: ServerFlags,
): Promise<void> {
  const server = findServer(env, name);

  const discovery = await lookup(server.endpoint);

  const credential = await obtain(
    ui,
    server.auth.type === "none"
      ? { ...server, auth: { type: "token" } }
      : server,
    discovery?.auth.oauth,
    flags,
  );

  if (credential !== undefined) {
    saveCredential(env, name, credential);
  }

  ui.success(`Signed in to ${name}.`);
}

export function logoutCommand(env: Env, ui: Ui, name: string): void {
  findServer(env, name);
  deleteCredential(env, name);
  ui.success(`Signed out of ${name}.`);
}

export async function removeCommand(
  env: Env,
  ui: Ui,
  name: string,
  yes: boolean,
): Promise<void> {
  if (ui.interactive && !yes && !(await ui.confirm(`Remove ${name}?`))) {
    ui.warn("Nothing changed.");
    return;
  }

  await unregisterServer(env, name);
  ui.success(`Removed ${name}.`);
}

export function listCommand(
  env: Env,
  ui: Ui,
  json: boolean,
  write: (text: string) => void,
): void {
  const servers = listServers(env);

  if (json) {
    write(`${JSON.stringify(servers, null, 2)}\n`);
    return;
  }

  if (servers.length === 0) {
    ui.info("No ACLP servers registered. Add one with aclp server add.");
    return;
  }

  for (const s of servers) {
    const harnesses =
      s.harnesses === "all" ? "all harnesses" : s.harnesses.join(", ");

    const shared =
      s.events.length === SUPPORTED_EVENTS.length
        ? "all events"
        : s.events.join(", ");

    ui.note(
      `${s.endpoint}\n${harnesses}\n${shared}${s.requests.length > 0 ? `\nanswers: ${s.requests.join(", ")}` : ""}\nauth: ${s.auth.type}\non error: ${s.onError ?? "default (deny tool and permission guards, allow the rest)"}`,
      s.name,
    );
  }
}
