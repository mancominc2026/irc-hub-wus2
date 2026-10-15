import { spawn } from "node:child_process";
import readline from "node:readline";
import type { RunEvent } from "./types.js";

export interface SpawnJsonlOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin: string;
  signal?: AbortSignal;
  onLine: (obj: unknown, raw: string) => void;
  onEvent: (e: RunEvent) => void;
}

/** Spawn a CLI that speaks JSON-lines on stdout, feeding it the prompt on stdin. */
export function spawnJsonl(opts: SpawnJsonlOptions): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env };
    // Running an agent CLI from inside another Claude Code session is refused when this is set.
    delete env.CLAUDECODE;
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      signal: opts.signal,
    });
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).name === "AbortError") return resolve(null);
      reject(err);
    });
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const t = line.trim();
      if (!t) return;
      try {
        opts.onLine(JSON.parse(t), t);
      } catch {
        opts.onEvent({ type: "status", message: t });
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => opts.onEvent({ type: "stderr", text: d }));
    child.on("close", (code) => resolve(code));
    child.stdin.on("error", () => {
      /* child exited before reading stdin; close event reports it */
    });
    child.stdin.end(opts.stdin);
  });
}
