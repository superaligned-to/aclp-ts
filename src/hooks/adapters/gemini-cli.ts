import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { envPath } from "../env.ts";
import { contextHook } from "./command-hooks.ts";
import { hookAdapter } from "./hook-adapter.ts";

export const geminiCli: Adapter = hookAdapter({
  id: "gemini-cli",
  name: "Gemini CLI",
  support: "lifecycle",
  home: (env) => envPath(env, "GEMINI_CLI_HOME", join(env.home, ".gemini")),
  path: (env, opts) =>
    opts.scope === "project"
      ? join(env.cwd, ".gemini", "settings.json")
      : join(
          envPath(env, "GEMINI_CLI_HOME", join(env.home, ".gemini")),
          "settings.json",
        ),
  hooks: [
    { event: "SessionStart", timeout: 5_000 },
    { event: "BeforeAgent", timeout: 15_000 },
    { event: "BeforeTool", timeout: 5_000 },
    { event: "AfterTool", timeout: 5_000 },
    { event: "AfterAgent", timeout: 10_000 },
    { event: "SessionEnd", timeout: 5_000 },
  ],
  handler: (command, timeout) => ({
    type: "command",
    name: "aclp",
    command,
    timeout,
  }),
  names: {
    SessionStart: "SessionStart",
    BeforeAgent: "UserPromptSubmit",
    BeforeTool: "PreToolUse",
    AfterTool: "PostToolUse",
    AfterAgent: "Stop",
    SessionEnd: "SessionEnd",
  },
  render: contextHook("BeforeAgent"),
  notes: [
    "Gemini CLI reads hooks at startup; restart it. Hook timeouts are in milliseconds.",
  ],
});
