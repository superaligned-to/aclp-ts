import { MANAGED } from "../install.ts";

export type Factory =
  | "opencodePlugin"
  | "piExtension"
  | "ampPlugin"
  | "clinePlugin"
  | "openclawPlugin";

export function pluginModule(
  runtime: string,
  factory: Factory,
  harness: string,
): string {
  const arg = factory === "piExtension" ? JSON.stringify(harness) : "";

  return `// ${MANAGED}; reinstall with \`npx aclp install ${harness}\`.\nimport { ${factory} } from ${JSON.stringify(runtime)};\n\nexport default ${factory}(${arg});\n`;
}

export function method(
  target: unknown,
  name: string,
): ((...args: unknown[]) => unknown) | undefined {
  if (typeof target !== "object" || target === null || !(name in target)) {
    return undefined;
  }

  const value: unknown = Reflect.get(target, name);

  return typeof value === "function"
    ? (...args: unknown[]) => Reflect.apply(value, target, args)
    : undefined;
}

export function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
