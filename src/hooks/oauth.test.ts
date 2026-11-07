import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { test } from "node:test";
import { readCredential, saveCredential } from "./credentials.ts";
import {
  authorization,
  loginWithBrowser,
  loginWithDevice,
  type OAuthMetadata,
} from "./oauth.ts";
import type { ServerEntry } from "./registry.ts";
import { listen, tempEnv } from "./test-support.ts";

async function form(req: IncomingMessage): Promise<URLSearchParams> {
  let body = "";

  for await (const chunk of req) {
    body += String(chunk);
  }

  return new URLSearchParams(body);
}

async function issuer(
  t: Parameters<typeof tempEnv>[0],
  respond: (params: URLSearchParams) => [number, unknown],
) {
  const grants: URLSearchParams[] = [];

  const server = createServer(async (req, res) => {
    const params = await form(req);

    grants.push(params);

    const [status, body] = respond(params);

    res
      .writeHead(status, { "content-type": "application/json" })
      .end(JSON.stringify(body));
  });

  const origin = await listen(t, server);

  const meta: OAuthMetadata = {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    device_authorization_endpoint: `${origin}/device`,
  };

  return { meta, grants };
}

test("bearer tokens come from the credential store and expiring OAuth tokens are refreshed", async (t) => {
  const env = tempEnv(t);

  const { meta, grants } = await issuer(t, () => [
    200,
    { access_token: "fresh", expires_in: 3600 },
  ]);

  const server: ServerEntry = {
    name: "endurance",
    endpoint: "https://example.com/aclp",
    harnesses: "all",
    events: [],
    requests: [],
    auth: {
      type: "oauth",
      tokenEndpoint: meta.token_endpoint,
      clientId: "aclp",
    },
  };

  await assert.rejects(authorization(env, server), /needs a login/);

  saveCredential(env, "endurance", {
    accessToken: "valid",
    refreshToken: "r-1",
    expiresAt: Date.now() + 3_600_000,
  });
  assert.equal(await authorization(env, server), "Bearer valid");

  saveCredential(env, "endurance", {
    accessToken: "stale",
    refreshToken: "r-1",
    expiresAt: Date.now() + 1_000,
  });
  assert.equal(await authorization(env, server), "Bearer fresh");
  assert.equal(grants[0]?.get("grant_type"), "refresh_token");
  assert.equal(readCredential(env, "endurance")?.refreshToken, "r-1");
  assert.equal(
    await authorization(env, { ...server, auth: { type: "none" } }),
    undefined,
  );
});

test("the browser flow uses PKCE and a loopback redirect", async (t) => {
  const { meta, grants } = await issuer(t, () => [
    200,
    { access_token: "a-1", refresh_token: "r-1" },
  ]);

  const credential = await loginWithBrowser({
    meta,
    clientId: "aclp",
    open: (url) => {
      const authorize = new URL(url);

      const redirect = new URL(
        authorize.searchParams.get("redirect_uri") ?? "",
      );

      assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
      assert.equal(redirect.hostname, "127.0.0.1");
      redirect.searchParams.set("code", "c-1");
      redirect.searchParams.set(
        "state",
        authorize.searchParams.get("state") ?? "",
      );
      void fetch(redirect);
    },
  });

  assert.deepEqual(credential, { accessToken: "a-1", refreshToken: "r-1" });
  assert.equal(grants[0]?.get("code"), "c-1");
  assert.ok((grants[0]?.get("code_verifier") ?? "").length >= 43);
});

test("the device flow polls until the user approves", async (t) => {
  let polls = 0;

  const { meta } = await issuer(t, (params) => {
    if (params.get("grant_type") === null) {
      return [
        200,
        {
          device_code: "d-1",
          user_code: "ABCD-EFGH",
          verification_uri: "https://example.com/device",
          interval: 1,
        },
      ];
    }

    polls += 1;
    return polls < 2
      ? [400, { error: "authorization_pending" }]
      : [200, { access_token: "a-2" }];
  });

  const shown: string[] = [];

  const credential = await loginWithDevice({
    meta,
    clientId: "aclp",
    show: (code) => shown.push(code),
    sleep: async () => undefined,
  });

  assert.deepEqual(credential, { accessToken: "a-2" });
  assert.deepEqual(shown, ["ABCD-EFGH"]);
  assert.equal(polls, 2);
});
