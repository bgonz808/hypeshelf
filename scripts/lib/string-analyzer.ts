/**
 * POS tagging and i18n key suggestion from source context.
 *
 * Uses `compromise` for local POS tagging (no API calls).
 * See ADR-004 Phase 4.
 */

// compromise is ESM-only in newer versions; dynamic import
let nlpModule: typeof import("compromise") | null = null;

async function getNlp(): Promise<typeof import("compromise")> {
  if (!nlpModule) {
    nlpModule = await import("compromise");
  }
  return nlpModule;
}

// ── POS Tagging ────────────────────────────────────────────────────

interface TaggedWord {
  text: string;
  tags: string[];
}

export async function analyzeString(
  text: string
): Promise<{ tagged: TaggedWord[]; display: string }> {
  const mod = await getNlp();
  const nlp = mod.default ?? mod;
  const doc = (nlp as CallableFunction)(text);
  const terms = doc.terms().json() as Array<{
    text: string;
    terms: Array<{ text: string; tags: string[] }>;
  }>;

  const tagged: TaggedWord[] = [];
  for (const sentence of terms) {
    if (sentence.terms) {
      for (const term of sentence.terms) {
        tagged.push({ text: term.text, tags: term.tags ?? [] });
      }
    }
  }

  // Build display like "Staff/Noun · Pick/Noun"
  const display = tagged
    .map((w) => {
      const mainTag = simplifyTag(w.tags);
      return `${w.text}/${mainTag}`;
    })
    .join(" · ");

  return { tagged, display };
}

function simplifyTag(tags: string[]): string {
  // Return the most useful grammatical tag
  const priority = [
    "Verb",
    "Noun",
    "Adjective",
    "Adverb",
    "Pronoun",
    "Preposition",
    "Conjunction",
    "Determiner",
  ];
  for (const p of priority) {
    if (tags.includes(p)) return p;
  }
  return tags[0] ?? "Unknown";
}

// ── Key Suggestion ─────────────────────────────────────────────────

/**
 * Suggest an i18n key from file path + string content.
 *
 * Examples:
 *   src/components/RecommendationCard.tsx + "Staff Pick" → "recommendations.staffPick"
 *   src/app/add/page.tsx + "Add Recommendation" → "add.addRecommendation"
 *   src/components/Header.tsx + "Sign in" → "common.signIn"
 */
export function suggestKey(filePath: string, text: string): string {
  const namespace = inferNamespace(filePath);
  const keyPart = textToKey(text);
  return `${namespace}.${keyPart}`;
}

function inferNamespace(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");

  // src/app/admin/* → admin
  const appMatch = normalized.match(/src\/app\/([^/]+)/);
  if (
    appMatch?.[1] &&
    appMatch[1] !== "(public)" &&
    appMatch[1] !== "(authenticated)"
  ) {
    return appMatch[1];
  }

  // src/components/RecommendationCard.tsx → recommendations
  const compMatch = normalized.match(/src\/components\/(\w+)/);
  if (compMatch?.[1]) {
    const name = compMatch[1].replace(
      /Card|List|Form|Modal|Dialog|Section|Page/g,
      ""
    );
    if (name.length > 2) {
      // Pluralize/lowercase
      const lower = name.charAt(0).toLowerCase() + name.slice(1);
      return lower.endsWith("s") ? lower : lower + "s";
    }
  }

  return "common";
}

function textToKey(text: string): string {
  // Take first 3 meaningful words, camelCase them
  const words = text
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);

  if (words.length === 0) return "untitled";

  return words
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join("");
}
