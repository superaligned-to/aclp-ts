#!/usr/bin/env node
import { currentEnv } from "./env.ts";
import { readInput, runHook } from "./hook.ts";

try {
  const rendered = await runHook(
    process.argv.slice(2),
    await readInput(process.stdin),
    currentEnv(),
  );

  if (rendered.stdout !== undefined) {
    process.stdout.write(rendered.stdout);
  }

  if (rendered.stderr !== undefined) {
    process.stderr.write(rendered.stderr);
  }

  process.exitCode = rendered.exitCode;
} catch (error) {
  process.stderr.write(
    `aclp-hook: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 0;
}
