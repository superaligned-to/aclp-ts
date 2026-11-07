import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Runtime } from "./adapter.ts";
import { configDir, type Env } from "./env.ts";
import { readText, remove, writeAtomic } from "./files.ts";
import { VERSION } from "./version.ts";

export function runtimeDir(env: Env): string {
  return join(configDir(env), "runtime");
}

export function stableRuntime(env: Env, node = process.execPath): Runtime {
  const dir = runtimeDir(env);

  return {
    node,
    hook: join(dir, "aclp-hook.js"),
    cli: join(dir, "aclp.js"),
    module: pathToFileURL(join(dir, "runtime.js")).href,
  };
}

export interface RuntimeFile {
  name: string;
  content: string;
}

// The bins and plugin runtime are bundled into dist/bin; the library itself is emitted beside it.
function bundleDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));

  return basename(here) === "bin" ? here : join(here, "..", "bin");
}

export function bundledFiles(dir = bundleDir()): RuntimeFile[] {
  if (!existsSync(dir)) {
    return [];
  }

  const names = readdirSync(dir).filter((n) => n.endsWith(".js"));

  if (!names.includes("aclp-hook.js") || !names.includes("runtime.js")) {
    return [];
  }

  return [
    ...names.map((name) => ({
      name,
      content: readFileSync(join(dir, name), "utf8"),
    })),
    {
      name: "package.json",
      content: `${JSON.stringify({ name: "aclp-runtime", version: VERSION, private: true, type: "module" }, null, 2)}\n`,
    },
  ];
}

function installed(env: Env): string[] {
  try {
    return readdirSync(runtimeDir(env)).filter(
      (n) => n.endsWith(".js") || n === "package.json",
    );
  } catch {
    return [];
  }
}

export function runtimeReady(
  env: Env,
  files: RuntimeFile[] = bundledFiles(),
): boolean {
  return files.every(
    (f) => readText(join(runtimeDir(env), f.name)) === f.content,
  );
}

export function syncRuntime(
  env: Env,
  files: RuntimeFile[] = bundledFiles(),
): boolean {
  if (files.length === 0 || runtimeReady(env, files)) {
    return false;
  }

  const keep = new Set(files.map((f) => f.name));

  for (const f of files) {
    writeAtomic(
      join(runtimeDir(env), f.name),
      f.content,
      f.name.endsWith(".js") ? 0o755 : 0o644,
    );
  }

  for (const name of installed(env)) {
    if (!keep.has(name)) {
      remove(join(runtimeDir(env), name));
    }
  }

  return true;
}

export function removeRuntime(env: Env): void {
  for (const name of installed(env)) {
    remove(join(runtimeDir(env), name));
  }
}
