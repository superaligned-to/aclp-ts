import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const schemaPath = new URL("../src/protocol/schema.json", import.meta.url);

const manifest: unknown = JSON.parse(
  await readFile(new URL("../protocol-source.json", import.meta.url), "utf8"),
);

const source = await readFile(schemaPath, "utf8");

if (
  typeof manifest !== "object" ||
  manifest === null ||
  !("schemaSha256" in manifest) ||
  manifest.schemaSha256 !== createHash("sha256").update(source).digest("hex")
) {
  throw new Error(
    "Pinned protocol schema digest does not match protocol-source.json",
  );
}

const schema: unknown = JSON.parse(source);

if (
  typeof schema !== "object" ||
  schema === null ||
  !("definitions" in schema) ||
  typeof schema.definitions !== "object" ||
  schema.definitions === null
) {
  throw new Error("Protocol schema has no definitions");
}

const definitions = schema.definitions;

if (
  !("StandardInvocation" in definitions) ||
  typeof definitions.StandardInvocation !== "object" ||
  definitions.StandardInvocation === null ||
  !("allOf" in definitions.StandardInvocation) ||
  !Array.isArray(definitions.StandardInvocation.allOf)
) {
  throw new Error("Protocol schema has no standard dispatch");
}

const branches: unknown = definitions.StandardInvocation.allOf[1];

if (
  typeof branches !== "object" ||
  branches === null ||
  !("oneOf" in branches) ||
  !Array.isArray(branches.oneOf)
) {
  throw new Error("Protocol dispatch has no methods");
}

const methods: Record<string, string> = {};

for (const branch of branches.oneOf) {
  if (
    typeof branch !== "object" ||
    branch === null ||
    !("properties" in branch) ||
    typeof branch.properties !== "object" ||
    branch.properties === null
  ) {
    throw new Error("Invalid protocol dispatch branch");
  }

  const properties = branch.properties;

  if (
    !("method" in properties) ||
    typeof properties.method !== "object" ||
    properties.method === null ||
    !("const" in properties.method) ||
    typeof properties.method.const !== "string" ||
    !("params" in properties) ||
    typeof properties.params !== "object" ||
    properties.params === null ||
    !("$ref" in properties.params) ||
    typeof properties.params.$ref !== "string"
  ) {
    throw new Error("Invalid protocol method definition");
  }

  methods[properties.method.const] = properties.params.$ref;
}

// JSON Schema validity remains a runtime check; TypeScript models embedded schemas as objects or booleans.
Object.assign(definitions, {
  Schema: {
    anyOf: [
      { type: "boolean" },
      { type: "object", additionalProperties: true },
    ],
  },
});

if (!("oneOf" in schema) || !Array.isArray(schema.oneOf)) {
  throw new Error("Protocol schema root has no message union");
}

// json-schema-to-typescript emits only reachable definitions, so the generation input also lists the discovery document.
schema.oneOf.push({ $ref: "#/definitions/DiscoveryDocument" });

const directory = await mkdtemp(join(tmpdir(), "aclp-types-"));

try {
  const input = join(directory, "schema.json");

  await writeFile(input, JSON.stringify(schema));

  const output = join(directory, "types.ts");

  await promisify(execFile)(process.execPath, [
    new URL(
      "../node_modules/json-schema-to-typescript/dist/src/cli.js",
      import.meta.url,
    ).pathname,
    "--input",
    input,
    "--output",
    output,
    "--unknownAny",
    "--strictIndexSignatures",
    "--unreachableDefinitions",
    "--bannerComment",
    "",
    "--no-$refOptions.resolve.file",
    "--no-$refOptions.resolve.http",
  ]);

  const types = await readFile(output, "utf8");

  const mapping = `\nexport const eventDefinitions = ${JSON.stringify(methods, null, 2)} as const;\n\nexport type EventMethod = keyof typeof eventDefinitions;\n\nexport type EventMap = { [Event in StandardInvocation as Event["method"]]: Event["params"] };\n\nexport type EventParams<Method extends EventMethod> = EventMap[Method];\n`;

  const destination = new URL("../src/protocol/generated.ts", import.meta.url);

  if (process.argv.includes("--check")) {
    if ((await readFile(destination, "utf8")) !== types + mapping) {
      throw new Error("Generated protocol types are stale; run pnpm generate");
    }
  } else {
    await writeFile(destination, types + mapping);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
