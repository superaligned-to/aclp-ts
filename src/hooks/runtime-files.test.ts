import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  bundledFiles,
  removeRuntime,
  runtimeDir,
  runtimeReady,
  stableRuntime,
  syncRuntime,
} from "./runtime-files.ts";
import { tempEnv } from "./test-support.ts";

test("the bundle is copied to a stable directory, refreshed on reinstall and removed last", (t) => {
  const env = tempEnv(t);

  const dist = join(env.home, "npx-cache", "dist");

  mkdirSync(dist, { recursive: true });

  for (const name of ["aclp.js", "aclp-hook.js", "runtime.js", "chunk-A.js"]) {
    writeFileSync(join(dist, name), `// ${name} v1\n`);
  }

  writeFileSync(join(dist, "index.d.ts"), "export {};\n");

  const files = bundledFiles(dist);

  assert.deepEqual(files.map((f) => f.name).sort(), [
    "aclp-hook.js",
    "aclp.js",
    "chunk-A.js",
    "package.json",
    "runtime.js",
  ]);
  assert.equal(syncRuntime(env, files), true);
  assert.equal(syncRuntime(env, files), false);
  assert.equal(runtimeReady(env, files), true);
  assert.deepEqual(
    JSON.parse(readFileSync(join(runtimeDir(env), "package.json"), "utf8"))
      .type,
    "module",
  );

  const r = stableRuntime(env, "/usr/bin/node");

  assert.equal(r.hook, join(runtimeDir(env), "aclp-hook.js"));
  assert.equal(r.cli, join(runtimeDir(env), "aclp.js"));
  assert.match(r.module, /^file:\/\/.*\/runtime\/runtime\.js$/);

  writeFileSync(join(dist, "chunk-A.js"), "");
  writeFileSync(join(dist, "aclp.js"), "// aclp.js v2\n");

  const next = bundledFiles(dist).filter((f) => f.name !== "chunk-A.js");

  assert.equal(runtimeReady(env, next), false);
  assert.equal(syncRuntime(env, next), true);
  assert.ok(!readdirSync(runtimeDir(env)).includes("chunk-A.js"));
  assert.equal(
    readFileSync(join(runtimeDir(env), "aclp.js"), "utf8"),
    "// aclp.js v2\n",
  );

  removeRuntime(env);
  assert.deepEqual(readdirSync(runtimeDir(env)), []);
  assert.deepEqual(bundledFiles(join(env.home)), []);
});
