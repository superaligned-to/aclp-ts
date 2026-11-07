import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { DiscoveryDocument } from "../index.ts";
import {
  type Credential,
  readCredential,
  saveCredential,
} from "./credentials.ts";
import type { Env } from "./env.ts";
import { isRecord } from "./files.ts";
import type { ServerEntry } from "./registry.ts";

export const DEFAULT_CLIENT_ID = "aclp";

const REFRESH_MARGIN_MS = 60_000;

const LOGIN_TIMEOUT_MS = 300_000;

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export type OAuthMetadata = NonNullable<DiscoveryDocument["auth"]["oauth"]>;

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function credential(value: unknown, previous?: Credential): Credential {
  if (!isRecord(value) || typeof value.access_token !== "string") {
    throw new Error("Token endpoint returned no access_token");
  }

  const refresh =
    typeof value.refresh_token === "string"
      ? value.refresh_token
      : previous?.refreshToken;

  return {
    accessToken: value.access_token,
    ...(refresh === undefined ? {} : { refreshToken: refresh }),
    ...(typeof value.expires_in === "number"
      ? { expiresAt: Date.now() + value.expires_in * 1000 }
      : {}),
  };
}

async function token(
  endpoint: string,
  form: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(10_000),
  });

  const body: unknown = await res.json().catch(() => undefined);

  if (!res.ok) {
    const code =
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : `HTTP ${res.status}`;

    throw Object.assign(new Error(`Token request failed: ${code}`), { code });
  }

  return body;
}

export async function authorization(
  env: Env,
  server: ServerEntry,
): Promise<string | undefined> {
  if (server.auth.type === "none") {
    return undefined;
  }

  const stored = readCredential(env, server.name);

  if (stored === undefined) {
    throw new Error(
      `${server.name} needs a login: run aclp server login ${server.name}`,
    );
  }

  const expiring =
    stored.expiresAt !== undefined &&
    stored.expiresAt - REFRESH_MARGIN_MS < Date.now();

  if (
    server.auth.type !== "oauth" ||
    !expiring ||
    stored.refreshToken === undefined
  ) {
    return `Bearer ${stored.accessToken}`;
  }

  const fresh = credential(
    await token(server.auth.tokenEndpoint, {
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
      client_id: server.auth.clientId,
    }),
    stored,
  );

  saveCredential(env, server.name, fresh);
  return `Bearer ${fresh.accessToken}`;
}

export interface BrowserLogin {
  meta: OAuthMetadata;
  clientId: string;
  open: (url: string) => void;
}

export async function loginWithBrowser(
  login: BrowserLogin,
): Promise<Credential> {
  const verifier = base64url(randomBytes(32));

  const challenge = base64url(createHash("sha256").update(verifier).digest());

  const state = base64url(randomBytes(16));

  let finish: (code: string) => void = () => undefined;

  let fail: (error: Error) => void = () => undefined;

  const received = new Promise<string>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }

    const code = url.searchParams.get("code");

    const ok = code !== null && url.searchParams.get("state") === state;

    res.writeHead(ok ? 200 : 400, {
      "content-type": "text/plain; charset=utf-8",
    });
    res.end(
      ok
        ? "Signed in. You can close this tab."
        : "Sign-in failed. Return to the terminal.",
    );

    if (ok) {
      finish(code);
    } else {
      fail(
        new Error(
          url.searchParams.get("error") ??
            "Authorization response did not match",
        ),
      );
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();

  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Sign-in listener has no TCP address");
  }

  const redirect = `http://127.0.0.1:${address.port}/callback`;

  const authorize = new URL(login.meta.authorization_endpoint);

  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: login.clientId,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    ...(login.meta.scopes_supported === undefined
      ? {}
      : { scope: login.meta.scopes_supported.join(" ") }),
  }).toString();

  const timer = setTimeout(
    () => fail(new Error("Sign-in timed out")),
    LOGIN_TIMEOUT_MS,
  );

  try {
    login.open(authorize.href);

    const code = await received;

    return credential(
      await token(login.meta.token_endpoint, {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        client_id: login.clientId,
        code_verifier: verifier,
      }),
    );
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

export interface DeviceLogin {
  meta: OAuthMetadata;
  clientId: string;
  show: (code: string, url: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export async function loginWithDevice(login: DeviceLogin): Promise<Credential> {
  const endpoint = login.meta.device_authorization_endpoint;

  if (endpoint === undefined) {
    throw new Error("This server does not offer the device flow");
  }

  const start = await token(endpoint, {
    client_id: login.clientId,
    ...(login.meta.scopes_supported === undefined
      ? {}
      : { scope: login.meta.scopes_supported.join(" ") }),
  });

  if (
    !isRecord(start) ||
    typeof start.device_code !== "string" ||
    typeof start.user_code !== "string" ||
    typeof start.verification_uri !== "string"
  ) {
    throw new Error("Device authorization response is incomplete");
  }

  const wait =
    login.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let interval =
    (typeof start.interval === "number" ? start.interval : 5) * 1000;

  const deadline =
    Date.now() +
    (typeof start.expires_in === "number"
      ? start.expires_in * 1000
      : LOGIN_TIMEOUT_MS);

  login.show(start.user_code, start.verification_uri);

  while (Date.now() < deadline) {
    await wait(interval);

    try {
      return credential(
        await token(login.meta.token_endpoint, {
          grant_type: DEVICE_GRANT,
          device_code: start.device_code,
          client_id: login.clientId,
        }),
      );
    } catch (error) {
      const code = isRecord(error) ? error.code : undefined;

      if (code === "slow_down") {
        interval += 5_000;
      } else if (code !== "authorization_pending") {
        throw error;
      }
    }
  }

  throw new Error("Device sign-in expired");
}
