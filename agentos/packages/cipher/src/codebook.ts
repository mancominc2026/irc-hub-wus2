/**
 * The codebook is the shared key between the composer and the agent.
 *
 * Two things live here:
 *  - phrase rules: long phrases that collapse to a shorter, well-known form the
 *    agent already understands ("pull request" -> "PR"). Every rule must be
 *    something a coding agent reads without a glossary; the rendered codebook
 *    block installed in CLAUDE.md / AGENTS.md is only a safety net.
 *  - fillers: words that carry no instruction ("please", "could you"). They are
 *    removed outright. Aggressive fillers change modality slightly ("maybe",
 *    "just") and are only removed when the caller opts in.
 *
 * Design rule for adding phrase rules: only map a phrase to a code when the
 * code is at least as cheap in tokens. Multi-word -> one word always wins.
 * Single common words ("function", "with") are usually already one token, so
 * abbreviating them ("fn", "w/") can cost MORE tokens. Don't.
 */

export interface PhraseRule {
  /** Phrase to match in prose. Case-insensitive, word-bounded. Spaces and hyphens match each other. */
  phrase: string;
  /** Replacement text. */
  code: string;
  /** Whether decode() may expand the code back to the phrase. Default true. */
  reversible?: boolean;
}

export interface Codebook {
  version: string;
  phrases: PhraseRule[];
  /** Removed in every mode. Safe: removing them never changes what is being asked. */
  fillers: string[];
  /** Removed only with { aggressive: true }. These can soften or strengthen a request. */
  aggressiveFillers: string[];
}

export const DEFAULT_CODEBOOK: Codebook = {
  version: "1",
  phrases: [
    // multi-word technical terms -> standard abbreviations
    { phrase: "pull requests", code: "PRs" },
    { phrase: "pull request", code: "PR" },
    { phrase: "merge requests", code: "MRs" },
    { phrase: "merge request", code: "MR" },
    { phrase: "environment variables", code: "env vars" },
    { phrase: "environment variable", code: "env var" },
    { phrase: "regular expressions", code: "regexes" },
    { phrase: "regular expression", code: "regex" },
    { phrase: "command line interface", code: "CLI" },
    { phrase: "application programming interface", code: "API" },
    { phrase: "user interface", code: "UI" },
    { phrase: "continuous integration", code: "CI" },
    { phrase: "continuous deployment", code: "CD" },
    { phrase: "continuous delivery", code: "CD" },
    { phrase: "test driven development", code: "TDD" },
    { phrase: "infrastructure as code", code: "IaC" },
    { phrase: "operating system", code: "OS" },
    { phrase: "source code", code: "source" },
    { phrase: "kubernetes", code: "k8s" },
    { phrase: "typescript", code: "TS" },
    { phrase: "javascript", code: "JS" },
    // single long words -> standard short forms (each is >= as cheap in tokens)
    { phrase: "configuration", code: "config" },
    { phrase: "configurations", code: "configs" },
    { phrase: "repositories", code: "repos" },
    { phrase: "repository", code: "repo" },
    { phrase: "directories", code: "dirs" },
    { phrase: "directory", code: "dir" },
    { phrase: "implementation", code: "impl" },
    { phrase: "database", code: "DB" },
    { phrase: "databases", code: "DBs" },
    { phrase: "authentication", code: "auth" },
    { phrase: "authorization", code: "authz" },
    { phrase: "documentation", code: "docs" },
    { phrase: "dependencies", code: "deps" },
    { phrase: "dependency", code: "dep" },
    { phrase: "specification", code: "spec" },
    { phrase: "parameters", code: "params" },
    { phrase: "parameter", code: "param" },
    { phrase: "arguments", code: "args" },
    { phrase: "argument", code: "arg" },
    { phrase: "information", code: "info" },
    { phrase: "approximately", code: "~", reversible: false },
    // verbose English -> terse English (not reversible: the codes are ordinary words)
    { phrase: "as soon as possible", code: "ASAP" },
    { phrase: "for example", code: "e.g." },
    { phrase: "in other words", code: "i.e." },
    { phrase: "in order to", code: "to", reversible: false },
    { phrase: "make sure that", code: "ensure", reversible: false },
    { phrase: "make sure", code: "ensure", reversible: false },
    { phrase: "is able to", code: "can", reversible: false },
    { phrase: "are able to", code: "can", reversible: false },
    { phrase: "is not able to", code: "cannot", reversible: false },
    { phrase: "a lot of", code: "many", reversible: false },
    { phrase: "lots of", code: "many", reversible: false },
    { phrase: "a number of", code: "several", reversible: false },
    { phrase: "at the moment", code: "now", reversible: false },
    { phrase: "at this point in time", code: "now", reversible: false },
    { phrase: "right now", code: "now", reversible: false },
    { phrase: "with respect to", code: "re", reversible: false },
    { phrase: "with regard to", code: "re", reversible: false },
    { phrase: "with regards to", code: "re", reversible: false },
    { phrase: "in terms of", code: "re", reversible: false },
    { phrase: "regarding", code: "re", reversible: false },
    { phrase: "it is necessary to", code: "must", reversible: false },
    { phrase: "in the event that", code: "if", reversible: false },
    { phrase: "in case", code: "if", reversible: false },
    { phrase: "due to the fact that", code: "because", reversible: false },
    { phrase: "on the other hand", code: "but", reversible: false },
    { phrase: "the same as", code: "like", reversible: false },
    { phrase: "prior to", code: "before", reversible: false },
    { phrase: "subsequent to", code: "after", reversible: false },
    { phrase: "in addition to", code: "plus", reversible: false },
    { phrase: "in addition", code: "also", reversible: false },
    { phrase: "as well as", code: "and", reversible: false },
    { phrase: "whether or not", code: "whether", reversible: false },
    { phrase: "each and every", code: "every", reversible: false },
    { phrase: "first and foremost", code: "first", reversible: false },
    { phrase: "take a look at", code: "check", reversible: false },
    { phrase: "have a look at", code: "check", reversible: false },
    { phrase: "look into", code: "check", reversible: false },
    { phrase: "figure out", code: "determine", reversible: false },
    { phrase: "get rid of", code: "remove", reversible: false },
    { phrase: "come up with", code: "propose", reversible: false },
    { phrase: "end up", code: "", reversible: false },
    { phrase: "is going to", code: "will", reversible: false },
    { phrase: "are going to", code: "will", reversible: false },
    { phrase: "going forward", code: "", reversible: false },
    { phrase: "at the end of the day", code: "", reversible: false },
  ],
  fillers: [
    "please",
    "could you please",
    "could you",
    "can you please",
    "can you",
    "would you please",
    "would you mind",
    "would you",
    "will you",
    "i want you to",
    "i'd like you to",
    "i would like you to",
    "i need you to",
    "i'd like to ask you to",
    "i was wondering if you could",
    "i was wondering if",
    "it would be great if you could",
    "it would be great if",
    "it would be nice if you could",
    "it would be nice if",
    "it would be good if",
    "go ahead and",
    "if that makes sense",
    "does that make sense",
    "if possible",
    "if you can",
    "if you could",
    "you know",
    "basically",
    "kind of",
    "sort of",
    "so basically",
    "okay so",
    "ok so",
    "so,",
    "thanks in advance",
    "thank you so much",
    "thank you",
    "thanks",
    "hey there",
    "hi there",
    "hey",
    "hi",
    "hello",
    "cheers",
    "no rush",
    "whenever you get a chance",
    "when you get a chance",
    "feel free to",
    "i think that",
    "i think",
    "i believe that",
    "i believe",
    "as you can see",
    "as mentioned",
    "like i said",
    "to be honest",
    "honestly",
    "obviously",
  ],
  aggressiveFillers: [
    "just",
    "actually",
    "really",
    "simply",
    "very",
    "quite",
    "pretty much",
    "pretty",
    "definitely",
    "essentially",
    "literally",
    "a little bit",
    "a bit",
    "somewhat",
    "i guess",
    "i feel like",
    "maybe",
    "perhaps",
    "probably",
    "i mean",
    "well,",
    "anyway",
    "also,",
  ],
};
