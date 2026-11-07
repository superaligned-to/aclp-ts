import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, Runtime } from "../adapter.ts";
import { type Env, envPath } from "../env.ts";
import { MANAGED } from "../install.ts";
import { VERSION } from "../version.ts";
import { aliased, claudeInput, joined } from "./command-hooks.ts";

export const HERMES_EVENTS = [
  "on_session_start",
  "pre_llm_call",
  "pre_tool_call",
  "post_tool_call",
  "post_llm_call",
  "subagent_start",
  "subagent_stop",
  "on_session_end",
] as const;

function home(env: Env): string {
  return envPath(env, "HERMES_HOME", join(env.home, ".hermes"));
}

export function hermesModule(runtime: Runtime): string {
  return `# ${MANAGED}; reinstall with \`npx aclp install hermes\`.
import json
import subprocess

NODE = ${JSON.stringify(runtime.node)}
HOOK = ${JSON.stringify(runtime.hook)}


def _fire(event, payload, timeout=10):
    try:
        done = subprocess.run(
            [NODE, HOOK, "hermes", event],
            input=json.dumps(payload, default=str),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return json.loads(done.stdout or "{}")
    except Exception:
        return {}


def _session(kwargs):
    return kwargs.get("session_id") or kwargs.get("task_id") or ""


def _on_session_start(**kwargs):
    _fire("on_session_start", {"session_id": _session(kwargs)})


def _pre_llm_call(**kwargs):
    reply = _fire("pre_llm_call", {"session_id": _session(kwargs), "prompt": kwargs.get("user_message") or ""}, 15)
    if reply.get("blocked"):
        return {"action": "block", "message": "ACLP blocked this prompt: " + str(reply["blocked"])}
    if reply.get("context"):
        return {"context": reply["context"]}
    return None


def _pre_tool_call(**kwargs):
    _fire("pre_tool_call", {"session_id": _session(kwargs), "tool_name": kwargs.get("tool_name"), "tool_input": kwargs.get("args")})
    return None


def _post_tool_call(**kwargs):
    _fire("post_tool_call", {"session_id": _session(kwargs), "tool_name": kwargs.get("tool_name"), "tool_input": kwargs.get("args"), "tool_response": kwargs.get("result")})


def _post_llm_call(**kwargs):
    _fire("post_llm_call", {"session_id": _session(kwargs)})


def _subagent_start(**kwargs):
    _fire("subagent_start", {"session_id": kwargs.get("parent_session_id") or "", "agent_id": kwargs.get("child_subagent_id") or kwargs.get("child_session_id"), "agent_type": kwargs.get("child_role")})


def _subagent_stop(**kwargs):
    _fire("subagent_stop", {"session_id": kwargs.get("parent_session_id") or "", "agent_id": kwargs.get("child_session_id"), "agent_type": kwargs.get("child_role")})


def _on_session_end(**kwargs):
    _fire("on_session_end", {"session_id": _session(kwargs), "reason": "interrupted" if kwargs.get("interrupted") else "completed"})


def register(ctx):
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("pre_llm_call", _pre_llm_call)
    ctx.register_hook("pre_tool_call", _pre_tool_call)
    ctx.register_hook("post_tool_call", _post_tool_call)
    ctx.register_hook("post_llm_call", _post_llm_call)
    ctx.register_hook("subagent_start", _subagent_start)
    ctx.register_hook("subagent_stop", _subagent_stop)
    ctx.register_hook("on_session_end", _on_session_end)
`;
}

export const hermes: Adapter = {
  id: "hermes",
  name: "Hermes Agent",
  support: "lifecycle",
  events: HERMES_EVENTS,
  detect: (env) => existsSync(home(env)),
  plan: (env, opts) => {
    const dir =
      opts.scope === "project"
        ? join(env.cwd, ".hermes", "plugins", "aclp")
        : join(home(env), "plugins", "aclp");

    return {
      harness: "hermes",
      scope: opts.scope,
      edits: [
        {
          kind: "file",
          path: join(dir, "plugin.yaml"),
          content: `# ${MANAGED}.\nname: aclp\nversion: ${VERSION}\ndescription: Reports Hermes events to ACLP servers and adds their context to prompts.\nprovides_hooks:\n${HERMES_EVENTS.map((e) => `  - ${e}`).join("\n")}\n`,
        },
        {
          kind: "file",
          path: join(dir, "__init__.py"),
          content: hermesModule(opts.runtime),
        },
      ],
      notes: [
        "Hermes loads general plugins only when enabled: hermes plugins enable aclp, then restart Hermes. The gateway does not load project plugins.",
      ],
    };
  },
  map: aliased(
    {
      on_session_start: "SessionStart",
      pre_llm_call: "UserPromptSubmit",
      pre_tool_call: "PreToolUse",
      post_tool_call: "PostToolUse",
      post_llm_call: "Stop",
      subagent_start: "SubagentStart",
      subagent_stop: "SubagentStop",
      on_session_end: "SessionEnd",
    },
    claudeInput,
    { guarded: true },
  ),
  render: (event, outcome) => {
    if (event !== "pre_llm_call") {
      return { exitCode: 0 };
    }

    const reply =
      outcome.blocked === undefined
        ? outcome.context.length === 0
          ? {}
          : { context: joined(outcome) }
        : { blocked: outcome.blocked };

    return { stdout: `${JSON.stringify(reply)}\n`, exitCode: 0 };
  },
};
