import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { type Env, xdgConfig } from "../env.ts";
import { mcpHost, mcpServer } from "./mcp-host.ts";

function dir(env: Env): string {
  if (env.platform === "darwin") {
    return join(env.home, "Library", "Application Support", "Claude");
  }

  return env.platform === "win32"
    ? join(env.vars.APPDATA ?? join(env.home, "AppData", "Roaming"), "Claude")
    : join(xdgConfig(env), "Claude");
}

export const claudeDesktop: Adapter = mcpHost({
  id: "claude-desktop",
  name: "Claude Desktop",
  home: dir,
  edit: (env, opts) => ({
    kind: "json",
    path: join(dir(env), "claude_desktop_config.json"),
    key: ["mcpServers", "aclp"],
    value: mcpServer(opts.runtime, "claude-desktop"),
  }),
  notes: ["Quit and reopen Claude Desktop to load the aclp MCP server."],
});
