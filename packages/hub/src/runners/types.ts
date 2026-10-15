import type { AgentProfile } from "../config.js";

export interface RunUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type RunEvent =
  | { type: "init"; sessionId: string; model?: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input?: unknown }
  | { type: "status"; message: string }
  | { type: "result"; sessionId?: string; text?: string; usage?: RunUsage; costUsd?: number; durationMs?: number; turns?: number; isError?: boolean }
  | { type: "error"; message: string }
  | { type: "stderr"; text: string };

export interface RunRequest {
  profile: AgentProfile;
  /** The message exactly as it should reach the agent (already ciphered or clear). */
  message: string;
  /** The runner's own session id to resume, if any. */
  sessionId?: string;
  /** Extra system text for the run (used for codebook: "system-prompt"). */
  systemAppend?: string;
  signal?: AbortSignal;
}

export interface RunOutcome {
  sessionId?: string;
  text: string;
  usage?: RunUsage;
  costUsd?: number;
  durationMs?: number;
  exitCode: number | null;
  isError: boolean;
}

export interface Runner {
  kind: AgentProfile["kind"];
  /** Build the argv for inspection / dry runs. */
  argv(req: RunRequest): { command: string; args: string[] };
  run(req: RunRequest, onEvent: (e: RunEvent) => void): Promise<RunOutcome>;
}
