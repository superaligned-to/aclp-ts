import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAX_MODULE_LINES = 400;

// AJV and its URI/regex formats enforce the canonical Draft-07 contract. The CLI adds none: its prompts library is bundled into dist/bin.
export const MAX_RUNTIME_DEPENDENCIES = 2;

// esbuild ships its binary as an optional dependency; its postinstall never runs because pnpm builds nothing.
export const REVIEWED_LIFECYCLE_SCRIPTS = ["esbuild:postinstall"];

export const REQUIRED = [
  "src/index.ts",
  "src/client.ts",
  "src/server.ts",
  "src/protocol/index.ts",
  "protocol-source.json",
  "src/hooks/index.ts",
  "src/hooks/runtime.ts",
  "src/hooks/aclp.ts",
  "src/hooks/aclp-hook.ts",
  "src/hooks/adapters/claude-code.ts",
  "src/hooks/adapters/codex.ts",
  "src/hooks/adapters/opencode.ts",
  "src/hooks/adapters/pi.ts",
  "src/hooks/mcp.ts",
  "src/hooks/runtime-files.ts",
];

export interface SourceFile {
  path: string;
  content: string;
}

export function checkStructure(
  files: readonly SourceFile[],
  dependencies: readonly string[],
  installScripts: readonly string[],
): string[] {
  const errors: string[] = [];

  const names = new Set(files.map((file) => file.path));

  for (const required of REQUIRED) {
    if (!names.has(required)) {
      errors.push(`Required boundary is missing: ${required}.`);
    }
  }

  if (dependencies.length > MAX_RUNTIME_DEPENDENCIES) {
    errors.push(`Runtime dependencies exceed ${MAX_RUNTIME_DEPENDENCIES}.`);
  }

  for (const script of installScripts) {
    if (!REVIEWED_LIFECYCLE_SCRIPTS.includes(script)) {
      errors.push(
        `Dependency install lifecycle script is forbidden: ${script}.`,
      );
    }
  }

  for (const file of files) {
    if (
      !file.path.endsWith(".ts") ||
      file.path === "src/protocol/generated.ts"
    ) {
      continue;
    }

    // Count non-blank formatted lines, including comments; preserve semantic whitespace.
    const lines = file.content
      .split("\n")
      .filter((line) => line.trim() !== "").length;

    if (lines > MAX_MODULE_LINES) {
      errors.push(
        `${file.path}: ${lines} non-blank lines exceed ${MAX_MODULE_LINES}.`,
      );
    }
  }

  return errors;
}

const IMPORT =
  /(?:^|[;\s])(?:import|export)\b[^"'`;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

export function checkBundle(files: readonly SourceFile[]): string[] {
  const errors: string[] = [];

  for (const file of files) {
    for (const match of file.content.matchAll(IMPORT)) {
      const spec = match[1] ?? match[2] ?? "";

      if (!spec.startsWith("node:") && !spec.startsWith("./")) {
        errors.push(`${file.path} imports ${spec}; bundle it into dist/bin.`);
      }
    }
  }

  return errors;
}

export function checkVersion(
  versionSource: string,
  manifestVersion: unknown,
): string[] {
  const declared = /export const VERSION = "([^"]+)";/.exec(versionSource)?.[1];

  return declared !== undefined && declared === manifestVersion
    ? []
    : [
        `src/hooks/version.ts VERSION (${declared ?? "missing"}) must equal package.json version (${String(manifestVersion)}).`,
      ];
}

async function bundle(root: string): Promise<SourceFile[]> {
  const dir = join(root, "dist/bin");

  const names = (await readdir(dir)).filter((n) => n.endsWith(".js"));

  return Promise.all(
    names.map(async (n) => ({
      path: `dist/bin/${n}`,
      content: await readFile(join(dir, n), "utf8"),
    })),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);

  if (!isRecord(value)) {
    throw new Error("Expected a JSON object.");
  }

  return value;
}

async function sourceFiles(
  root: string,
  current = root,
): Promise<SourceFile[]> {
  const files: SourceFile[] = [];

  for (const entry of await readdir(current, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) {
      continue;
    }

    const path = join(current, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(root, path)));
    } else if (entry.isFile()) {
      files.push({
        path: relative(root, path),
        content: await readFile(path, "utf8"),
      });
    }
  }

  return files;
}

async function lifecycleScripts(root: string): Promise<string[]> {
  const scripts: string[] = [];

  async function inspect(path: string): Promise<void> {
    const manifest = object(await readFile(join(path, "package.json"), "utf8"));

    const configured = manifest.scripts;

    if (typeof configured !== "object" || configured === null) {
      return;
    }

    for (const name of ["preinstall", "install", "postinstall"]) {
      if (name in configured) {
        scripts.push(`${String(manifest.name)}:${name}`);
      }
    }
  }

  const store = join(root, "node_modules/.pnpm");

  await inspect(root);

  for (const entry of await readdir(store, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") {
      continue;
    }

    const modules = join(store, entry.name, "node_modules");

    for (const module of await readdir(modules, { withFileTypes: true })) {
      if (!module.isDirectory()) {
        continue;
      }

      const path = join(modules, module.name);

      if (module.name.startsWith("@")) {
        for (const scoped of await readdir(path, { withFileTypes: true })) {
          if (scoped.isDirectory()) {
            await inspect(join(path, scoped.name));
          }
        }
      } else {
        await inspect(path);
      }
    }
  }

  return scripts;
}

async function main(): Promise<void> {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));

  const manifest = object(await readFile(join(root, "package.json"), "utf8"));

  const dependencies = manifest.dependencies;

  if (typeof dependencies !== "object" || dependencies === null) {
    throw new Error("The manifest must declare its runtime dependencies.");
  }

  const files = await sourceFiles(root);

  const errors = [
    ...checkStructure(
      files,
      Object.keys(dependencies),
      await lifecycleScripts(root),
    ),
    ...checkVersion(
      files.find((f) => f.path === "src/hooks/version.ts")?.content ?? "",
      manifest.version,
    ),
    ...checkBundle(await bundle(root)),
  ];

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  console.log(
    "Repository structure, module limits, self-contained bundle and dependency lifecycle checks passed.",
  );
}

const entry = process.argv[1];

if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
