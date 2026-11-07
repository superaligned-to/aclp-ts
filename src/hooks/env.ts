import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface Env {
  home: string;
  cwd: string;
  platform: NodeJS.Platform;
  vars: Readonly<Record<string, string | undefined>>;
}

export function currentEnv(): Env {
  return {
    home: homedir(),
    cwd: process.cwd(),
    platform: process.platform,
    vars: process.env,
  };
}

function absolute(env: Env, value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  return isAbsolute(value) ? value : resolve(env.cwd, value);
}

export function xdgConfig(env: Env): string {
  return absolute(env, env.vars.XDG_CONFIG_HOME) ?? join(env.home, ".config");
}

export function configDir(env: Env): string {
  return (
    absolute(env, env.vars.ACLP_CONFIG_DIR) ?? join(xdgConfig(env), "aclp")
  );
}

export function envPath(env: Env, name: string, fallback: string): string {
  return absolute(env, env.vars[name]) ?? fallback;
}
