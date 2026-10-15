import { createHash } from "node:crypto";
import { type Codebook, DEFAULT_CODEBOOK } from "./codebook.js";
import { estimateTokens } from "./tokens.js";

export interface EncodeOptions {
  codebook?: Codebook;
  /** Also strip aggressiveFillers ("just", "maybe"...). Default false. */
  aggressive?: boolean;
  /** Tag large blocks with ids and replace repeats with a reference. Default true. */
  refs?: boolean;
  /** Block ids the agent has already seen in this session. */
  known?: Iterable<string>;
  /**
   * A fenced code block or prose paragraph at least this long becomes a referenceable block. Default 240.
   * Tagging costs ~7 tokens, so anything shorter is not worth it unless it is pasted again and again.
   */
  minRefChars?: number;
}

export interface RefInfo {
  id: string;
  status: "new" | "reused";
  chars: number;
  preview: string;
}

export interface EncodeStats {
  charsBefore: number;
  charsAfter: number;
  tokensBefore: number;
  tokensAfter: number;
  savedTokens: number;
  savedPct: number;
}

export interface EncodeResult {
  text: string;
  stats: EncodeStats;
  refs: RefInfo[];
  /** rule -> number of times it fired */
  applied: Record<string, number>;
}

type Range = [number, number];

/** Fenced code, inline code, URLs and slash-paths are never rewritten. */
const PROTECTED =
  /```[\s\S]*?(?:```|$)|`[^`\n]+`|https?:\/\/[^\s)>\]]+|\S+\/\S+/g;

function protectedRanges(text: string): Range[] {
  const out: Range[] = [];
  for (const m of text.matchAll(PROTECTED)) out.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return out;
}

/**
 * String.replace over the whole text, but a match that touches a protected
 * range is returned unchanged. Running on the whole text keeps ^ and $ honest
 * and stops a phrase from being matched across a code span.
 */
function replaceOutside(text: string, re: RegExp, fn: (m: string, groups: string[]) => string): string {
  const ranges = protectedRanges(text);
  return text.replace(re, (...args: unknown[]) => {
    const m = args[0] as string;
    const offset = args[args.length - 2] as number;
    const groups = args.slice(1, -2) as string[];
    const end = offset + m.length;
    for (const [s, e] of ranges) if (offset < e && end > s) return m;
    return fn(m, groups);
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a word-bounded, case-insensitive matcher where spaces and hyphens are interchangeable. */
function phraseRe(phrase: string): RegExp {
  const body = phrase
    .trim()
    .split(/[\s-]+/)
    .map(escapeRe)
    .join("[ \\t-]+");
  return new RegExp(`(?<![\\w-])${body}(?![\\w-])`, "gi");
}

interface Compiled {
  phrases: { rule: Codebook["phrases"][number]; re: RegExp }[];
  fillers: { name: string; re: RegExp }[];
  aggressive: { name: string; re: RegExp }[];
}

const cache = new WeakMap<Codebook, Compiled>();

function compile(cb: Codebook): Compiled {
  let c = cache.get(cb);
  if (c) return c;
  const byLen = (a: string, b: string) => b.length - a.length;
  const fillerRe = (f: string) => {
    const trailingPunct = /[,:;]$/.test(f);
    const core = f.replace(/[,:;]$/, "");
    const body = core.split(/[\s-]+/).map(escapeRe).join("[ \\t-]+");
    // the filler plus the punctuation that hangs off it, so "Hey, fix x" -> "fix x"
    return new RegExp(
      `(?<![\\w-])${body}(?![\\w-])${trailingPunct ? "[,:;]" : "(?:[ \\t]*[,:;])?"}`,
      "gi",
    );
  };
  c = {
    phrases: [...cb.phrases]
      .sort((a, b) => b.phrase.length - a.phrase.length)
      .map((rule) => ({ rule, re: phraseRe(rule.phrase) })),
    fillers: [...cb.fillers].sort(byLen).map((f) => ({ name: f, re: fillerRe(f) })),
    aggressive: [...cb.aggressiveFillers].sort(byLen).map((f) => ({ name: f, re: fillerRe(f) })),
  };
  cache.set(cb, c);
  return c;
}

function matchCase(sample: string, code: string): string {
  if (!code) return code;
  const first = sample[0];
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    const c0 = code[0];
    if (c0 === c0.toLowerCase() && c0 !== c0.toUpperCase()) return c0.toUpperCase() + code.slice(1);
  }
  return code;
}

function cipherText(text: string, c: Compiled, aggressive: boolean, applied: Record<string, number>): string {
  let out = text;
  const bump = (k: string) => {
    applied[k] = (applied[k] ?? 0) + 1;
  };
  for (const { name, re } of c.fillers) {
    out = replaceOutside(out, re, () => {
      bump(`filler:${name}`);
      return "";
    });
  }
  if (aggressive) {
    for (const { name, re } of c.aggressive) {
      out = replaceOutside(out, re, () => {
        bump(`filler:${name}`);
        return "";
      });
    }
  }
  for (const { rule, re } of c.phrases) {
    out = replaceOutside(out, re, (m) => {
      bump(rule.phrase);
      return matchCase(m, rule.code);
    });
  }
  // tidy what the removals left behind, without touching line-leading indentation
  const cleanups: [RegExp, string][] = [
    [/(?<=\S)[ \t]{2,}/g, " "],
    [/[ \t]+([,.;:!?])/g, "$1"],
    [/([,;:])\1+/g, "$1"],
    [/(?<=[.!?])[ \t]*[.!?]+(?=\s|$)/g, ""],
    [/^[ \t]*[,.;:!?]+[ \t]*$/gm, ""],
    [/^([ \t]*)[,;:.!?]+[ \t]*(?=\S)/gm, "$1"],
    [/[ \t]+(?=\n)/g, ""],
    [/\n{3,}/g, "\n\n"],
  ];
  for (const [re, rep] of cleanups) out = replaceOutside(out, re, (_m, g) => rep.replace("$1", g[0] ?? ""));
  return out;
}

function blockId(content: string): string {
  const norm = content.replace(/\r/g, "").trim();
  return createHash("sha256").update(norm).digest("hex").slice(0, 6);
}

const FENCE_BLOCK = /```[\s\S]*?(?:```|$)/g;

function applyRefs(text: string, known: Set<string>, minRefChars: number, refs: RefInfo[]): string {
  // candidates: fenced code blocks and prose paragraphs, both >= minRefChars
  const pieces: { text: string; candidate: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(FENCE_BLOCK)) {
    const i = m.index ?? 0;
    if (i > last) pieces.push({ text: text.slice(last, i), candidate: false });
    pieces.push({ text: m[0], candidate: true });
    last = i + m[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), candidate: false });

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pieces) {
    if (p.candidate) {
      out.push(p.text.trim().length >= minRefChars ? refBlock(p.text, known, seen, refs) : p.text);
      continue;
    }
    // split prose into paragraphs; long ones become candidates
    const parts = p.text.split(/(\n[ \t]*\n)/);
    for (const part of parts) {
      if (/^\n[ \t]*\n$/.test(part) || part.trim().length < minRefChars) out.push(part);
      else out.push(refBlock(part, known, seen, refs));
    }
  }
  return out.join("");
}

function refBlock(block: string, known: Set<string>, seen: Set<string>, refs: RefInfo[]): string {
  const lead = block.match(/^\s*/)?.[0] ?? "";
  const trail = block.match(/\s*$/)?.[0] ?? "";
  const body = block.trim();
  if (!body) return block;
  const id = blockId(body);
  const preview = body.replace(/\s+/g, " ").slice(0, 60);
  if (known.has(id) || seen.has(id)) {
    refs.push({ id, status: "reused", chars: body.length, preview });
    return `${lead}[blk ${id}: unchanged, already in context]${trail}`;
  }
  seen.add(id);
  refs.push({ id, status: "new", chars: body.length, preview });
  return `${lead}[blk ${id}]\n${body}${trail}`;
}

export function encode(input: string, opts: EncodeOptions = {}): EncodeResult {
  const cb = opts.codebook ?? DEFAULT_CODEBOOK;
  const c = compile(cb);
  const applied: Record<string, number> = {};
  const original = input.replace(/\r\n/g, "\n");

  let text = cipherText(original, c, !!opts.aggressive, applied).trim();

  const refs: RefInfo[] = [];
  if (opts.refs !== false) {
    const known = new Set(opts.known ?? []);
    text = applyRefs(text, known, opts.minRefChars ?? 240, refs);
  }

  const tokensBefore = estimateTokens(original);
  const tokensAfter = estimateTokens(text);
  const savedTokens = tokensBefore - tokensAfter;
  return {
    text,
    refs,
    applied,
    stats: {
      charsBefore: original.length,
      charsAfter: text.length,
      tokensBefore,
      tokensAfter,
      savedTokens,
      savedPct: tokensBefore ? Math.round((savedTokens / tokensBefore) * 1000) / 10 : 0,
    },
  };
}

/** Expand reversible codes back to their phrases. Code spans, URLs and paths are left alone. */
export function decode(input: string, codebook: Codebook = DEFAULT_CODEBOOK): string {
  const rules = codebook.phrases.filter((r) => r.reversible !== false && r.code);
  // longest codes first so "PRs" wins over "PR"
  rules.sort((a, b) => b.code.length - a.code.length);
  const compiled = rules.map((r) => {
    const acronym = /^[A-Z0-9.~]+s?$/.test(r.code);
    const body = escapeRe(r.code);
    return { r, acronym, re: new RegExp(`(?<![\\w-])${body}(?![\\w-])`, acronym ? "g" : "gi") };
  });
  let t = input;
  for (const { r, re, acronym } of compiled) t = replaceOutside(t, re, (m) => (acronym ? r.phrase : matchCase(m, r.phrase)));
  return t;
}

/** Markdown block to install in the agent's CLAUDE.md / AGENTS.md so it reads ciphered messages natively. */
export function renderCodebook(codebook: Codebook = DEFAULT_CODEBOOK): string {
  // only the codes that are not everyday abbreviations get a glossary entry; keep the block cheap
  const obvious = /^(configs?|repos?|dirs?|docs|deps?|spec|params?|args?|info|source|regex(es)?|env vars?|PRs?|MRs?|CLI|API|UI|CI|CD|OS|TS|JS|DBs?|ASAP|e\.g\.|i\.e\.)$/;
  const abbrevs = codebook.phrases
    .filter((r) => r.reversible !== false && r.code && r.code.length < r.phrase.length && !obvious.test(r.code))
    .map((r) => `${r.code}=${r.phrase}`)
    .join(" · ");
  return [
    `<!-- agentos:codebook v${codebook.version} start -->`,
    `## Composer cipher`,
    `Messages from the composer are compressed to save tokens. Read them as ordinary instructions.`,
    `- Pleasantries and filler are stripped; terse phrasing is not a tone change. "re" means regarding.`,
    `- Abbreviations: ${abbrevs}.`,
    `- \`[blk <id>]\` on the line before a block labels it. \`[blk <id>: unchanged, already in context]\` means that exact block was sent earlier in this session: use the earlier copy, never ask for it again.`,
    `- Reply concisely. Do not restate the request or the ciphered text.`,
    `<!-- agentos:codebook v${codebook.version} end -->`,
  ].join("\n");
}
