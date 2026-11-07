import { join } from "node:path";
import type { Adapter } from "../adapter.ts";
import { xdgConfig } from "../env.ts";
import { mcpHost, mcpServer } from "./mcp-host.ts";

export const zed: Adapter = mcpHost({
  id: "zed",
  name: "Zed",
  home: (env) => join(xdgConfig(env), "zed"),
  edit: (env, opts) => ({
    kind: "json",
    path:
      opts.scope === "project"
        ? join(env.cwd, ".zed", "settings.json")
        : join(xdgConfig(env), "zed", "settings.json"),
    key: ["context_servers", "aclp"],
    value: mcpServer(opts.runtime, "zed"),
  }),
  notes: [
    "Zed's agent has no lifecycle hooks. Zed settings often contain comments; if so, aclp refuses to rewrite them and you add the context_servers entry by hand. External agents in Zed (Claude Code, Codex) use their own hooks.",
  ],
});
