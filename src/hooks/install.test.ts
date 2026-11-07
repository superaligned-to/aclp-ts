import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { install, ownsCommand, status, uninstall } from "./install.ts";
import { plan } from "./plan.ts";
import { runtime, tempEnv } from "./test-support.ts";

const userHook = {
  matcher: "Bash",
  hooks: [{ type: "command", command: "echo mine", timeout: 3 }],
};

function seed(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

test("installing merges beside the user's own hooks and is idempotent", (t) => {
  const env = tempEnv(t);

  const settings = join(env.home, ".claude", "settings.json");

  seed(settings, { model: "opus", hooks: { PostToolUse: [userHook] } });

  const p = plan("claude-code", env, "user", runtime);

  assert.equal(status(p).installed, false);
  assert.deepEqual(
    install(p).map((c) => c.action),
    ["merge"],
  );
  assert.deepEqual(
    install(p).map((c) => c.action),
    ["unchanged"],
  );
  assert.equal(status(p).installed, true);

  const doc = JSON.parse(readFileSync(settings, "utf8"));

  assert.equal(doc.model, "opus");
  assert.deepEqual(doc.hooks.PostToolUse[0], userHook);
  assert.equal(doc.hooks.PostToolUse.length, 2);
  assert.match(
    doc.hooks.UserPromptSubmit[0].hooks[0].command,
    /'\/opt\/aclp\/dist\/aclp-hook\.js' claude-code UserPromptSubmit$/,
  );

  uninstall(p);

  const after = JSON.parse(readFileSync(settings, "utf8"));

  assert.deepEqual(after, {
    model: "opus",
    hooks: { PostToolUse: [userHook] },
  });
  assert.equal(status(p).installed, false);
});

test("reinstalling replaces an older aclp entry instead of adding a second", (t) => {
  const env = tempEnv(t);

  const hooks = join(env.home, ".codex", "hooks.json");

  const stale = {
    hooks: [
      {
        type: "command",
        command: "'/old/node' '/old/aclp-hook.js' codex SessionStart",
        timeout: 5,
      },
    ],
  };

  seed(hooks, { hooks: { SessionStart: [stale] } });

  const p = plan("codex", env, "user", runtime);

  install(p);

  const doc = JSON.parse(readFileSync(hooks, "utf8"));

  assert.equal(doc.hooks.SessionStart.length, 1);
  assert.match(doc.hooks.SessionStart[0].hooks[0].command, /opt\/aclp/);
});

test("ownership is recognised per harness", () => {
  assert.equal(ownsCommand("'/n' '/x/aclp-hook.js' codex Stop", "codex"), true);
  assert.equal(
    ownsCommand("'/n' '/x/aclp-hook.js' codex Stop", "claude-code"),
    false,
  );
  assert.equal(ownsCommand("echo codex Stop", "codex"), false);
});

test("plugin files are written once and never overwrite a user's own file", (t) => {
  const env = tempEnv(t);

  const p = plan("opencode", env, "user", runtime);

  const [edit] = p.edits;

  assert.ok(edit !== undefined && edit.kind === "file");
  assert.deepEqual(
    install(p).map((c) => c.action),
    ["write"],
  );
  assert.match(
    readFileSync(edit.path, "utf8"),
    /import \{ opencodePlugin \} from "file:\/\/\/opt\/aclp\/dist\/runtime\.js"/,
  );
  assert.equal(status(p).installed, true);
  assert.deepEqual(
    uninstall(p).map((c) => c.action),
    ["remove"],
  );

  writeFileSync(edit.path, "export default {};\n");
  assert.throws(() => install(p), /not managed by aclp;/);
  assert.deepEqual(
    uninstall(p).map((c) => c.action),
    ["unchanged"],
  );
});

test("a malformed hooks field is refused rather than clobbered", (t) => {
  const env = tempEnv(t);

  seed(join(env.home, ".claude", "settings.json"), { hooks: [] });

  assert.throws(
    () => install(plan("claude-code", env, "user", runtime)),
    /non-object "hooks"/,
  );
});

test("project scope writes into the working directory", (t) => {
  const env = tempEnv(t);

  const [claude] = plan("claude-code", env, "project", runtime).edits;

  const [pi] = plan("pi", env, "project", runtime).edits;

  assert.equal(claude?.path, join(env.cwd, ".claude", "settings.json"));
  assert.equal(pi?.path, join(env.cwd, ".pi", "extensions", "aclp.ts"));
});
