import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encode, decode, renderCodebook, estimateTokens, type EncodeStats, type RefInfo } from "@agentos/cipher";
import type { AgentProfile, HubConfig } from "./config.js";
import { runnerFor } from "./runners/index.js";
import type { RunEvent } from "./runners/types.js";
import { SessionStore, type Session, type StoredMessage } from "./sessions.js";
import { distill, distillAvailable, countTokens, DEFAULT_DISTILL_MODEL } from "./distill.js";
import { hasCodebook } from "./codebook-install.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const UI_FILE = path.resolve(here, "../../../apps/composer/index.html");

export interface SendBody {
  agentId: string;
  sessionId?: string;
  text: string;
  mode?: "cipher" | "clear";
  aggressive?: boolean;
}

export interface PreparedMessage {
  sent: string;
  mode: "cipher" | "clear";
  stats?: EncodeStats;
  refs?: RefInfo[];
  applied?: Record<string, number>;
  systemAppend?: string;
}

/** Decide exactly what reaches the agent for this message. Pure, so the CLI and the server share it. */
export function prepareMessage(profile: AgentProfile, session: Session | undefined, text: string, mode: "cipher" | "clear", aggressive = false): PreparedMessage {
  const codebook = profile.codebook ?? "file";
  if (mode === "clear" || codebook === "none") {
    const n = estimateTokens(text);
    return { sent: text, mode: "clear", stats: { charsBefore: text.length, charsAfter: text.length, tokensBefore: n, tokensAfter: n, savedTokens: 0, savedPct: 0 } };
  }
  const enc = encode(text, { aggressive, known: session?.refs ?? [] });
  return {
    sent: enc.text,
    mode: "cipher",
    stats: enc.stats,
    refs: enc.refs,
    applied: enc.applied,
    systemAppend: codebook === "system-prompt" ? renderCodebook() : undefined,
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function createServer(cfg: HubConfig, store: SessionStore): http.Server {
  const agents = new Map(cfg.agents.map((a) => [a.id, a]));
  const running = new Set<string>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/") return sendFile(res, UI_FILE, "text/html; charset=utf-8");
      if (url.pathname === "/api/agents" && req.method === "GET") {
        return json(res, {
          agents: cfg.agents.map(publicProfile),
          capabilities: { distill: distillAvailable(), distillModel: cfg.distillModel ?? DEFAULT_DISTILL_MODEL, countTokens: distillAvailable() },
          codebook: renderCodebook(),
        });
      }
      let m: RegExpMatchArray | null;
      if ((m = url.pathname.match(/^\/api\/agents\/([\w-]+)\/sessions$/)) && req.method === "GET") {
        return json(res, { sessions: store.list(agent(m[1]).id) });
      }
      if ((m = url.pathname.match(/^\/api\/agents\/([\w-]+)\/sessions\/([\w-]+)$/))) {
        const a = agent(m[1]);
        if (req.method === "GET") {
          const s = store.get(a.id, m[2]);
          if (!s) throw new HttpError(404, "session not found");
          return json(res, { session: s });
        }
        if (req.method === "DELETE") {
          if (running.has(m[2])) throw new HttpError(409, "session is running");
          return json(res, { deleted: store.delete(a.id, m[2]) });
        }
      }
      if (url.pathname === "/api/cipher" && req.method === "POST") {
        const body = (await readJson(req)) as Partial<SendBody>;
        const text = str(body.text, "text");
        const a = body.agentId ? agent(body.agentId) : undefined;
        const s = a && body.sessionId ? store.get(a.id, body.sessionId) : undefined;
        if (!a) {
          const enc = encode(text, { aggressive: !!body.aggressive, known: [] });
          return json(res, { sent: enc.text, mode: "cipher", stats: enc.stats, refs: enc.refs, applied: enc.applied });
        }
        const { systemAppend: _omit, ...prepared } = prepareMessage(a, s, text, body.mode ?? "cipher", !!body.aggressive);
        return json(res, prepared);
      }
      if (url.pathname === "/api/decode" && req.method === "POST") {
        const body = (await readJson(req)) as { text?: unknown };
        return json(res, { text: decode(str(body.text, "text")) });
      }
      if (url.pathname === "/api/distill" && req.method === "POST") {
        if (!distillAvailable()) throw new HttpError(501, "distill needs ANTHROPIC_API_KEY");
        const body = (await readJson(req)) as { text?: unknown };
        const text = str(body.text, "text");
        const out = await distill(text, cfg.distillModel ?? DEFAULT_DISTILL_MODEL);
        return json(res, { text: out, stats: { tokensBefore: estimateTokens(text), tokensAfter: estimateTokens(out) } });
      }
      if (url.pathname === "/api/count" && req.method === "POST") {
        if (!distillAvailable()) throw new HttpError(501, "token counting needs ANTHROPIC_API_KEY");
        const body = (await readJson(req)) as { text?: unknown; model?: unknown };
        const text = str(body.text, "text");
        return json(res, { tokens: await countTokens(text, typeof body.model === "string" ? body.model : undefined), estimate: estimateTokens(text) });
      }
      if (url.pathname === "/api/send" && req.method === "POST") {
        const body = (await readJson(req)) as Partial<SendBody>;
        const a = agent(str(body.agentId, "agentId"));
        const text = str(body.text, "text");
        const mode = body.mode === "clear" ? "clear" : "cipher";
        let session = body.sessionId ? store.get(a.id, body.sessionId) : undefined;
        if (body.sessionId && !session) throw new HttpError(404, "session not found");
        session ??= store.create(a.id, text.split("\n")[0]);
        if (running.has(session.id)) throw new HttpError(409, "session is already running a turn");
        running.add(session.id);
        try {
          await streamTurn(req, res, a, session, text, mode, !!body.aggressive);
        } finally {
          running.delete(session.id);
        }
        return;
      }
      throw new HttpError(404, "not found");
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (res.headersSent) {
        sse(res, "error", { message: (err as Error).message });
        res.end();
      } else {
        json(res, { error: (err as Error).message }, status);
      }
    }
  });

  function agent(id: string): AgentProfile {
    const a = agents.get(id);
    if (!a) throw new HttpError(404, `unknown agent "${id}"`);
    return a;
  }

  async function streamTurn(req: http.IncomingMessage, res: http.ServerResponse, a: AgentProfile, session: Session, text: string, mode: "cipher" | "clear", aggressive: boolean) {
    const prepared = prepareMessage(a, session, text, mode, aggressive);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    sse(res, "session", { sessionId: session.id, sent: prepared.sent, mode: prepared.mode, stats: prepared.stats, refs: prepared.refs, applied: prepared.applied });
    if (prepared.mode === "cipher" && a.codebook === "file" && !hasCodebook(a)) {
      sse(res, "warning", { message: `No codebook block in ${a.kind === "claude" ? "CLAUDE.md" : "AGENTS.md"} for ${a.id}; run \`agentos setup ${a.id}\` so the agent reads block references reliably.` });
    }
    const ac = new AbortController();
    req.on("close", () => ac.abort());
    const runner = runnerFor(a.kind);
    const started = Date.now();
    let outcome;
    try {
      outcome = await runner.run(
        { profile: a, message: prepared.sent, sessionId: session.runnerSessionId, systemAppend: prepared.systemAppend, signal: ac.signal },
        (e: RunEvent) => sse(res, e.type, e),
      );
    } catch (err) {
      sse(res, "error", { message: `failed to start ${a.kind}: ${(err as Error).message}` });
      res.end();
      return;
    }
    const at = new Date().toISOString();
    const user: StoredMessage = { role: "user", at, text, sent: prepared.sent === text ? undefined : prepared.sent, mode: prepared.mode, stats: prepared.stats, refs: prepared.refs };
    const agentMsg: StoredMessage = {
      role: "agent",
      at: new Date().toISOString(),
      text: outcome.text || (outcome.isError ? `(${a.kind} exited with code ${outcome.exitCode})` : ""),
      usage: outcome.usage,
      costUsd: outcome.costUsd,
      durationMs: outcome.durationMs ?? Date.now() - started,
      isError: outcome.isError,
    };
    if (outcome.sessionId) session.runnerSessionId = outcome.sessionId;
    store.append(session, user, agentMsg);
    sse(res, "done", { sessionId: session.id, runnerSessionId: session.runnerSessionId, message: agentMsg, totals: session.totals, exitCode: outcome.exitCode });
    res.end();
  }

  return server;
}

function publicProfile(a: AgentProfile) {
  const { env: _env, ...rest } = a;
  return { ...rest, hasCodebook: a.codebook === "file" ? hasCodebook(a) : undefined };
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${name} is required`);
  return v;
}

function json(res: http.ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sse(res: http.ServerResponse, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendFile(res: http.ServerResponse, file: string, type: string): void {
  if (!fs.existsSync(file)) return json(res, { error: `missing ${file}` }, 500);
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(file).pipe(res);
}

function readJson(req: http.IncomingMessage, limit = 8 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, "body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new HttpError(400, "invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
