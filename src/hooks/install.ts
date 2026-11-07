import type { Edit, HooksEdit, Plan } from "./adapter.ts";
import {
  applyBlock,
  applyFile,
  applyJson,
  blockReady,
  type Change,
  fileReady,
  jsonReady,
  ownsCommand,
  removeBlock,
  removeFile,
  removeJson,
  same,
} from "./edits.ts";
import { isRecord, readJson, writeJson } from "./files.ts";

export { type Change, MANAGED, ownsCommand } from "./edits.ts";

export interface Status {
  installed: boolean;
  partial: boolean;
  missing: string[];
}

function ownsHandler(value: unknown, harness: string): boolean {
  return (
    isRecord(value) &&
    typeof value.command === "string" &&
    ownsCommand(value.command, harness)
  );
}

function strip(entry: unknown, harness: string): unknown {
  if (ownsHandler(entry, harness)) {
    return undefined;
  }

  if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
    return entry;
  }

  const hooks = entry.hooks.filter((h) => !ownsHandler(h, harness));

  if (hooks.length === entry.hooks.length) {
    return entry;
  }

  return hooks.length === 0 ? undefined : { ...entry, hooks };
}

function owned(entry: unknown, harness: string): boolean {
  return strip(entry, harness) !== entry;
}

function hooksOf(edit: HooksEdit, doc: Record<string, unknown>) {
  const hooks = edit.root === null ? doc : (doc[edit.root] ?? {});

  if (!isRecord(hooks)) {
    throw new Error(
      `${edit.path} has a non-object "${edit.root}" field; fix it before installing`,
    );
  }

  return hooks;
}

function withHooks(
  edit: HooksEdit,
  doc: Record<string, unknown>,
  hooks: Record<string, unknown>,
): Record<string, unknown> {
  if (edit.root === null) {
    return hooks;
  }

  const { [edit.root]: _, ...rest } = doc;

  return Object.keys(hooks).length === 0
    ? rest
    : { ...rest, [edit.root]: hooks };
}

function stripAll(
  edit: HooksEdit,
  harness: string,
  hooks: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      if (event in edit.entries) {
        throw new Error(
          `${edit.path} hooks.${event} is not an array; fix it before installing`,
        );
      }

      out[event] = entries;
      continue;
    }

    const kept = entries
      .map((e) => strip(e, harness))
      .filter((e) => e !== undefined);

    if (kept.length > 0 || entries.length === 0) {
      out[event] = kept;
    }
  }

  return out;
}

function hooksReady(edit: HooksEdit, harness: string): boolean {
  const doc = readJson(edit.path);

  if (doc === undefined) {
    return false;
  }

  const hooks = hooksOf(edit, doc);

  const extra = Object.keys(edit.extra ?? {}).every(
    (k) => doc[k] !== undefined,
  );

  return (
    extra &&
    Object.entries(edit.entries).every(([event, entries]) => {
      const present = hooks[event];

      return (
        Array.isArray(present) &&
        same(
          present.filter((e) => owned(e, harness)),
          entries,
        )
      );
    })
  );
}

function applyHooks(edit: HooksEdit, harness: string): Change {
  if (hooksReady(edit, harness)) {
    return { path: edit.path, action: "unchanged" };
  }

  const doc = readJson(edit.path) ?? {};

  const hooks = stripAll(edit, harness, hooksOf(edit, doc));

  for (const [event, entries] of Object.entries(edit.entries)) {
    const kept = hooks[event];

    hooks[event] = [...(Array.isArray(kept) ? kept : []), ...entries];
  }

  const extra = Object.fromEntries(
    Object.entries(edit.extra ?? {}).filter(([k]) => doc[k] === undefined),
  );

  writeJson(edit.path, { ...extra, ...withHooks(edit, doc, hooks) });
  return { path: edit.path, action: "merge" };
}

function removeHooks(edit: HooksEdit, harness: string): Change {
  const doc = readJson(edit.path);

  if (doc === undefined) {
    return { path: edit.path, action: "unchanged" };
  }

  const before = hooksOf(edit, doc);

  const after = stripAll(edit, harness, before);

  if (same(after, before)) {
    return { path: edit.path, action: "unchanged" };
  }

  writeJson(edit.path, withHooks(edit, doc, after));
  return { path: edit.path, action: "remove" };
}

function apply(edit: Edit, harness: string): Change {
  switch (edit.kind) {
    case "hooks":
      return applyHooks(edit, harness);
    case "file":
      return applyFile(edit, harness);
    case "block":
      return applyBlock(edit, harness);
    case "json":
      return applyJson(edit, harness);
  }
}

function ready(edit: Edit, harness: string): boolean {
  switch (edit.kind) {
    case "hooks":
      return hooksReady(edit, harness);
    case "file":
      return fileReady(edit);
    case "block":
      return blockReady(edit, harness);
    case "json":
      return jsonReady(edit);
  }
}

function revert(edit: Edit, harness: string): Change {
  switch (edit.kind) {
    case "hooks":
      return removeHooks(edit, harness);
    case "file":
      return removeFile(edit, harness);
    case "block":
      return removeBlock(edit, harness);
    case "json":
      return removeJson(edit, harness);
  }
}

export function install(plan: Plan): Change[] {
  return plan.edits.map((edit) => apply(edit, plan.harness));
}

export function status(plan: Plan): Status {
  const missing = plan.edits
    .filter((e) => !ready(e, plan.harness))
    .map((e) => e.path);

  const installed = missing.length === 0;

  return {
    installed,
    partial: !installed && missing.length < plan.edits.length,
    missing,
  };
}

export function uninstall(plan: Plan): Change[] {
  return [...plan.edits].reverse().map((edit) => revert(edit, plan.harness));
}

function line(edit: Edit): string {
  switch (edit.kind) {
    case "hooks":
      return `merge ${Object.keys(edit.entries).join(", ")} hooks into ${edit.path}`;
    case "file":
      return `write ${edit.path}`;
    case "block":
      return `add a managed block to ${edit.path}:\n${edit.content.trimEnd()}`;
    case "json":
      return `set ${edit.key.join(".")} in ${edit.path} to ${JSON.stringify(edit.value)}`;
  }
}

export function describe(plan: Plan): string[] {
  return plan.edits.map(line);
}
