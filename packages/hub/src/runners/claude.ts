import type { RunEvent, RunOutcome, RunRequest, Runner, RunUsage } from "./types.js";
import { spawnJsonl } from "./spawn.js";

/**
 * Claude Code headless runner.
 *   claude -p --output-format stream-json --verbose [--resume id] [--model m] [--permission-mode pm]
 * The prompt is written to stdin. Each stdout line is one JSON event:
 *   {type:"system",subtype:"init",session_id,model}
 *   {type:"assistant",message:{content:[{type:"text",text}|{type:"tool_use",name,input}]}}
 *   {type:"user",...}                       tool results, ignored
 *   {type:"result",subtype,result,session_id,usage,total_cost_usd,duration_ms,num_turns,is_error}
 */
export const claudeRunner: Runner = {
  kind: "claude",
  argv(req) {
    const p = req.profile;
    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (req.sessionId) args.push("--resume", req.sessionId);
    if (p.model) args.push("--model", p.model);
    if (p.permissionMode) args.push("--permission-mode", p.permissionMode);
    if (req.systemAppend) args.push("--append-system-prompt", req.systemAppend);
    if (p.extraArgs) args.push(...p.extraArgs);
    return { command: p.command ?? "claude", args };
  },
  async run(req, onEvent) {
    const { command, args } = this.argv(req);
    const out: RunOutcome = { text: "", exitCode: null, isError: false, sessionId: req.sessionId };
    const chunks: string[] = [];
    const code = await spawnJsonl({
      command,
      args,
      cwd: req.profile.cwd,
      env: req.profile.env,
      stdin: req.message,
      signal: req.signal,
      onEvent,
      onLine: (obj) => {
        for (const e of parseClaudeEvent(obj)) {
          if (e.type === "init") out.sessionId = e.sessionId;
          if (e.type === "text") chunks.push(e.text);
          if (e.type === "result") {
            out.sessionId = e.sessionId ?? out.sessionId;
            out.usage = e.usage;
            out.costUsd = e.costUsd;
            out.durationMs = e.durationMs;
            out.isError = !!e.isError;
            if (e.text && chunks.length === 0) chunks.push(e.text);
          }
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

export function parseClaudeEvent(obj: unknown): RunEvent[] {
  if (!obj || typeof obj !== "object") return [];
  const o = obj as Json;
  const events: RunEvent[] = [];
  switch (o.type) {
    case "system": {
      if (o.subtype === "init" && typeof o.session_id === "string") {
        events.push({ type: "init", sessionId: o.session_id, model: typeof o.model === "string" ? o.model : undefined });
      }
      break;
    }
    case "assistant": {
      const msg = o.message as Json | undefined;
      const content = (msg?.content ?? []) as Json[];
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) events.push({ type: "text", text: block.text });
        else if (block.type === "tool_use" && typeof block.name === "string") events.push({ type: "tool", name: block.name, input: block.input });
      }
      break;
    }
    case "result": {
      const u = o.usage as Json | undefined;
      const usage: RunUsage | undefined = u
        ? {
            inputTokens: num(u.input_tokens),
            outputTokens: num(u.output_tokens),
            cacheReadTokens: num(u.cache_read_input_tokens),
            cacheWriteTokens: num(u.cache_creation_input_tokens),
          }
        : undefined;
      events.push({
        type: "result",
        sessionId: typeof o.session_id === "string" ? o.session_id : undefined,
        text: typeof o.result === "string" ? o.result : undefined,
        usage,
        costUsd: num(o.total_cost_usd),
        durationMs: num(o.duration_ms),
        turns: num(o.num_turns),
        isError: o.is_error === true || (typeof o.subtype === "string" && o.subtype.startsWith("error")),
      });
      break;
    }
    default:
      break;
  }
  return events;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
