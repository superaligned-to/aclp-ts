import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkBundle,
  checkStructure,
  checkVersion,
  MAX_MODULE_LINES,
  MAX_RUNTIME_DEPENDENCIES,
  REQUIRED,
  REVIEWED_LIFECYCLE_SCRIPTS,
  type SourceFile,
} from "./guard.ts";

const required: SourceFile[] = REQUIRED.map((path) => ({
  path,
  content: "",
}));

test("the package permits two runtime validators and 400 non-blank lines per authored module", () => {
  assert.equal(MAX_RUNTIME_DEPENDENCIES, 2);
  assert.equal(MAX_MODULE_LINES, 400);
  assert.deepEqual(REVIEWED_LIFECYCLE_SCRIPTS, ["esbuild:postinstall"]);
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

test("dependency counts enforce the boundary and reject unreviewed install lifecycle scripts", () => {
  assert.match(
    checkStructure(required, ["one", "two", "three"], []).join("\n"),
    /dependencies exceed/,
  );
  assert.match(
    checkStructure(required, [], ["unsafe:postinstall"]).join("\n"),
    /lifecycle script is forbidden/,
  );
  assert.deepEqual(checkStructure(required, [], ["esbuild:postinstall"]), []);
});

test("an empty or partial tree cannot pass its structural check", () => {
  assert.equal(checkStructure([], [], []).length, required.length);
  assert.match(
    checkStructure(
      required.filter((file) => file.path !== "src/hooks/aclp-hook.ts"),
      [],
      [],
    ).join("\n"),
    /boundary is missing: src\/hooks\/aclp-hook.ts/,
  );
});

test("bundled bins may import only node builtins and sibling chunks", () => {
  assert.deepEqual(
    checkBundle([
      {
        path: "dist/bin/aclp.js",
        content:
          'import { a } from "./chunk-X.js";\nimport http from "node:http";\nexport { b } from "./chunk-Y.js";',
      },
    ]),
    [],
  );
  assert.match(
    checkBundle([
      { path: "dist/bin/aclp.js", content: 'import { c } from "ajv";' },
    ]).join("\n"),
    /imports ajv/,
  );
});

test("the CLI version must equal the package version", () => {
  assert.deepEqual(
    checkVersion('export const VERSION = "0.1.0";', "0.1.0"),
    [],
  );
  assert.equal(
    checkVersion('export const VERSION = "0.1.0";', "0.2.0").length,
    1,
  );
  assert.equal(checkVersion("", "0.1.0").length, 1);
});
