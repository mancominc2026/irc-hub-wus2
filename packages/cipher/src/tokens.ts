/**
 * Rough token estimate. Modern BPE tokenizers map most common English words
 * to a single token, long or rare words to two or three, digits to roughly
 * one token per three characters, and most punctuation to one token each.
 * Leading spaces merge into the following word and are free; newlines are not.
 *
 * Expect +/-15% versus a real tokenizer. The hub exposes a real count via the
 * Anthropic count_tokens endpoint when an API key is configured; the UI shows
 * estimates with a tilde so nobody mistakes them for billing numbers.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let n = 0;
  const re = /[A-Za-zÀ-ɏ]+|\d+|\n|[ \t\r]+|[^\sA-Za-z\dÀ-ɏ]/g;
  for (const m of text.matchAll(re)) {
    const s = m[0];
    if (s === "\n") n += 1;
    else if (/^[ \t\r]+$/.test(s)) continue;
    else if (/^\d+$/.test(s)) n += Math.ceil(s.length / 3);
    else if (/^[A-Za-zÀ-ɏ]+$/.test(s)) n += Math.max(1, Math.round(s.length / 6));
    else n += 1;
  }
  return n;
}
