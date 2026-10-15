import fs from "node:fs";
import path from "node:path";
import { renderCodebook, DEFAULT_CODEBOOK, type Codebook } from "@agentos/cipher";
import type { AgentProfile } from "./config.js";

const BLOCK_RE = /<!-- agentos:codebook v[^\s]+ start -->[\s\S]*?<!-- agentos:codebook v[^\s]+ end -->/;

export function instructionsFile(profile: AgentProfile): string {
  return path.join(profile.cwd, profile.kind === "claude" ? "CLAUDE.md" : "AGENTS.md");
}

export interface InstallResult {
  file: string;
  action: "created" | "updated" | "unchanged";
}

/** Write (or refresh) the codebook block in the agent's instructions file, leaving everything else untouched. */
export function installCodebook(profile: AgentProfile, codebook: Codebook = DEFAULT_CODEBOOK): InstallResult {
  const file = instructionsFile(profile);
  const block = renderCodebook(codebook);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${block}\n`);
    return { file, action: "created" };
  }
  const current = fs.readFileSync(file, "utf8");
  if (BLOCK_RE.test(current)) {
    const next = current.replace(BLOCK_RE, block);
    if (next === current) return { file, action: "unchanged" };
    fs.writeFileSync(file, next);
    return { file, action: "updated" };
  }
  const sep = current.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(file, `${current}${sep}${block}\n`);
  return { file, action: "updated" };
}

export function hasCodebook(profile: AgentProfile): boolean {
  const file = instructionsFile(profile);
  return fs.existsSync(file) && BLOCK_RE.test(fs.readFileSync(file, "utf8"));
}
