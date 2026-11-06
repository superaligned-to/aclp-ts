import { isRecord } from "./json.ts";
import { compileLocalSchema } from "./schema-validator.ts";

const unstructuredKeys = new Set([
  "arguments",
  "structuredContent",
  "value",
  "data",
]);

function unique(values: unknown, key: string): boolean {
  if (!Array.isArray(values)) {
    return false;
  }

  const seen = new Set<unknown>();

  for (const item of values) {
    if (!isRecord(item)) {
      return false;
    }

    const identity = item[key];

    if (identity === undefined) {
      continue;
    }

    if (seen.has(identity)) {
      return false;
    }

    seen.add(identity);
  }

  return true;
}

function networkOrigin(value: string): boolean {
  if (!/^https?:\/\/[^/?#\\]+\/?$/i.test(value) || value.includes("@")) {
    return false;
  }

  try {
    const url = new URL(value);

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      url.username === "" &&
      url.password === "" &&
      !value.includes("?") &&
      !value.includes("#") &&
      (url.pathname === "" || url.pathname === "/")
    );
  } catch {
    return false;
  }
}

function embeddedSchema(schema: unknown): boolean {
  if (typeof schema !== "boolean" && !isRecord(schema)) {
    return false;
  }

  try {
    compileLocalSchema(schema);

    return true;
  } catch {
    return false;
  }
}

function content(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every(content);
  }

  if (!isRecord(value)) {
    return true;
  }

  if (
    (value.type === "image" || value.type === "audio") &&
    typeof value.data === "string" &&
    Buffer.from(value.data, "base64").toString("base64") !== value.data
  ) {
    return false;
  }

  if (
    value.kind === "network" &&
    typeof value.origin === "string" &&
    !networkOrigin(value.origin)
  ) {
    return false;
  }

  if (
    Object.hasOwn(value, "inputSchema") &&
    !embeddedSchema(value.inputSchema)
  ) {
    return false;
  }

  if (value.kind === "form" && !embeddedSchema(value.schema)) {
    return false;
  }

  for (const [key, child] of Object.entries(value)) {
    if (
      key === "schema" ||
      key === "inputSchema" ||
      unstructuredKeys.has(key)
    ) {
      continue;
    }

    if (
      key === "resource" &&
      isRecord(child) &&
      typeof child.blob === "string" &&
      Buffer.from(child.blob, "base64").toString("base64") !== child.blob
    ) {
      return false;
    }

    if (!content(child)) {
      return false;
    }
  }

  return true;
}

export function validateSemantics(method: string, params: unknown): boolean {
  if (!isRecord(params) || !content(params)) {
    return false;
  }

  if (method === "catalog.changed" && !unique(params.entries, "name")) {
    return false;
  }

  if (method === "permission.requested" && !unique(params.options, "id")) {
    return false;
  }

  if (method === "plan.updated" && !unique(params.steps, "id")) {
    return false;
  }

  if (method === "configuration.changed" && !unique(params.changes, "key")) {
    return false;
  }

  if (method === "tool.batch.finished") {
    if (
      !Array.isArray(params.calls) ||
      !unique(
        params.calls.map((item: unknown) =>
          isRecord(item) ? item.call : undefined,
        ),
        "id",
      )
    ) {
      return false;
    }
  }

  if (
    method === "interaction.resolved" &&
    isRecord(params.interaction) &&
    params.interaction.kind === "form" &&
    isRecord(params.response) &&
    params.response.status === "accepted"
  ) {
    const schema = params.interaction.schema;

    if (typeof schema !== "boolean" && !isRecord(schema)) {
      return false;
    }

    try {
      return compileLocalSchema(schema)(params.response.value);
    } catch {
      return false;
    }
  }

  return true;
}
