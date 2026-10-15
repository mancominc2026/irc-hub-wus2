# agentos — composer hub for pre-configured Claude Code / Codex agents

A small "agent OS": you pre-set up agents (a Claude Code checkout here, a Codex sandbox there),
then talk to all of them from one composer. The composer **ciphers** what you type before it
reaches the agent, so each turn costs fewer tokens, and shows you exactly what was sent.

```
 you ──▶ composer (browser)            hub (node)                      agent CLI
         type naturally       ──▶  cipher: strip filler,       ──▶  claude -p --resume … / codex exec
         live preview + stats       abbreviate, reference             reads the codebook in
                              ◀──  blocks already sent        ◀──  CLAUDE.md / AGENTS.md
                                    stream reply, record usage
```

## Why this saves usage

An agent session resends the whole conversation on every turn, so every token you trim from a
message is saved again on each later turn of that session. The cipher is deterministic and
never touches code, paths, URLs or anything in backticks; it only rewrites your prose.

| Technique | What it does | Typical effect |
|---|---|---|
| Filler stripping | drops "hey", "could you please", "if that makes sense", "thanks" | 10–30% on chatty messages |
| Phrase codebook | "pull request" → `PR`, "environment variable" → `env var`, "in order to" → `to` | 5–15% |
| Block references | a log/code block you paste a second time in the same session is replaced by `[blk a1b2c3: unchanged, already in context]` | the whole block, every repeat |
| Whitespace | collapses runs of blank lines and spaces outside code | small |
| Codebook once, not per turn | the key the agent needs lives in `CLAUDE.md` / `AGENTS.md`, which the CLI prompt-caches | the block costs ~150 tokens once |
| Distill (optional) | a cheap model (Claude Haiku 5.5 via your API key) rewrites a rambling message into terse instructions before ciphering | 30–60% on long rambles |
| "Reply concisely" | the codebook block also tells the agent not to restate your request | output tokens |

What it does **not** do: it does not make the agent's own context smaller, and it does not
invent abbreviations the model would have to learn. Every code is a form a coding agent already
reads natively (`PR`, `k8s`, `regex`), which is why abbreviating single common words ("function"
→ "fn") is deliberately *not* in the codebook: those usually cost more tokens, not fewer.

Token numbers in the UI are estimates (marked `~`). The agent's real usage, as reported by the
CLI after each turn, is shown next to each reply and totalled per session.

## Quick start

```bash
npm install
npm run build
cp agents.example.json agents.json      # edit: one entry per pre-set-up agent
npx agentos setup                        # installs the codebook block in each agent's CLAUDE.md / AGENTS.md
npx agentos serve                        # http://127.0.0.1:7777
```

Requires Node 22+ and the `claude` and/or `codex` CLI logged in on this machine. The hub spawns
them headlessly (`claude -p --output-format stream-json`, `codex exec --json`) in the agent's
`cwd`, and resumes the same CLI session on every later message of a composer session.

## agents.json

```json
{
  "port": 7777,
  "dataDir": "~/.agentos",
  "distillModel": "claude-haiku-5-5",
  "agents": [
    { "id": "agentos", "name": "This repo (Claude Code)", "kind": "claude",
      "cwd": ".", "model": "opus", "permissionMode": "acceptEdits", "codebook": "file" },
    { "id": "scratch-codex", "name": "Scratch (Codex)", "kind": "codex",
      "cwd": "~/scratch", "sandbox": "workspace-write" }
  ]
}
```

| Field | Notes |
|---|---|
| `kind` | `claude` or `codex` |
| `cwd` | where the agent runs; relative paths resolve against `agents.json` |
| `model` | `claude --model` / `codex -m` |
| `permissionMode` | claude only: `default`, `acceptEdits`, `plan`, `bypassPermissions` |
| `sandbox` | codex only: `read-only`, `workspace-write`, `danger-full-access` |
| `codebook` | `file` (default, cheapest: `agentos setup` writes it once), `system-prompt` (sent every run), `none` (clear text, no savings) |
| `command`, `extraArgs`, `env` | override the executable, append CLI flags, extra environment |

The hub looks for `agents.json` at `$AGENTOS_CONFIG`, `./agents.json`, then `~/.agentos/agents.json`.
Sessions are stored as JSON under `dataDir/sessions/<agent>/`.

## Using the composer

- Pick an agent, write naturally. The right pane shows **exactly** what the agent will receive
  and the estimated saving. `Ctrl/⌘+Enter` sends.
- **cipher** off sends your text verbatim (for an agent without the codebook, or when wording matters).
- **aggressive** also strips hedges like "just", "maybe", "I guess". Off by default because they
  can change what you are asking for.
- **distill** (needs `ANTHROPIC_API_KEY` in the hub's environment) rewrites the draft with a
  cheap model first; you still see and can edit the result before sending. It bills your API key,
  not your Claude Code / Codex subscription.
- "show sent" on any of your messages reveals the ciphered text that went out.
- Sessions on the left are composer sessions; each maps to one resumable CLI session.

## CLI

```
agentos serve   [--config agents.json] [--port 7777]
agentos setup   [agentId ...]              install / refresh the codebook block
agentos agents                             list agents and codebook status
agentos cipher  [--aggressive] [text]      cipher text or stdin; stats on stderr
agentos decode  [text]                     expand reversible codes
agentos codebook                           print the block that setup installs
agentos send    <agentId> [--clear] [--session id] [--dry-run] [text]
```

`agentos send … --dry-run` prints the ciphered message and the exact command that would run.

```
$ echo "Hey there, could you please take a look at the authentication configuration in the \
repository and make sure that the continuous integration passes as soon as possible? Thanks!" | agentos cipher
check the auth config in the repo and ensure the CI passes ASAP?
~39 -> ~14 tokens (64.1% saved), 187 -> 64 chars
```

## HTTP API (what the UI uses)

| Route | Purpose |
|---|---|
| `GET /api/agents` | profiles, capabilities, the codebook block |
| `GET /api/agents/:id/sessions`, `GET|DELETE …/sessions/:sid` | session list / transcript |
| `POST /api/cipher` `{agentId?, sessionId?, text, mode?, aggressive?}` | preview: `{sent, stats, refs, applied}` |
| `POST /api/send` `{agentId, sessionId?, text, mode?, aggressive?}` | runs a turn; `text/event-stream` of `session`, `init`, `text`, `tool`, `warning`, `error`, `done` |
| `POST /api/distill` `{text}` | cheap-model rewrite (501 without an API key) |
| `POST /api/count` `{text, model?}` | exact token count from the API, to calibrate the estimate |
| `POST /api/decode` `{text}` | expand reversible codes |

The server binds to `127.0.0.1` and has no auth; it spawns agent CLIs with whatever permissions
you configured. Put it behind something if you expose it.

## Layout

```
  packages/cipher/   encode / decode / renderCodebook / estimateTokens  (no dependencies)
  packages/hub/      config, runners (claude, codex), sessions, server, cli, distill
  apps/composer/     single-file web UI served by the hub
  agents.example.json
```

`npm test` builds and runs 23 tests, including an end-to-end run through
`packages/hub/test/fake-claude.mjs`, a stand-in that speaks the Claude Code stream-json protocol
so the pipeline is exercised without spending tokens.

## Caveats

- The Codex runner follows the `codex exec --json` / `codex exec resume` event shapes as of
  mid-2026 and was written without a Codex binary to test against; if your build emits different
  events, `packages/hub/src/runners/codex.ts` is the one file to adjust.
- The cipher is conservative, but it is a rewrite of your words. The preview pane exists so you
  always see what goes out; turn cipher off for a message where exact wording matters.
- Block references rely on the agent's session still holding the earlier block. Starting a new
  composer session starts a new agent session, with an empty reference set.
