#!/usr/bin/env node
// Stand-in for the `claude` CLI: speaks the same stream-json protocol so the hub can be tested without spending tokens.
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const args = process.argv.slice(2);
const resumeAt = args.indexOf("--resume");
const sessionId = resumeAt >= 0 ? args[resumeAt + 1] : randomUUID();
const modelAt = args.indexOf("--model");
const model = modelAt >= 0 ? args[modelAt + 1] : "fake-model";
const prompt = fs.readFileSync(0, "utf8");
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

if (!args.includes("-p") || !args.includes("stream-json")) {
  console.error("fake-claude: expected -p --output-format stream-json");
  process.exit(2);
}
emit({ type: "system", subtype: "init", session_id: sessionId, model, cwd: process.cwd() });
emit({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "README.md" } }] } });
emit({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } });
const reply = `echo(${prompt.length}): ${prompt.slice(0, 80).replace(/\n/g, " ")}`;
emit({ type: "assistant", message: { content: [{ type: "text", text: reply }] } });
emit({
  type: "result",
  subtype: process.env.FAKE_CLAUDE_FAIL ? "error_during_execution" : "success",
  is_error: !!process.env.FAKE_CLAUDE_FAIL,
  result: reply,
  session_id: sessionId,
  duration_ms: 42,
  num_turns: 1,
  total_cost_usd: 0.001,
  usage: { input_tokens: prompt.length, output_tokens: 12, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
});
process.exit(process.env.FAKE_CLAUDE_FAIL ? 1 : 0);
