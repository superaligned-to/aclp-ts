import {
  HARNESSES,
  type HarnessId,
  isHarness,
  type Scope,
  SUPPORT_LABELS,
  SUPPORTS,
  type Support,
} from "../adapter.ts";
import { readHealth } from "../dispatch.ts";
import type { Env } from "../env.ts";
import { ADAPTERS } from "../harnesses.ts";
import { describe, install, status, uninstall } from "../install.ts";
import { plan } from "../plan.ts";
import { serversFor } from "../registry.ts";
import {
  bundledFiles,
  removeRuntime,
  runtimeDir,
  runtimeReady,
  syncRuntime,
} from "../runtime-files.ts";
import type { Ui } from "./ui.ts";

export interface HarnessFlags {
  harnesses: string[];
  scope: Scope;
  yes: boolean;
  dryRun: boolean;
}

export function parseHarnesses(values: string[]): HarnessId[] {
  const out = values.flatMap((v) => v.split(",")).filter((v) => v !== "");

  for (const value of out) {
    if (!isHarness(value)) {
      throw new Error(
        `Unknown harness ${value}; supported: ${HARNESSES.join(", ")}`,
      );
    }
  }

  return out.filter(isHarness);
}

async function choose(
  env: Env,
  ui: Ui,
  flags: HarnessFlags,
  verb: string,
): Promise<HarnessId[]> {
  const named = parseHarnesses(flags.harnesses);

  if (named.length > 0) {
    return named;
  }

  const detected = HARNESSES.filter((h) => ADAPTERS[h].detect(env));

  if (!ui.interactive) {
    if (detected.length === 0) {
      throw new Error(
        "No supported harness detected; name one, e.g. aclp install claude-code",
      );
    }

    return detected;
  }

  return ui.multiselect(
    `Which harnesses should ${verb}?`,
    HARNESSES.map((h) => ({
      value: h,
      label: ADAPTERS[h].name,
      ...(detected.includes(h) ? { hint: "detected" } : {}),
    })),
    detected,
  );
}

export async function installCommand(
  env: Env,
  ui: Ui,
  flags: HarnessFlags,
): Promise<void> {
  const harnesses = await choose(env, ui, flags, "report to ACLP servers");

  const plans = harnesses.map((h) => plan(h, env, flags.scope));

  const files = bundledFiles();

  ui.note(
    [
      ...(files.length === 0 || runtimeReady(env, files)
        ? []
        : [`copy the aclp runtime to ${runtimeDir(env)}`]),
      ...plans.flatMap((p) =>
        describe(p).map((line) => `${ADAPTERS[p.harness].name}: ${line}`),
      ),
    ].join("\n"),
    "Plan",
  );

  if (flags.dryRun) {
    return;
  }

  if (
    ui.interactive &&
    !flags.yes &&
    !(await ui.confirm("Apply these changes?"))
  ) {
    ui.warn("Nothing changed.");
    return;
  }

  if (syncRuntime(env, files)) {
    ui.info(
      `Runtime copied to ${runtimeDir(env)}; hooks keep working after npx cleans its cache.`,
    );
  }

  for (const p of plans) {
    const changes = install(p);

    const changed = changes.filter((c) => c.action !== "unchanged").length;

    ui.success(
      `${ADAPTERS[p.harness].name}: ${changed === 0 ? "already installed" : "installed"}`,
    );

    for (const note of p.notes) {
      ui.info(note);
    }
  }
}

export async function uninstallCommand(
  env: Env,
  ui: Ui,
  flags: HarnessFlags,
): Promise<void> {
  const named = parseHarnesses(flags.harnesses);

  const harnesses =
    named.length > 0
      ? named
      : HARNESSES.filter(
          (h) =>
            status(plan(h, env, flags.scope)).installed ||
            status(plan(h, env, flags.scope)).partial,
        );

  if (harnesses.length === 0) {
    ui.info("No ACLP plugins are installed.");
    return;
  }

  if (
    ui.interactive &&
    !flags.yes &&
    !(await ui.confirm(
      `Remove ACLP from ${harnesses.map((h) => ADAPTERS[h].name).join(", ")}?`,
    ))
  ) {
    ui.warn("Nothing changed.");
    return;
  }

  for (const harness of harnesses) {
    uninstall(plan(harness, env, flags.scope));
    ui.success(`${ADAPTERS[harness].name}: removed`);
  }

  const inUse = HARNESSES.some((h) => {
    const s = status(plan(h, env, "user"));

    return s.installed || s.partial;
  });

  if (!inUse) {
    removeRuntime(env);
  }
}

export interface StatusRow {
  harness: HarnessId;
  support: Support;
  installed: boolean;
  partial: boolean;
  servers: {
    name: string;
    events: string[];
    ok?: boolean;
    at?: string;
    error?: string;
  }[];
}

export function statusRows(env: Env, scope: Scope): StatusRow[] {
  const health = readHealth(env);

  return HARNESSES.map((harness) => {
    const s = status(plan(harness, env, scope));

    return {
      harness,
      support: ADAPTERS[harness].support,
      installed: s.installed,
      partial: s.partial,
      servers: serversFor(env, harness).map((server) => ({
        name: server.name,
        events: server.events,
        ...(health[server.name] ?? {}),
      })),
    };
  });
}

export function statusCommand(
  env: Env,
  ui: Ui,
  scope: Scope,
  json: boolean,
  write: (text: string) => void,
): void {
  const rows = statusRows(env, scope);

  if (json) {
    write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }

  const lines = rows.map((row) => {
    const state = row.installed
      ? "installed"
      : row.partial
        ? "partially installed (reinstall)"
        : "not installed";

    const servers = row.installed
      ? row.servers.map((s) => {
          const health =
            s.ok === undefined
              ? "no deliveries yet"
              : s.ok
                ? `ok at ${s.at}`
                : `failing: ${s.error}`;

          return `\n    ${s.name}: ${s.events.length} events, ${health}`;
        })
      : [];

    return `${ADAPTERS[row.harness].name}: ${state}${servers.join("")}`;
  });

  ui.note(lines.join("\n"), "Harnesses");
  ui.note(
    SUPPORTS.map(
      (k) =>
        `${SUPPORT_LABELS[k]}: ${rows
          .filter((r) => r.support === k)
          .map((r) => ADAPTERS[r.harness].name)
          .join(", ")}`,
    ).join("\n"),
    "Support",
  );
  ui.info(
    runtimeReady(env)
      ? `Runtime at ${runtimeDir(env)} is current.`
      : `Runtime at ${runtimeDir(env)} is missing or outdated; run aclp install.`,
  );
}
