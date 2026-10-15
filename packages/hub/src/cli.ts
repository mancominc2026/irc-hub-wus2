#!/usr/bin/env node
import fs from "node:fs";
import { encode, decode, renderCodebook } from "@agentos/cipher";
import { loadConfig } from "./config.js";
import { createServer, prepareMessage } from "./server.js";
import { SessionStore } from "./sessions.js";
import { installCodebook, hasCodebook, instructionsFile } from "./codebook-install.js";
import { runnerFor } from "./runners/index.js";

const USAGE = `agentos - composer hub for pre-configured Claude Code / Codex agents

usage:
  agentos serve   [--config agents.json] [--port 7777] [--host 127.0.0.1]
  agentos setup   [agentId ...] [--config agents.json]       install the codebook block in each agent's CLAUDE.md / AGENTS.md
  agentos agents  [--config agents.json]                     list agents and whether their codebook is installed
  agentos cipher  [--aggressive] [--no-refs] [text]          cipher text (or stdin) and print it; stats go to stderr
  agentos decode  [text]                                     expand reversible codes
  agentos codebook                                           print the codebook block
  agentos send    <agentId> [--clear] [--aggressive] [--session id] [--dry-run] [text]
                                                             one-shot turn from the terminal (reads stdin when no text)
`;

interface Args {
  cmd: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parse(argv: string[]): Args {
  const [cmd = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (key.startsWith("no-")) flags[key.slice(3)] = false;
      else if (next !== undefined && !next.startsWith("--") && ["config", "port", "host", "session"].includes(key)) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { cmd, positional, flags };
}

async function readInput(positional: string[]): Promise<string> {
  if (positional.length) return positional.join(" ");
  if (process.stdin.isTTY) throw new Error("no text given and stdin is a terminal");
  return fs.readFileSync(0, "utf8");
}

async function main(): Promise<void> {
  const { cmd, positional, flags } = parse(process.argv.slice(2));
  const configPath = typeof flags.config === "string" ? flags.config : undefined;

  switch (cmd) {
    case "serve": {
      const cfg = loadConfig(configPath);
      const port = typeof flags.port === "string" ? Number(flags.port) : cfg.port!;
      const host = typeof flags.host === "string" ? flags.host : cfg.host!;
      const store = new SessionStore(cfg.dataDir!);
      const server = createServer(cfg, store);
      server.listen(port, host, () => {
        console.log(`agentos composer: http://${host}:${port}  (config: ${cfg.path}, data: ${cfg.dataDir})`);
        for (const a of cfg.agents) {
          const cb = a.codebook === "file" ? (hasCodebook(a) ? "codebook installed" : "codebook MISSING - run: agentos setup " + a.id) : `codebook: ${a.codebook}`;
          console.log(`  - ${a.id} (${a.kind}) ${a.cwd}  ${cb}`);
        }
      });
      return;
    }
    case "setup": {
      const cfg = loadConfig(configPath);
      const targets = positional.length ? cfg.agents.filter((a) => positional.includes(a.id)) : cfg.agents;
      if (!targets.length) throw new Error(`no matching agents in ${cfg.path}`);
      for (const a of targets) {
        if (a.codebook !== "file") {
          console.log(`${a.id}: codebook mode is "${a.codebook}", nothing to install`);
          continue;
        }
        const r = installCodebook(a);
        console.log(`${a.id}: ${r.action} ${r.file}`);
      }
      return;
    }
    case "agents": {
      const cfg = loadConfig(configPath);
      for (const a of cfg.agents) {
        const state = a.codebook === "file" ? (hasCodebook(a) ? "installed" : `missing (${instructionsFile(a)})`) : a.codebook;
        console.log(`${a.id}\t${a.kind}\t${a.model ?? "(default model)"}\t${a.cwd}\tcodebook: ${state}`);
      }
      return;
    }
    case "cipher": {
      const text = await readInput(positional);
      const r = encode(text, { aggressive: flags.aggressive === true, refs: flags.refs !== false });
      process.stdout.write(r.text + "\n");
      console.error(`~${r.stats.tokensBefore} -> ~${r.stats.tokensAfter} tokens (${r.stats.savedPct}% saved), ${r.stats.charsBefore} -> ${r.stats.charsAfter} chars`);
      return;
    }
    case "decode": {
      process.stdout.write(decode(await readInput(positional)) + "\n");
      return;
    }
    case "codebook": {
      process.stdout.write(renderCodebook() + "\n");
      return;
    }
    case "send": {
      const [agentId, ...rest] = positional;
      if (!agentId) throw new Error("send needs an agentId");
      const cfg = loadConfig(configPath);
      const profile = cfg.agents.find((a) => a.id === agentId);
      if (!profile) throw new Error(`unknown agent "${agentId}"`);
      const store = new SessionStore(cfg.dataDir!);
      const text = await readInput(rest);
      let session = typeof flags.session === "string" ? store.get(agentId, flags.session) : undefined;
      if (typeof flags.session === "string" && !session) throw new Error(`session ${flags.session} not found`);
      const prepared = prepareMessage(profile, session, text, flags.clear === true ? "clear" : "cipher", flags.aggressive === true);
      console.error(`[${prepared.mode}] ~${prepared.stats?.tokensBefore} -> ~${prepared.stats?.tokensAfter} tokens (${prepared.stats?.savedPct}% saved)`);
      if (flags["dry-run"] === true) {
        const { command, args } = runnerFor(profile.kind).argv({ profile, message: prepared.sent, sessionId: session?.runnerSessionId, systemAppend: prepared.systemAppend });
        console.error(`would run: ${command} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
        process.stdout.write(prepared.sent + "\n");
        return;
      }
      session ??= store.create(agentId, text.split("\n")[0]);
      const outcome = await runnerFor(profile.kind).run(
        { profile, message: prepared.sent, sessionId: session.runnerSessionId, systemAppend: prepared.systemAppend },
        (e) => {
          if (e.type === "text") process.stdout.write(e.text + "\n");
          else if (e.type === "tool") console.error(`  [tool] ${e.name}`);
          else if (e.type === "stderr") process.stderr.write(e.text);
          else if (e.type === "error") console.error(`  [error] ${e.message}`);
        },
      );
      if (outcome.sessionId) session.runnerSessionId = outcome.sessionId;
      store.append(
        session,
        { role: "user", at: new Date().toISOString(), text, sent: prepared.sent === text ? undefined : prepared.sent, mode: prepared.mode, stats: prepared.stats, refs: prepared.refs },
        { role: "agent", at: new Date().toISOString(), text: outcome.text, usage: outcome.usage, costUsd: outcome.costUsd, durationMs: outcome.durationMs, isError: outcome.isError },
      );
      console.error(`session ${session.id} (resume with --session ${session.id}); agent tokens in=${outcome.usage?.inputTokens ?? "?"} out=${outcome.usage?.outputTokens ?? "?"}${outcome.costUsd != null ? ` cost=$${outcome.costUsd.toFixed(4)}` : ""}`);
      process.exitCode = outcome.isError ? 1 : 0;
      return;
    }
    default:
      process.stdout.write(USAGE);
      if (cmd !== "help" && cmd !== "--help" && cmd !== "-h") process.exitCode = 1;
  }
}

main().catch((err: Error) => {
  console.error(`agentos: ${err.message}`);
  process.exitCode = 1;
});
