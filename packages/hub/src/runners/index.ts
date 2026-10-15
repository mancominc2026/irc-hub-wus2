import type { AgentKind } from "../config.js";
import { claudeRunner } from "./claude.js";
import { codexRunner } from "./codex.js";
import type { Runner } from "./types.js";

export function runnerFor(kind: AgentKind): Runner {
  switch (kind) {
    case "claude":
      return claudeRunner;
    case "codex":
      return codexRunner;
  }
}

export { claudeRunner, parseClaudeEvent } from "./claude.js";
export { codexRunner, parseCodexEvent } from "./codex.js";
export type { Runner, RunEvent, RunRequest, RunOutcome, RunUsage } from "./types.js";
