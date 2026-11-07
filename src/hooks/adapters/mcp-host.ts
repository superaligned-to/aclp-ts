import { existsSync } from "node:fs";
import type {
  Adapter,
  Edit,
  HarnessId,
  PlanOptions,
  Runtime,
} from "../adapter.ts";
import type { Env } from "../env.ts";
import { aliased, claudeInput } from "./command-hooks.ts";

export const MCP_EVENTS = ["initialize", "context", "shutdown"] as const;

export function mcpServer(runtime: Runtime, harness: HarnessId) {
  return { command: runtime.node, args: [runtime.cli, "mcp", harness] };
}

export interface McpHostSpec {
  id: HarnessId;
  name: string;
  home: (env: Env) => string;
  edit: (env: Env, opts: PlanOptions) => Edit;
  notes: readonly string[];
}

export function mcpHost(spec: McpHostSpec): Adapter {
  return {
    id: spec.id,
    name: spec.name,
    support: "mcp",
    events: MCP_EVENTS,
    detect: (env) => existsSync(spec.home(env)),
    plan: (env, opts) => ({
      harness: spec.id,
      scope: opts.scope,
      edits: [spec.edit(env, opts)],
      notes: [
        "There are no lifecycle hooks here: the model decides when to call the aclp_context tool, which asks your servers for context with an input.submitted request.",
        ...spec.notes,
      ],
    }),
    map: aliased(
      {
        initialize: "SessionStart",
        context: "UserPromptSubmit",
        shutdown: "SessionEnd",
      },
      claudeInput,
      { guarded: true },
    ),
    render: () => ({ exitCode: 0 }),
  };
}
