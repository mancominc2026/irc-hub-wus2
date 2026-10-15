import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, prepareMessage } from "../dist/server.js";
import { SessionStore } from "../dist/sessions.js";
import { installCodebook, hasCodebook } from "../dist/codebook-install.js";
import { loadConfig } from "../dist/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, "fake-claude.mjs");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentos-"));
}

function profile(cwd, extra = {}) {
  return { id: "fake", name: "Fake", kind: "claude", cwd, command: FAKE, codebook: "file", ...extra };
}

test("codebook install creates, appends, refreshes without touching other content", () => {
  const cwd = tmp();
  const p = profile(cwd);
  assert.equal(installCodebook(p).action, "created");
  assert.ok(hasCodebook(p));
  const file = path.join(cwd, "CLAUDE.md");
  fs.writeFileSync(file, "# My project\n\nrules here\n");
  assert.equal(installCodebook(p).action, "updated");
  const content = fs.readFileSync(file, "utf8");
  assert.ok(content.startsWith("# My project\n\nrules here\n"));
  assert.equal(installCodebook(p).action, "unchanged");
  assert.equal((content.match(/agentos:codebook/g) || []).length, 2);
});

test("prepareMessage respects mode and codebook settings", () => {
  const p = profile("/tmp");
  const text = "Could you please open a pull request?";
  assert.equal(prepareMessage(p, undefined, text, "cipher").sent, "open a PR?");
  assert.equal(prepareMessage(p, undefined, text, "clear").sent, text);
  assert.equal(prepareMessage({ ...p, codebook: "none" }, undefined, text, "cipher").sent, text);
  const sp = prepareMessage({ ...p, codebook: "system-prompt" }, undefined, text, "cipher");
  assert.ok(sp.systemAppend.includes("agentos:codebook"));
});

test("loadConfig validates and resolves cwd", () => {
  const dir = tmp();
  const cfgPath = path.join(dir, "agents.json");
  fs.writeFileSync(cfgPath, JSON.stringify({ agents: [{ id: "x", kind: "claude", cwd: "./work" }] }));
  const cfg = loadConfig(cfgPath);
  assert.equal(cfg.agents[0].cwd, path.join(dir, "work"));
  assert.equal(cfg.agents[0].codebook, "file");
  fs.writeFileSync(cfgPath, JSON.stringify({ agents: [{ id: "x", kind: "gpt", cwd: "." }] }));
  assert.throws(() => loadConfig(cfgPath), /kind must be claude or codex/);
});

async function readSse(res) {
  const events = [];
  const text = await res.text();
  for (const chunk of text.split("\n\n")) {
    const ev = chunk.match(/^event: (.+)$/m)?.[1];
    const data = chunk.match(/^data: (.+)$/m)?.[1];
    if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
  }
  return events;
}

test("end to end: send through the fake claude, resume, and dedupe a repeated block", async () => {
  const cwd = tmp();
  const p = profile(cwd, { model: "fake-opus" });
  installCodebook(p);
  const store = new SessionStore(tmp());
  const server = createServer({ agents: [p] }, store);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const agents = await (await fetch(`${base}/api/agents`)).json();
    assert.equal(agents.agents[0].id, "fake");
    assert.equal(agents.agents[0].hasCodebook, true);
    assert.equal("env" in agents.agents[0], false);

    const log = "```\n" + "stack frame\n".repeat(25) + "```";
    const first = await fetch(`${base}/api/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "fake", text: `Hey, could you please look at this?\n${log}` }),
    });
    assert.equal(first.headers.get("content-type"), "text/event-stream");
    const ev1 = await readSse(first);
    const sess = ev1.find((e) => e.event === "session").data;
    assert.ok(sess.sent.startsWith("look at this?\n[blk "));
    assert.equal(sess.refs[0].status, "new");
    assert.ok(ev1.some((e) => e.event === "tool" && e.data.name === "Read"));
    const done1 = ev1.find((e) => e.event === "done").data;
    assert.ok(done1.message.text.startsWith("echo("));
    assert.equal(done1.message.usage.outputTokens, 12);
    assert.ok(done1.runnerSessionId);

    const second = await fetch(`${base}/api/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: "fake", sessionId: done1.sessionId, text: `same thing again\n${log}` }),
    });
    const ev2 = await readSse(second);
    const sess2 = ev2.find((e) => e.event === "session").data;
    assert.equal(sess2.refs[0].status, "reused");
    assert.ok(!sess2.sent.includes("stack frame"));
    const done2 = ev2.find((e) => e.event === "done").data;
    assert.equal(done2.runnerSessionId, done1.runnerSessionId, "resumed the same runner session");
    assert.equal(done2.totals.savedTokens > sess.stats.savedTokens, true);

    const stored = await (await fetch(`${base}/api/agents/fake/sessions/${done1.sessionId}`)).json();
    assert.equal(stored.session.messages.length, 4);
    assert.equal(stored.session.refs.length, 1);
    const list = await (await fetch(`${base}/api/agents/fake/sessions`)).json();
    assert.equal(list.sessions.length, 1);

    const clear = await fetch(`${base}/api/cipher`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId: "fake", text: "please do x", mode: "clear" }) });
    assert.equal((await clear.json()).sent, "please do x");

    const bad = await fetch(`${base}/api/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId: "nope", text: "x" }) });
    assert.equal(bad.status, 404);
  } finally {
    server.close();
  }
});

test("runner failure is reported, not swallowed", async () => {
  const p = profile(tmp(), { env: { FAKE_CLAUDE_FAIL: "1" } });
  const store = new SessionStore(tmp());
  const server = createServer({ agents: [p] }, store);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId: "fake", text: "x", mode: "clear" }) });
    const done = (await readSse(res)).find((e) => e.event === "done").data;
    assert.equal(done.message.isError, true);
    assert.equal(done.exitCode, 1);
  } finally {
    server.close();
  }
});

test("missing executable surfaces as an error event", async () => {
  const p = profile(tmp(), { command: "/definitely/not/here" });
  const server = createServer({ agents: [p] }, new SessionStore(tmp()));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId: "fake", text: "x" }) });
    const events = await readSse(res);
    assert.ok(events.some((e) => e.event === "error" && /failed to start claude/.test(e.data.message)));
  } finally {
    server.close();
  }
});
