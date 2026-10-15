import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EncodeStats, RefInfo } from "@agentos/cipher";
import type { RunUsage } from "./runners/types.js";

export interface StoredMessage {
  role: "user" | "agent";
  at: string;
  /** What the user typed (user) or what the agent replied (agent). */
  text: string;
  /** What was actually sent to the agent, when it differs from `text`. */
  sent?: string;
  mode?: "cipher" | "clear";
  stats?: EncodeStats;
  refs?: RefInfo[];
  usage?: RunUsage;
  costUsd?: number;
  durationMs?: number;
  isError?: boolean;
}

export interface Session {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** The runner's own id (claude session_id / codex thread_id) used to resume. */
  runnerSessionId?: string;
  /** Block ids the agent has already seen. */
  refs: string[];
  messages: StoredMessage[];
  totals: { savedTokens: number; sentTokens: number; inputTokens: number; outputTokens: number; costUsd: number };
}

export class SessionStore {
  constructor(private readonly dataDir: string) {}

  private dir(agentId: string): string {
    return path.join(this.dataDir, "sessions", agentId);
  }

  private file(agentId: string, id: string): string {
    return path.join(this.dir(agentId), `${id}.json`);
  }

  list(agentId: string): Pick<Session, "id" | "agentId" | "title" | "createdAt" | "updatedAt" | "totals">[] {
    const d = this.dir(agentId);
    if (!fs.existsSync(d)) return [];
    return fs
      .readdirSync(d)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) as Session)
      .map(({ id, agentId, title, createdAt, updatedAt, totals }) => ({ id, agentId, title, createdAt, updatedAt, totals }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  get(agentId: string, id: string): Session | undefined {
    const f = this.file(agentId, id);
    if (!/^[a-f0-9-]{8,}$/i.test(id) || !fs.existsSync(f)) return undefined;
    return JSON.parse(fs.readFileSync(f, "utf8")) as Session;
  }

  create(agentId: string, title: string): Session {
    const now = new Date().toISOString();
    const s: Session = {
      id: randomUUID(),
      agentId,
      title: title.slice(0, 80) || "Untitled",
      createdAt: now,
      updatedAt: now,
      refs: [],
      messages: [],
      totals: { savedTokens: 0, sentTokens: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };
    this.save(s);
    return s;
  }

  save(s: Session): void {
    fs.mkdirSync(this.dir(s.agentId), { recursive: true });
    s.updatedAt = new Date().toISOString();
    const f = this.file(s.agentId, s.id);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(s, null, 2));
    fs.renameSync(`${f}.tmp`, f);
  }

  delete(agentId: string, id: string): boolean {
    const f = this.file(agentId, id);
    if (!this.get(agentId, id)) return false;
    fs.rmSync(f);
    return true;
  }

  /** Record a completed exchange and roll the totals forward. */
  append(s: Session, user: StoredMessage, agent: StoredMessage): void {
    s.messages.push(user, agent);
    if (user.stats) {
      s.totals.savedTokens += user.stats.savedTokens;
      s.totals.sentTokens += user.stats.tokensAfter;
    }
    if (user.refs) for (const r of user.refs) if (!s.refs.includes(r.id)) s.refs.push(r.id);
    if (agent.usage) {
      s.totals.inputTokens += (agent.usage.inputTokens ?? 0) + (agent.usage.cacheReadTokens ?? 0) + (agent.usage.cacheWriteTokens ?? 0);
      s.totals.outputTokens += agent.usage.outputTokens ?? 0;
    }
    if (agent.costUsd) s.totals.costUsd += agent.costUsd;
    this.save(s);
  }
}
