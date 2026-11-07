import type { EventMap, EventMethod } from "../index.ts";
import type { Env } from "./env.ts";

export const HARNESSES = [
  "claude-code",
  "codex",
  "opencode",
  "pi",
  "omp",
  "openclaw",
  "hermes",
  "cursor",
  "gemini-cli",
  "copilot-cli",
  "kiro-cli",
  "amp",
  "cline-cli",
  "devin-cli",
  "qwen-code",
  "droid",
  "auggie",
  "goose",
  "windsurf",
  "crush",
  "claude-desktop",
  "chatgpt-desktop",
  "zed",
] as const;

export type HarnessId = (typeof HARNESSES)[number];

export type Scope = "user" | "project";

export const SUPPORTS = ["lifecycle", "observe", "mcp"] as const;

export type Support = (typeof SUPPORTS)[number];

export const SUPPORT_LABELS: Readonly<Record<Support, string>> = {
  lifecycle: "lifecycle hooks, context injected before the model runs",
  observe: "lifecycle hooks, observe only (no context injection)",
  mcp: "MCP tool, model-initiated (no lifecycle hooks)",
};

export const SUPPORTED_EVENTS = [
  "session.started",
  "session.ended",
  "input.submitted",
  "tool.requested",
  "tool.finished",
  "model.finished",
  "agent.started",
  "agent.finished",
  "run.finished",
] as const;

export interface HooksEdit {
  kind: "hooks";
  path: string;
  root: "hooks" | null;
  entries: Record<string, unknown[]>;
  extra?: Record<string, unknown>;
}

export interface FileEdit {
  kind: "file";
  path: string;
  content: string;
}

export interface BlockEdit {
  kind: "block";
  path: string;
  comment: string;
  content: string;
}

export interface JsonEdit {
  kind: "json";
  path: string;
  key: [string, string];
  value: Record<string, unknown>;
}

export type Edit = HooksEdit | FileEdit | BlockEdit | JsonEdit;

export interface Plan {
  harness: HarnessId;
  scope: Scope;
  edits: Edit[];
  notes: string[];
}

export interface Runtime {
  node: string;
  hook: string;
  cli: string;
  module: string;
}

export interface PlanOptions {
  scope: Scope;
  runtime: Runtime;
}

export type Message = {
  [M in EventMethod]: { method: M; params: EventMap[M]; guarded?: boolean };
}[EventMethod];

export interface Outcome {
  context: string[];
  blocked?: string;
}

export interface Rendered {
  stdout?: string;
  stderr?: string;
  exitCode: number;
}

export interface Adapter {
  id: HarnessId;
  name: string;
  support: Support;
  events: readonly string[];
  detect(env: Env): boolean;
  plan(env: Env, opts: PlanOptions): Plan;
  map(event: string, payload: unknown, env?: Env): Promise<Message[]>;
  render(event: string, outcome: Outcome, payload?: unknown): Rendered;
}

export function isHarness(value: string): value is HarnessId {
  return (HARNESSES as readonly string[]).includes(value);
}
