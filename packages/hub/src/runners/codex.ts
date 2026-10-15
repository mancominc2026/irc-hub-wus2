import type { RunEvent, RunOutcome, RunRequest, Runner, RunUsage } from "./types.js";
import { spawnJsonl } from "./spawn.js";

/**
 * OpenAI Codex CLI headless runner.
 *   codex exec --json [-m model] [--sandbox s] [-C cwd] -        (new thread, prompt on stdin)
 *   codex exec resume <thread-id> --json -                        (continue a thread)
 * stdout is JSON-lines:
 *   {type:"thread.started",thread_id}
 *   {type:"item.completed",item:{type:"agent_message",text}}
 *   {type:"item.completed",item:{type:"command_execution",command,...}}
 *   {type:"turn.completed",usage:{input_tokens,cached_input_tokens,output_tokens}}
 *   {type:"error",message}
 * Codex does not read AGENTS.md for a system prompt flag, so codebook "system-prompt" is prepended to the message.
 * This runner's event shapes follow the Codex CLI JSON output as of mid-2026; if your Codex build differs, adjust
 * here or set `extraArgs` on the profile.
 */
export const codexRunner: Runner = {
  kind: "codex",
  argv(req) {
    const p = req.profile;
    const args = ["exec"];
    if (req.sessionId) args.push("resume", req.sessionId);
    args.push("--json");
    if (p.model && !req.sessionId) args.push("-m", p.model);
    if (p.sandbox && !req.sessionId) args.push("--sandbox", p.sandbox);
    if (!req.sessionId) args.push("-C", p.cwd);
    if (p.extraArgs) args.push(...p.extraArgs);
    args.push("-");
    return { command: p.command ?? "codex", args };
  },
  async run(req, onEvent) {
    const { command, args } = this.argv(req);
    const out: RunOutcome = { text: "", exitCode: null, isError: false, sessionId: req.sessionId };
    const chunks: string[] = [];
    const message = req.systemAppend ? `${req.systemAppend}\n\n${req.message}` : req.message;
    const code = await spawnJsonl({
      command,
      args,
      cwd: req.profile.cwd,
      env: req.profile.env,
      stdin: message,
      signal: req.signal,
      onEvent,
      onLine: (obj) => {
        for (const e of parseCodexEvent(obj)) {
          if (e.type === "init") out.sessionId = e.sessionId;
          if (e.type === "text") chunks.push(e.text);
          if (e.type === "result") {
            out.usage = e.usage;
            out.isError = !!e.isError;
          }
          if (e.type === "error") out.isError = true;
          onEvent(e);
        }
      },
    });
    out.exitCode = code;
    out.text = chunks.join("\n").trim();
    if (code !== 0 && code !== null) out.isError = true;
    return out;
  },
};

type Json = Record<string, unknown>;

export function parseCodexEvent(obj: unknown): RunEvent[] {
  if (!obj || typeof obj !== "object") return [];
  const o = obj as Json;
  const events: RunEvent[] = [];
  switch (o.type) {
    case "thread.started":
      if (typeof o.thread_id === "string") events.push({ type: "init", sessionId: o.thread_id });
      break;
    case "item.completed": {
      const item = o.item as Json | undefined;
      if (!item) break;
      if (item.type === "agent_message" && typeof item.text === "string") events.push({ type: "text", text: item.text });
      else if (item.type === "command_execution") events.push({ type: "tool", name: "command", input: item.command });
      else if (item.type === "file_change") events.push({ type: "tool", name: "file_change", input: item.changes });
      else if (item.type === "mcp_tool_call") events.push({ type: "tool", name: String(item.tool ?? "mcp"), input: item.arguments });
      break;
    }
    case "turn.completed": {
      const u = o.usage as Json | undefined;
      const usage: RunUsage | undefined = u
        ? {
            inputTokens: typeof u.input_tokens === "number" ? u.input_tokens : undefined,
            outputTokens: typeof u.output_tokens === "number" ? u.output_tokens : undefined,
            cacheReadTokens: typeof u.cached_input_tokens === "number" ? u.cached_input_tokens : undefined,
          }
        : undefined;
      events.push({ type: "result", usage });
      break;
    }
    case "turn.failed":
    case "error":
      events.push({ type: "error", message: String((o.error as Json | undefined)?.message ?? o.message ?? "codex error") });
      break;
    default:
      break;
  }
  return events;
}
