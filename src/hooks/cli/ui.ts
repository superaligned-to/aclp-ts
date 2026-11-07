import { spawn } from "node:child_process";
import * as clack from "@clack/prompts";

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface Ui {
  interactive: boolean;
  intro(title: string): void;
  outro(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  note(message: string, title: string): void;
  confirm(message: string): Promise<boolean>;
  text(message: string, placeholder?: string): Promise<string>;
  secret(message: string): Promise<string>;
  select<T extends string>(message: string, choices: Choice<T>[]): Promise<T>;
  multiselect<T extends string>(
    message: string,
    choices: Choice<T>[],
    initial: T[],
  ): Promise<T[]>;
  open(url: string): void;
}

export class Cancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

function settled<T>(value: T | symbol): T {
  if (typeof value === "symbol") {
    throw new Cancelled();
  }

  return value;
}

function options(
  choices: Choice<string>[],
): { value: string; label: string; hint?: string }[] {
  return choices.map((c) =>
    c.hint === undefined
      ? { value: c.value, label: c.label }
      : { value: c.value, label: c.label, hint: c.hint },
  );
}

function pick<T extends string>(choices: Choice<T>[], value: string): T {
  const hit = choices.find((c) => c.value === value);

  if (hit === undefined) {
    throw new Cancelled();
  }

  return hit.value;
}

export function openUrl(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";

  spawn(cmd, [url], { stdio: "ignore", detached: true })
    .on("error", () => undefined)
    .unref();
}

export function terminalUi(interactive: boolean): Ui {
  return {
    interactive,
    intro: (title) => clack.intro(title),
    outro: (message) => clack.outro(message),
    info: (message) => clack.log.info(message),
    success: (message) => clack.log.success(message),
    warn: (message) => clack.log.warn(message),
    note: (message, title) => clack.note(message, title),
    confirm: async (message) =>
      settled<boolean>(await clack.confirm({ message })),
    text: async (message, placeholder) =>
      settled<string>(
        await clack.text({
          message,
          ...(placeholder === undefined ? {} : { placeholder }),
          validate: (v) =>
            v === undefined || v.trim() === "" ? "Required" : undefined,
        }),
      ),
    secret: async (message) =>
      settled<string>(await clack.password({ message })),
    select: async <T extends string>(message: string, choices: Choice<T>[]) =>
      pick(
        choices,
        settled<string>(
          await clack.select<string>({ message, options: options(choices) }),
        ),
      ),
    multiselect: async <T extends string>(
      message: string,
      choices: Choice<T>[],
      initial: T[],
    ) =>
      settled<string[]>(
        await clack.multiselect<string>({
          message,
          options: options(choices),
          initialValues: initial,
          required: false,
        }),
      ).map((v) => pick(choices, v)),
    open: openUrl,
  };
}
