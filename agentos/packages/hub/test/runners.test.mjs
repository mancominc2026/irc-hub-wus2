import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeEvent, parseCodexEvent, claudeRunner, codexRunner } from "../dist/runners/index.js";

test("claude stream-json events are mapped", () => {
  assert.deepEqual(parseClaudeEvent({ type: "system", subtype: "init", session_id: "s1", model: "m" }), [{ type: "init", sessionId: "s1", model: "m" }]);
  assert.deepEqual(parseClaudeEvent({ type: "assistant", message: { content: [{ type: "text", text: "hi" }, { type: "tool_use", name: "Bash", input: { command: "ls" } }] } }), [
    { type: "text", text: "hi" },
    { type: "tool", name: "Bash", input: { command: "ls" } },
  ]);
  const [r] = parseClaudeEvent({ type: "result", subtype: "success", result: "done", session_id: "s1", usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 7 }, total_cost_usd: 0.01, duration_ms: 5, num_turns: 1, is_error: false });
  assert.equal(r.type, "result");
  assert.equal(r.sessionId, "s1");
  assert.equal(r.usage.inputTokens, 10);
  assert.equal(r.usage.cacheReadTokens, 7);
  assert.equal(r.isError, false);
  assert.deepEqual(parseClaudeEvent({ type: "user", message: {} }), []);
  assert.equal(parseClaudeEvent({ type: "result", subtype: "error_max_turns" })[0].isError, true);
});

test("codex jsonl events are mapped", () => {
  assert.deepEqual(parseCodexEvent({ type: "thread.started", thread_id: "t1" }), [{ type: "init", sessionId: "t1" }]);
  assert.deepEqual(parseCodexEvent({ type: "item.completed", item: { type: "agent_message", text: "yo" } }), [{ type: "text", text: "yo" }]);
  assert.deepEqual(parseCodexEvent({ type: "item.completed", item: { type: "command_execution", command: "ls" } }), [{ type: "tool", name: "command", input: "ls" }]);
  const [r] = parseCodexEvent({ type: "turn.completed", usage: { input_tokens: 5, cached_input_tokens: 2, output_tokens: 1 } });
  assert.equal(r.usage.cacheReadTokens, 2);
  assert.equal(parseCodexEvent({ type: "error", message: "boom" })[0].type, "error");
});

test("argv construction", () => {
  const profile = { id: "a", name: "a", kind: "claude", cwd: "/tmp", model: "opus", permissionMode: "acceptEdits", extraArgs: ["--add-dir", "/x"] };
  assert.deepEqual(claudeRunner.argv({ profile, message: "m" }), {
    command: "claude",
    args: ["-p", "--output-format", "stream-json", "--verbose", "--model", "opus", "--permission-mode", "acceptEdits", "--add-dir", "/x"],
  });
  assert.ok(claudeRunner.argv({ profile, message: "m", sessionId: "S", systemAppend: "CB" }).args.join(" ").includes("--resume S"));
  const cx = { id: "c", name: "c", kind: "codex", cwd: "/w", model: "o3", sandbox: "workspace-write" };
  assert.deepEqual(codexRunner.argv({ profile: cx, message: "m" }).args, ["exec", "--json", "-m", "o3", "--sandbox", "workspace-write", "-C", "/w", "-"]);
  assert.deepEqual(codexRunner.argv({ profile: cx, message: "m", sessionId: "T" }).args, ["exec", "resume", "T", "--json", "-"]);
});
