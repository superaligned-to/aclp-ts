import { parseArgs } from "node:util";
import { HARNESSES, isHarness } from "../adapter.ts";
import type { Env } from "../env.ts";
import { serveMcp } from "../mcp.ts";
import { VERSION } from "../version.ts";
import {
  type HarnessFlags,
  installCommand,
  statusCommand,
  uninstallCommand,
} from "./harness-commands.ts";
import {
  addCommand,
  eventsCommand,
  listCommand,
  loginCommand,
  logoutCommand,
  removeCommand,
  type ServerFlags,
} from "./server-commands.ts";
import { Cancelled, type Ui } from "./ui.ts";

export const USAGE = `aclp ${VERSION}

Usage:
  aclp install [harness...] [--project] [--dry-run] [--yes]
  aclp uninstall [harness...] [--project] [--yes]
  aclp status [--project] [--json]
  aclp server add [name] --url <url> [--harness <h,...> | --all] [--events <a,b>] [--token <t>] [--oauth browser|device] [--on-error allow|deny]
  aclp server list [--json]
  aclp server events <name> [--events <a,b>] [--on-error allow|deny]
  aclp server login <name> [--token <t>] [--oauth browser|device]
  aclp server logout <name>
  aclp server remove <name> [--yes]
  aclp mcp <harness>          (stdio MCP server; installed for Claude Desktop, ChatGPT Desktop, Zed)

Harnesses: ${HARNESSES.join(", ")}
`;

const OPTIONS = {
  project: { type: "boolean" },
  "dry-run": { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  json: { type: "boolean" },
  url: { type: "string" },
  harness: { type: "string", multiple: true },
  all: { type: "boolean" },
  events: { type: "string" },
  token: { type: "string" },
  oauth: { type: "string" },
  "on-error": { type: "string" },
  version: { type: "boolean", short: "v" },
  help: { type: "boolean", short: "h" },
} as const;

export interface Io {
  env: Env;
  ui: Ui;
  write: (text: string) => void;
  stdin?: NodeJS.ReadableStream;
}

export async function main(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });

  const [command, ...rest] = positionals;

  if (values.version === true) {
    io.write(`${VERSION}\n`);
    return 0;
  }

  if (command === undefined || values.help === true || command === "help") {
    io.write(USAGE);
    return command === undefined && values.help !== true ? 1 : 0;
  }

  const { env, ui } = io;

  if (command === "mcp") {
    const [harness] = rest;

    if (
      harness === undefined ||
      !isHarness(harness) ||
      io.stdin === undefined
    ) {
      io.write(USAGE);
      return 1;
    }

    await serveMcp(harness, io.stdin, io.write, env);
    return 0;
  }

  const harness: HarnessFlags = {
    harnesses: [...rest, ...(values.harness ?? [])],
    scope: values.project === true ? "project" : "user",
    yes: values.yes === true,
    dryRun: values["dry-run"] === true,
  };

  const [sub, name] = rest;

  const token = values.token ?? env.vars.ACLP_TOKEN;

  const server: ServerFlags = {
    ...(name === undefined ? {} : { name }),
    ...(values.url === undefined ? {} : { url: values.url }),
    harnesses: values.harness ?? [],
    all: values.all === true,
    ...(values.events === undefined ? {} : { events: values.events }),
    ...(token === undefined ? {} : { token }),
    ...(values.oauth === undefined ? {} : { oauth: values.oauth }),
    ...(values["on-error"] === undefined
      ? {}
      : { onError: values["on-error"] }),
    yes: values.yes === true,
  };

  const needName = (): string => {
    if (name === undefined) {
      throw new Error(`aclp server ${sub ?? ""} needs a server name`);
    }

    return name;
  };

  try {
    ui.intro("aclp");

    switch (command) {
      case "install":
        await installCommand(env, ui, harness);
        break;
      case "uninstall":
        await uninstallCommand(env, ui, harness);
        break;
      case "status":
        statusCommand(env, ui, harness.scope, values.json === true, io.write);
        break;
      case "server":
        switch (sub) {
          case "add":
            await addCommand(env, ui, server);
            break;
          case "list":
            listCommand(env, ui, values.json === true, io.write);
            break;
          case "events":
            await eventsCommand(env, ui, needName(), server);
            break;
          case "login":
            await loginCommand(env, ui, needName(), server);
            break;
          case "logout":
            logoutCommand(env, ui, needName());
            break;
          case "remove":
            await removeCommand(env, ui, needName(), server.yes);
            break;
          default:
            io.write(USAGE);
            return 1;
        }
        break;
      default:
        io.write(USAGE);
        return 1;
    }

    ui.outro("Done");
    return 0;
  } catch (error) {
    if (error instanceof Cancelled) {
      ui.outro("Cancelled");
      return 130;
    }

    ui.warn(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
