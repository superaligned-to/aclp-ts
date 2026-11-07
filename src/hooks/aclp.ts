#!/usr/bin/env node
import { main } from "./cli/main.ts";
import { terminalUi } from "./cli/ui.ts";
import { currentEnv } from "./env.ts";

process.exitCode = await main(process.argv.slice(2), {
  env: currentEnv(),
  ui: terminalUi(process.stdin.isTTY === true && process.stdout.isTTY === true),
  write: (text) => process.stdout.write(text),
  stdin: process.stdin,
});
