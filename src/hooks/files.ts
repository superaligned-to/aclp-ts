import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export function writeAtomic(path: string, content: string, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true });

  const tmp = `${path}.${process.pid}.tmp`;

  writeFileSync(tmp, content, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}

export function remove(path: string): void {
  rmSync(path, { force: true });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readJson(path: string): Record<string, unknown> | undefined {
  const text = readText(path);

  if (text === undefined || text.trim() === "") {
    return undefined;
  }

  const value: unknown = JSON.parse(text);

  if (!isRecord(value)) {
    throw new Error(`${path} does not contain a JSON object`);
  }

  return value;
}

export function writeJson(path: string, value: unknown, mode = 0o644): void {
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`, mode);
}
