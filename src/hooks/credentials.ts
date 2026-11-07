import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { configDir, type Env } from "./env.ts";
import { isRecord, readJson, writeJson } from "./files.ts";

const SERVICE = "aclp";

export interface Credential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface Store {
  readonly kind: "keychain" | "secret-service" | "file";
  get(name: string): string | undefined;
  set(name: string, secret: string): void;
  delete(name: string): void;
}

function run(cmd: string, args: string[], input?: string): string | undefined {
  try {
    return execFileSync(cmd, args, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 5_000,
    });
  } catch {
    return undefined;
  }
}

function available(cmd: string): boolean {
  return run("/bin/sh", ["-c", `command -v ${cmd}`]) !== undefined;
}

function keychain(): Store {
  return {
    kind: "keychain",
    get: (name) =>
      run("security", [
        "find-generic-password",
        "-s",
        SERVICE,
        "-a",
        name,
        "-w",
      ])?.trimEnd(),
    set: (name, secret) => {
      if (
        run("security", [
          "add-generic-password",
          "-U",
          "-s",
          SERVICE,
          "-a",
          name,
          "-w",
          secret,
        ]) === undefined
      ) {
        throw new Error("Could not write the credential to the macOS keychain");
      }
    },
    delete: (name) => {
      run("security", ["delete-generic-password", "-s", SERVICE, "-a", name]);
    },
  };
}

function secretService(): Store {
  return {
    kind: "secret-service",
    get: (name) =>
      run("secret-tool", [
        "lookup",
        "service",
        SERVICE,
        "account",
        name,
      ])?.trimEnd(),
    set: (name, secret) => {
      const args = [
        "store",
        `--label=ACLP ${name}`,
        "service",
        SERVICE,
        "account",
        name,
      ];

      if (run("secret-tool", args, secret) === undefined) {
        throw new Error("Could not write the credential to the Secret Service");
      }
    },
    delete: (name) => {
      run("secret-tool", ["clear", "service", SERVICE, "account", name]);
    },
  };
}

function file(env: Env): Store {
  const path = join(configDir(env), "credentials.json");

  const read = (): Record<string, unknown> => readJson(path) ?? {};

  return {
    kind: "file",
    get: (name) => {
      const value = read()[name];

      return typeof value === "string" ? value : undefined;
    },
    set: (name, secret) => {
      writeJson(path, { ...read(), [name]: secret }, 0o600);
    },
    delete: (name) => {
      const { [name]: _, ...rest } = read();

      writeJson(path, rest, 0o600);
    },
  };
}

export function credentialStore(env: Env): Store {
  if (env.vars.ACLP_CREDENTIALS === "file") {
    return file(env);
  }

  if (env.platform === "darwin" && available("security")) {
    return keychain();
  }

  if (env.platform === "linux" && available("secret-tool")) {
    return secretService();
  }

  return file(env);
}

export function readCredential(env: Env, name: string): Credential | undefined {
  const raw = credentialStore(env).get(name);

  if (raw === undefined) {
    return undefined;
  }

  try {
    const value: unknown = JSON.parse(raw);

    if (isRecord(value) && typeof value.accessToken === "string") {
      return {
        accessToken: value.accessToken,
        ...(typeof value.refreshToken === "string"
          ? { refreshToken: value.refreshToken }
          : {}),
        ...(typeof value.expiresAt === "number"
          ? { expiresAt: value.expiresAt }
          : {}),
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function saveCredential(
  env: Env,
  name: string,
  credential: Credential,
): void {
  credentialStore(env).set(name, JSON.stringify(credential));
}

export function deleteCredential(env: Env, name: string): void {
  credentialStore(env).delete(name);
}
