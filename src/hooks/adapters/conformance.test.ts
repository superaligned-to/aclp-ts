import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { test } from "node:test";
import { type Edit, HARNESSES, type Scope } from "../adapter.ts";
import { ADAPTERS } from "../harnesses.ts";
import { install, ownsCommand, status, uninstall } from "../install.ts";
import { plan } from "../plan.ts";
import { runtime, tempEnv } from "../test-support.ts";

function seed(edit: Edit): string | undefined {
  const foreign = { type: "command", command: "echo mine", timeout: 1 };

  switch (edit.kind) {
    case "file":
      return undefined;
    case "block":
      return "# my own settings\nexport KEEP=1\n";
    case "json":
      return `${JSON.stringify({ theme: "dark", [edit.key[0]]: { mine: { command: "mine" } } }, null, 2)}\n`;
    case "hooks": {
      const [event] = Object.keys(edit.entries);

      const entries = Object.values(edit.entries)[0] ?? [];

      const grouped = entries.some(
        (e) => typeof e === "object" && e !== null && "hooks" in e,
      );

      const mine = grouped ? { hooks: [foreign] } : { command: "echo mine" };

      const hooks = { [event ?? "Event"]: [mine], Unrelated: [mine] };

      return `${JSON.stringify(edit.root === null ? hooks : { theme: "dark", ...(edit.extra ?? {}), hooks }, null, 2)}\n`;
    }
  }
}

for (const harness of HARNESSES) {
  for (const scope of ["user", "project"] as const satisfies Scope[]) {
    test(`${harness} (${scope}) installs idempotently beside user config and uninstalls cleanly`, (t) => {
      const env = tempEnv(t);

      const p = plan(harness, env, scope, runtime);

      assert.ok(p.edits.length > 0);
      assert.ok(ADAPTERS[harness].events.length > 0);

      const seeded = new Map<string, string>();

      for (const edit of p.edits) {
        assert.ok(
          !relative(env.home, edit.path).startsWith(".."),
          `${edit.path} stays inside the test home`,
        );

        const content = seed(edit);

        if (content !== undefined) {
          mkdirSync(dirname(edit.path), { recursive: true });
          writeFileSync(edit.path, content);
          seeded.set(edit.path, content);
        }
      }

      assert.equal(status(p).installed, false);
      assert.ok(install(p).some((c) => c.action !== "unchanged"));
      assert.deepEqual(
        install(p).map((c) => c.action),
        p.edits.map(() => "unchanged"),
      );
      assert.deepEqual(status(p), {
        installed: true,
        partial: false,
        missing: [],
      });

      for (const edit of p.edits) {
        const text = readFileSync(edit.path, "utf8");

        if (edit.kind === "hooks") {
          assert.ok(ownsCommand(text, harness));
          assert.ok(text.includes("echo mine"));
        }

        if (edit.kind === "block") {
          assert.ok(text.startsWith("# my own settings\nexport KEEP=1\n"));
        }
      }

      uninstall(p);
      assert.equal(status(p).installed, false);
      assert.equal(status(p).partial, false);

      for (const [path, content] of seeded) {
        assert.equal(
          readFileSync(path, "utf8"),
          content,
          `${path} is restored`,
        );
      }
    });
  }
}

test("every harness declares a support level and a native event list", () => {
  for (const harness of HARNESSES) {
    const adapter = ADAPTERS[harness];

    assert.equal(adapter.id, harness);
    assert.ok(["lifecycle", "observe", "mcp"].includes(adapter.support));
    assert.ok(adapter.name.length > 0);
  }
});
