import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, decode, renderCodebook, estimateTokens, DEFAULT_CODEBOOK } from "../dist/index.js";

test("strips safe fillers and keeps the instruction", () => {
  const r = encode("Hey, could you please implement the login function? Thanks!");
  assert.equal(r.text, "implement the login function?");
  assert.equal(r.applied["filler:could you please"], 1);
  assert.equal(r.applied["filler:hey"], 1);
});

test("maps multi-word phrases to standard abbreviations, preserving sentence case", () => {
  const r = encode("Open a pull request. Pull requests need the environment variables documented in the documentation.");
  assert.equal(r.text, "Open a PR. PRs need the env vars documented in the docs.");
});

test("never rewrites fenced code, inline code, URLs or paths", () => {
  const src = [
    "please update `please_config.py` and the repository docs at https://example.com/repository/please",
    "```py",
    "# please keep the pull request configuration",
    "x = 'repository'",
    "```",
    "see src/repository/please.ts",
  ].join("\n");
  const r = encode(src, { refs: false });
  assert.ok(r.text.includes("`please_config.py`"));
  assert.ok(r.text.includes("https://example.com/repository/please"));
  assert.ok(r.text.includes("# please keep the pull request configuration"));
  assert.ok(r.text.includes("x = 'repository'"));
  assert.ok(r.text.includes("src/repository/please.ts"));
  assert.ok(r.text.startsWith("update `please_config.py` and the repo docs"));
});

test("aggressive fillers are kept unless opted in", () => {
  const src = "I think we should just maybe refactor this.";
  assert.equal(encode(src).text, "we should just maybe refactor this.");
  assert.equal(encode(src, { aggressive: true }).text, "we should refactor this.");
});

test("does not match inside words or hyphenated identifiers", () => {
  const r = encode("The pre-authentication hook and the hello-world dir are fine; hire him.", { refs: false });
  assert.equal(r.text, "The pre-authentication hook and the hello-world dir are fine; hire him.");
});

test("tags large blocks on first send and replaces repeats with a reference", () => {
  const log = "```\n" + "ERROR line\n".repeat(25) + "```";
  const first = encode(`here is the log\n${log}\nfix it`);
  assert.equal(first.refs.length, 1);
  assert.equal(first.refs[0].status, "new");
  assert.ok(first.text.includes(`[blk ${first.refs[0].id}]\n\`\`\``));

  const second = encode(`same log again\n${log}\nany idea?`, { known: [first.refs[0].id] });
  assert.equal(second.refs[0].status, "reused");
  assert.ok(!second.text.includes("ERROR line"));
  assert.ok(second.text.includes(`[blk ${first.refs[0].id}: unchanged, already in context]`));
  assert.ok(second.stats.tokensAfter < first.stats.tokensAfter);
});

test("long prose paragraphs are referenceable too, short ones are not", () => {
  const para = "word ".repeat(80).trim();
  const r = encode(`${para}\n\nshort line`);
  assert.equal(r.refs.length, 1);
  assert.ok(r.text.endsWith("short line"));
  assert.equal(encode("short line only").refs.length, 0);
  assert.equal(encode("```\nshort = 1\n```").refs.length, 0, "short code blocks are not worth a tag");
});

test("encoding is idempotent", () => {
  const src = "Could you take a look at the authentication configuration in the repository, in order to make sure that it works?";
  const once = encode(src, { refs: false }).text;
  const twice = encode(once, { refs: false }).text;
  assert.equal(twice, once);
  assert.equal(once, "check the auth config in the repo, to ensure it works?");
});

test("decode expands reversible codes and leaves code spans alone", () => {
  const out = decode("Open a PR for the auth impl in `the repo` and the k8s config.");
  assert.equal(out, "Open a pull request for the authentication implementation in `the repo` and the kubernetes configuration.");
});

test("decode does not expand lossy codes", () => {
  assert.equal(decode("re the DB, ensure it can run now"), "re the database, ensure it can run now");
});

test("whitespace is normalised, indentation and newlines inside code preserved", () => {
  const r = encode("a   b\n\n\n\nc  \n    indented list item\n```\n  x   y\n\n\n\n```", { refs: false });
  assert.equal(r.text, "a b\n\nc\n    indented list item\n```\n  x   y\n\n\n\n```");
});

test("stats report savings", () => {
  const r = encode("Hey there! Could you please take a look at the pull request and make sure that the continuous integration passes? Thanks in advance!");
  assert.ok(r.stats.tokensAfter < r.stats.tokensBefore);
  assert.ok(r.stats.savedPct > 30, `saved ${r.stats.savedPct}%`);
  assert.equal(r.stats.charsAfter, r.text.length);
});

test("token estimate behaves sensibly", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("the cat sat"), 3);
  assert.ok(estimateTokens("implementation") >= 2);
  assert.ok(estimateTokens("a\nb\nc") > estimateTokens("a b c"));
});

test("codebook block is compact and has markers", () => {
  const block = renderCodebook(DEFAULT_CODEBOOK);
  assert.ok(block.startsWith("<!-- agentos:codebook v1 start -->"));
  assert.ok(block.endsWith("<!-- agentos:codebook v1 end -->"));
  assert.ok(block.includes("k8s=kubernetes"));
  assert.ok(!block.includes("PR=pull request"), "obvious abbreviations are not listed");
  assert.ok(estimateTokens(block) < 220, `codebook block costs ~${estimateTokens(block)} tokens`);
});
