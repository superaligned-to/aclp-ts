import { join } from "node:path";
import { isOnError, type OnError } from "../index.ts";
import { type HarnessId, isHarness } from "./adapter.ts";
import { configDir, type Env } from "./env.ts";
import { isRecord, readJson, writeJson } from "./files.ts";

export type Auth =
  | { type: "none" }
  | { type: "token" }
  | { type: "oauth"; tokenEndpoint: string; clientId: string };

export interface ServerEntry {
  name: string;
  endpoint: string;
  harnesses: "all" | HarnessId[];
  events: string[];
  requests: string[];
  auth: Auth;
  /** What a failed request does; unset denies only tool and permission guards. */
  onError?: OnError;
}

export interface Registry {
  version: 1;
  servers: ServerEntry[];
}

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function registryPath(env: Env): string {
  return join(configDir(env), "servers.json");
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function auth(value: unknown): Auth {
  if (!isRecord(value) || value.type === "none" || value.type === undefined) {
    return { type: "none" };
  }

  if (value.type === "token") {
    return { type: "token" };
  }

  if (
    value.type === "oauth" &&
    typeof value.tokenEndpoint === "string" &&
    typeof value.clientId === "string"
  ) {
    return {
      type: "oauth",
      tokenEndpoint: value.tokenEndpoint,
      clientId: value.clientId,
    };
  }

  throw new Error("Unsupported server auth in the ACLP registry");
}

function entry(value: unknown): ServerEntry | undefined {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.endpoint !== "string"
  ) {
    return undefined;
  }

  const harnesses =
    value.harnesses === "all"
      ? "all"
      : strings(value.harnesses).filter(isHarness);

  return {
    name: value.name,
    endpoint: value.endpoint,
    harnesses,
    events: strings(value.events),
    requests: strings(value.requests),
    auth: auth(value.auth),
    ...(isOnError(value.onError) ? { onError: value.onError } : {}),
  };
}

function raw(env: Env): unknown[] {
  const doc = readJson(registryPath(env));

  if (doc === undefined) {
    return [];
  }

  if (doc.version !== 1 || !Array.isArray(doc.servers)) {
    throw new Error(`${registryPath(env)} is not an ACLP registry (version 1)`);
  }

  return doc.servers;
}

export function readRegistry(env: Env): Registry {
  const servers = raw(env).flatMap((value) => {
    const parsed = entry(value);

    return parsed === undefined ? [] : [parsed];
  });

  return { version: 1, servers };
}

function save(env: Env, registry: Registry): void {
  const foreign = raw(env).filter((value) => entry(value) === undefined);

  writeJson(
    registryPath(env),
    { version: 1, servers: [...foreign, ...registry.servers] },
    0o600,
  );
}

export function validateName(name: string): void {
  if (!NAME.test(name)) {
    throw new Error(
      "Server names use lowercase letters, digits, dots, dashes or underscores (at most 64)",
    );
  }
}

export function validateEndpoint(endpoint: string): void {
  const url = new URL(endpoint);

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "Server endpoints are http(s) URLs without credentials or a fragment",
    );
  }
}

export function addServer(env: Env, server: ServerEntry): Registry {
  validateName(server.name);
  validateEndpoint(server.endpoint);

  for (const method of server.requests) {
    if (!server.events.includes(method)) {
      throw new Error(
        `${method} is answered as a request but not shared with ${server.name}`,
      );
    }
  }

  const registry = readRegistry(env);

  const servers = [
    ...registry.servers.filter((s) => s.name !== server.name),
    server,
  ];

  const next: Registry = { version: 1, servers };

  save(env, next);
  return next;
}

export function updateServer(
  env: Env,
  name: string,
  patch: Partial<ServerEntry>,
): ServerEntry {
  const current = findServer(env, name);

  const next = { ...current, ...patch, name };

  addServer(env, next);
  return next;
}

export function removeServer(env: Env, name: string): boolean {
  const registry = readRegistry(env);

  const servers = registry.servers.filter((s) => s.name !== name);

  if (servers.length === registry.servers.length) {
    return false;
  }

  save(env, { version: 1, servers });
  return true;
}

export function listServers(env: Env): ServerEntry[] {
  return readRegistry(env).servers;
}

export function findServer(env: Env, name: string): ServerEntry {
  const server = listServers(env).find((s) => s.name === name);

  if (server === undefined) {
    throw new Error(`No ACLP server named ${name}`);
  }

  return server;
}

export function serversFor(env: Env, harness: HarnessId): ServerEntry[] {
  return listServers(env).filter(
    (s) => s.harnesses === "all" || s.harnesses.includes(harness),
  );
}
