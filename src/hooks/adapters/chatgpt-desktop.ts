import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { type Env, envPath } from "../env.ts";
import { mcpHost, mcpServer } from "./mcp-host.ts";

function codexHome(env: Env): string {
  return envPath(env, "CODEX_HOME", join(env.home, ".codex"));
}

function toml(value: unknown): string {
  return JSON.stringify(value);
}

export const chatgptDesktop: Adapter = mcpHost({
  id: "chatgpt-desktop",
  name: "ChatGPT Desktop",
  home: (env) =>
    join(env.home, "Library", "Application Support", "com.openai.chat"),
  edit: (env, opts) => {
    const server = mcpServer(opts.runtime, "chatgpt-desktop");

    return {
      kind: "block",
      path: join(codexHome(env), "config.toml"),
      comment: "#",
      content: `[mcp_servers.aclp]\ncommand = ${toml(server.command)}\nargs = ${toml(server.args)}\n`,
    };
  },
  notes: [
    "The ChatGPT desktop app runs local STDIO MCP servers from ~/.codex/config.toml, which Codex shares. ChatGPT web chats only reach remote HTTPS connectors, and desktop chat sessions may not expose local tools yet (openai/codex#38162); Codex sessions do.",
  ],
});
