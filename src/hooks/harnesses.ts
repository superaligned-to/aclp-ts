import type { Adapter, HarnessId } from "./adapter.ts";
import { amp } from "./adapters/amp.ts";
import { auggie } from "./adapters/auggie.ts";
import { chatgptDesktop } from "./adapters/chatgpt-desktop.ts";
import { claudeCode } from "./adapters/claude-code.ts";
import { claudeDesktop } from "./adapters/claude-desktop.ts";
import { clineCli } from "./adapters/cline-cli.ts";
import { codex } from "./adapters/codex.ts";
import { copilotCli } from "./adapters/copilot-cli.ts";
import { crush } from "./adapters/crush.ts";
import { cursor } from "./adapters/cursor.ts";
import { devinCli } from "./adapters/devin-cli.ts";
import { droid } from "./adapters/droid.ts";
import { geminiCli } from "./adapters/gemini-cli.ts";
import { goose } from "./adapters/goose.ts";
import { hermes } from "./adapters/hermes.ts";
import { kiroCli } from "./adapters/kiro-cli.ts";
import { omp } from "./adapters/omp.ts";
import { openclaw } from "./adapters/openclaw.ts";
import { opencode } from "./adapters/opencode.ts";
import { pi } from "./adapters/pi.ts";
import { qwenCode } from "./adapters/qwen-code.ts";
import { windsurf } from "./adapters/windsurf.ts";
import { zed } from "./adapters/zed.ts";

export const ADAPTERS: Readonly<Record<HarnessId, Adapter>> = {
  "claude-code": claudeCode,
  codex,
  opencode,
  pi,
  omp,
  openclaw,
  hermes,
  cursor,
  "gemini-cli": geminiCli,
  "copilot-cli": copilotCli,
  "kiro-cli": kiroCli,
  amp,
  "cline-cli": clineCli,
  "devin-cli": devinCli,
  "qwen-code": qwenCode,
  droid,
  auggie,
  goose,
  windsurf,
  crush,
  "claude-desktop": claudeDesktop,
  "chatgpt-desktop": chatgptDesktop,
  zed,
};

export function adapterFor(harness: HarnessId): Adapter {
  return ADAPTERS[harness];
}
