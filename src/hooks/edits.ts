import type { BlockEdit, FileEdit, JsonEdit } from "./adapter.ts";
import {
  isRecord,
  readJson,
  readText,
  remove,
  writeAtomic,
  writeJson,
} from "./files.ts";

export const MANAGED = "Managed by aclp";

export interface Change {
  path: string;
  action: "write" | "merge" | "remove" | "unchanged";
}

export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ownsCommand(value: string, harness: string): boolean {
  return new RegExp(
    `aclp(?:-hook)?(?:\\.[cm]?[jt]s)?'?\\s+${escapeRegex(harness)}\\s`,
  ).test(value);
}

function ownsFile(text: string, harness: string): boolean {
  return text.includes(MANAGED) || ownsCommand(text, harness);
}

export function fileReady(edit: FileEdit): boolean {
  return readText(edit.path) === edit.content;
}

export function applyFile(edit: FileEdit, harness: string): Change {
  const current = readText(edit.path);

  if (current === edit.content) {
    return { path: edit.path, action: "unchanged" };
  }

  if (current !== undefined && !ownsFile(current, harness)) {
    throw new Error(
      `${edit.path} exists and is not managed by aclp; move it before installing`,
    );
  }

  writeAtomic(edit.path, edit.content);
  return { path: edit.path, action: "write" };
}

export function removeFile(edit: FileEdit, harness: string): Change {
  const current = readText(edit.path);

  if (current === undefined || !ownsFile(current, harness)) {
    return { path: edit.path, action: "unchanged" };
  }

  remove(edit.path);
  return { path: edit.path, action: "remove" };
}

function markers(edit: BlockEdit, harness: string): [string, string] {
  return [
    `${edit.comment} >>> ${MANAGED} (${harness})`,
    `${edit.comment} <<< ${MANAGED} (${harness})`,
  ];
}

function block(edit: BlockEdit, harness: string): string {
  const [open, close] = markers(edit, harness);

  return `${open}\n${edit.content.trimEnd()}\n${close}\n`;
}

function split(
  edit: BlockEdit,
  harness: string,
  text: string,
): { before: string; current?: string; after: string } {
  const [open, close] = markers(edit, harness);

  const start = text.indexOf(open);

  const end = text.indexOf(close, start);

  if (start === -1 || end === -1) {
    return { before: text, after: "" };
  }

  const stop = text.indexOf("\n", end);

  const tail = stop === -1 ? text.length : stop + 1;

  return {
    before: text.slice(0, start),
    current: text.slice(start, tail),
    after: text.slice(tail),
  };
}

export function blockReady(edit: BlockEdit, harness: string): boolean {
  const text = readText(edit.path);

  return (
    text !== undefined &&
    split(edit, harness, text).current === block(edit, harness)
  );
}

export function applyBlock(edit: BlockEdit, harness: string): Change {
  const text = readText(edit.path) ?? "";

  const parts = split(edit, harness, text);

  const next = block(edit, harness);

  if (parts.current === next) {
    return { path: edit.path, action: "unchanged" };
  }

  const before =
    parts.before === "" || parts.before.endsWith("\n")
      ? parts.before
      : `${parts.before}\n`;

  writeAtomic(edit.path, `${before}${next}${parts.after}`);
  return { path: edit.path, action: "merge" };
}

export function removeBlock(edit: BlockEdit, harness: string): Change {
  const text = readText(edit.path);

  const parts = text === undefined ? undefined : split(edit, harness, text);

  if (parts?.current === undefined) {
    return { path: edit.path, action: "unchanged" };
  }

  const rest = `${parts.before}${parts.after}`;

  if (rest.trim() === "") {
    remove(edit.path);
  } else {
    writeAtomic(edit.path, rest);
  }

  return { path: edit.path, action: "remove" };
}

function section(edit: JsonEdit, doc: Record<string, unknown>) {
  const value = doc[edit.key[0]] ?? {};

  if (!isRecord(value)) {
    throw new Error(
      `${edit.path} has a non-object "${edit.key[0]}" field; fix it before installing`,
    );
  }

  return value;
}

function ownsValue(value: unknown, harness: string): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.args) &&
    value.args.includes("mcp") &&
    value.args.includes(harness)
  );
}

function readJsonc(path: string): Record<string, unknown> | undefined {
  try {
    return readJson(path);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `${path} is not plain JSON (comments or trailing commas); add the aclp entry by hand: aclp install --dry-run shows it`,
      );
    }

    throw error;
  }
}

export function jsonReady(edit: JsonEdit): boolean {
  const doc = readJsonc(edit.path);

  return doc !== undefined && same(section(edit, doc)[edit.key[1]], edit.value);
}

export function applyJson(edit: JsonEdit, harness: string): Change {
  const doc = readJsonc(edit.path) ?? {};

  const current = section(edit, doc);

  const existing = current[edit.key[1]];

  if (same(existing, edit.value)) {
    return { path: edit.path, action: "unchanged" };
  }

  if (existing !== undefined && !ownsValue(existing, harness)) {
    throw new Error(
      `${edit.path} already has ${edit.key.join(".")} not managed by aclp; rename it before installing`,
    );
  }

  writeJson(edit.path, {
    ...doc,
    [edit.key[0]]: { ...current, [edit.key[1]]: edit.value },
  });
  return { path: edit.path, action: "merge" };
}

export function removeJson(edit: JsonEdit, harness: string): Change {
  const doc = readJsonc(edit.path);

  if (doc === undefined) {
    return { path: edit.path, action: "unchanged" };
  }

  const current = section(edit, doc);

  if (!ownsValue(current[edit.key[1]], harness)) {
    return { path: edit.path, action: "unchanged" };
  }

  const { [edit.key[1]]: _, ...rest } = current;

  const { [edit.key[0]]: __, ...others } = doc;

  writeJson(
    edit.path,
    Object.keys(rest).length === 0
      ? others
      : { ...others, [edit.key[0]]: rest },
  );
  return { path: edit.path, action: "remove" };
}
