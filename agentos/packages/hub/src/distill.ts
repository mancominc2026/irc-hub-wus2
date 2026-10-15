import Anthropic from "@anthropic-ai/sdk";

/**
 * Optional second stage: a cheap model rewrites a rambling message into terse
 * instructions before the deterministic cipher runs. This is billed to the
 * Anthropic API key, not to the Claude Code / Codex subscription, which is the
 * point: a few hundred Haiku tokens here save far more subscription tokens on
 * every later turn of the agent session (the message is resent each turn).
 */
export const DEFAULT_DISTILL_MODEL = "claude-haiku-5-5";

const DISTILL_SYSTEM = `You compress instructions for a coding agent.
Rewrite the user's message as the shortest set of imperative instructions that preserves every requirement, constraint, name, path, number and code snippet.
Rules:
- Keep all fenced code blocks, inline code, file paths, URLs, identifiers and error text verbatim.
- Do not add requirements, assumptions, explanations or pleasantries.
- Do not answer the message; only rewrite it.
- Prefer a short bullet list; one line per instruction. Drop hedging and repetition.
- Output only the rewritten message.`;

export function distillAvailable(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export async function distill(text: string, model: string = DEFAULT_DISTILL_MODEL): Promise<string> {
  const res = await getClient().messages.create({
    model,
    max_tokens: 4096,
    output_config: { effort: "low" },
    system: DISTILL_SYSTEM,
    messages: [{ role: "user", content: text }],
  });
  if (res.stop_reason === "refusal") throw new Error("distill model declined the request; send the original instead");
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Exact token count from the API, for calibrating the estimator. */
export async function countTokens(text: string, model = "claude-opus-5-5"): Promise<number> {
  const r = await getClient().messages.countTokens({ model, messages: [{ role: "user", content: text }] });
  return r.input_tokens;
}
