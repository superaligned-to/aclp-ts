import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { contextServer, register, tempEnv } from "../test-support.ts";
import { hermesModule } from "./hermes.ts";

const DRIVER = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("aclp_plugin", sys.argv[1])
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)
hooks = {}
class Ctx:
    def register_hook(self, name, fn):
        hooks[name] = fn
plugin.register(Ctx())
hooks["on_session_start"](session_id="h-1", model="m", platform="cli")
reply = hooks["pre_llm_call"](session_id="h-1", user_message="Plan the release", conversation_history=[], is_first_turn=True, model="m", platform="cli")
hooks["post_tool_call"](tool_name="terminal", args={"command": "ls"}, result="a b", task_id="h-1", duration_ms=3)
print(json.dumps({"reply": reply, "hooks": sorted(hooks)}))
`;

const python = spawnSync("python3", ["--version"]).status === 0;

test("the Hermes plugin returns server context from pre_llm_call", {
  skip: !python,
}, async (t) => {
  const env = tempEnv(t);

  const seen: { method: string; client?: string }[] = [];

  register(env, await contextServer(t, seen));

  const dir = join(env.home, ".hermes", "plugins", "aclp");

  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "__init__.py"),
    hermesModule({
      node: process.execPath,
      hook: fileURLToPath(new URL("../aclp-hook.ts", import.meta.url)),
      cli: "",
      module: "",
    }),
  );
  writeFileSync(join(env.home, "driver.py"), DRIVER);

  const child = spawn(
    "python3",
    [join(env.home, "driver.py"), join(dir, "__init__.py")],
    {
      env: {
        ...process.env,
        HOME: env.home,
        ACLP_CONFIG_DIR: join(env.home, ".config", "aclp"),
        ACLP_CREDENTIALS: "file",
      },
    },
  );

  let stdout = "";

  child.stdout.on("data", (d) => {
    stdout += String(d);
  });

  await new Promise((resolve) => child.on("close", resolve));

  const result = JSON.parse(stdout);

  assert.deepEqual(result.reply, { context: "Remembered: prefer small PRs." });
  assert.equal(result.hooks.length, 8);
  assert.deepEqual(
    seen.map((s) => s.method),
    ["session.started", "input.submitted", "tool.finished"],
  );
  assert.ok(seen.every((s) => s.client === "aclp/0.1.0 hermes"));
});
