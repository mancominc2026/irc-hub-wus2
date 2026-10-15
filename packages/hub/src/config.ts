import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type AgentKind = "claude" | "codex";

export interface AgentProfile {
  /** Short id used in URLs and on disk. */
  id: string;
  name: string;
  kind: AgentKind;
  description?: string;
  /** Working directory the agent runs in. `~` is expanded. */
  cwd: string;
  /** Model passed to the CLI (claude: --model, codex: -m). */
  model?: string;
  /** claude: --permission-mode (default, acceptEdits, plan, bypassPermissions ...). */
  permissionMode?: string;
  /** codex: --sandbox (read-only, workspace-write, danger-full-access). */
  sandbox?: string;
  /**
   * How the agent learns the cipher.
   *   file          -> `agentos setup` installs the codebook block in CLAUDE.md / AGENTS.md (cheapest: cached once)
   *   system-prompt -> appended on every run (claude: --append-system-prompt)
   *   none          -> the composer sends clear text to this agent (no token savings)
   */
  codebook?: "file" | "system-prompt" | "none";
  /** Override the executable (defaults to `claude` / `codex`). Useful for wrappers and tests. */
  command?: string;
  /** Extra CLI args appended after the generated ones. */
  extraArgs?: string[];
  env?: Record<string, string>;
}

export interface HubConfig {
  port?: number;
  host?: string;
  /** Where sessions are stored. Default ~/.agentos */
  dataDir?: string;
  /** Model for the optional LLM distill step (needs ANTHROPIC_API_KEY). */
  distillModel?: string;
  agents: AgentProfile[];
}

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function findConfigPath(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.AGENTOS_CONFIG,
    path.resolve("agents.json"),
    path.join(os.homedir(), ".agentos", "agents.json"),
  ].filter((c): c is string => !!c);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(
    `No agents.json found. Looked at: ${candidates.join(", ")}. Copy agents.example.json to agents.json and edit it.`,
  );
}

export function loadConfig(explicit?: string): HubConfig & { path: string } {
  const p = findConfigPath(explicit);
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as HubConfig;
  if (!Array.isArray(raw.agents) || raw.agents.length === 0) throw new Error(`${p}: "agents" must be a non-empty array`);
  const ids = new Set<string>();
  for (const a of raw.agents) {
    if (!a.id || !/^[a-z0-9][a-z0-9-_]*$/i.test(a.id)) throw new Error(`${p}: agent id "${a.id}" must be alphanumeric`);
    if (ids.has(a.id)) throw new Error(`${p}: duplicate agent id "${a.id}"`);
    ids.add(a.id);
    if (a.kind !== "claude" && a.kind !== "codex") throw new Error(`${p}: agent "${a.id}" kind must be claude or codex`);
    if (!a.cwd) throw new Error(`${p}: agent "${a.id}" needs a cwd`);
    a.cwd = path.resolve(path.dirname(p), expandHome(a.cwd));
    a.name ??= a.id;
    a.codebook ??= "file";
  }
  return {
    ...raw,
    path: p,
    dataDir: path.resolve(expandHome(raw.dataDir ?? process.env.AGENTOS_HOME ?? "~/.agentos")),
    port: raw.port ?? Number(process.env.PORT ?? 7777),
    host: raw.host ?? "127.0.0.1",
  };
}
