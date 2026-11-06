import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkStructure,
  MAX_MODULE_LINES,
  MAX_RUNTIME_DEPENDENCIES,
  type SourceFile,
} from "./guard.ts";

const required: SourceFile[] = [
  "src/index.ts",
  "src/client.ts",
  "src/server.ts",
  "src/protocol/index.ts",
  "protocol-source.json",
].map((path) => ({ path, content: "" }));

test("the SDK permits two runtime validators and 400 non-blank lines per authored module", () => {
  assert.equal(MAX_RUNTIME_DEPENDENCIES, 2);
  assert.equal(MAX_MODULE_LINES, 400);
  assert.deepEqual(checkStructure(required, ["ajv", "ajv-formats"], []), []);
});

test("module line limits preserve blank-line grouping", () => {
  const boundary = "statement();\n\n".repeat(MAX_MODULE_LINES);

  assert.deepEqual(
    checkStructure(
      [...required, { path: "src/feature.ts", content: boundary }],
      [],
      [],
    ),
    [],
  );
  assert.match(
    checkStructure(
      [...required, { path: "src/feature.ts", content: `${boundary}extra();` }],
      [],
      [],
    ).join("\n"),
    /401 non-blank lines/,
  );
});

test("dependency counts enforce the boundary and reject install lifecycle scripts", () => {
  assert.match(
    checkStructure(required, ["one", "two", "three"], []).join("\n"),
    /dependencies exceed/,
  );
  assert.match(
    checkStructure(required, [], ["unsafe:postinstall"]).join("\n"),
    /lifecycle script is forbidden/,
  );
});

test("an empty or partial tree cannot pass its structural check", () => {
  assert.equal(checkStructure([], [], []).length, required.length);
  assert.match(
    checkStructure(
      required.filter((file) => file.path !== "src/index.ts"),
      [],
      [],
    ).join("\n"),
    /boundary is missing: src\/index.ts/,
  );
});
