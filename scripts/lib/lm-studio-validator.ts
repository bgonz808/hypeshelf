/**
 * LM Studio translation validator (optional post-processing pass).
 *
 * NOT a TranslationProvider — this is a quality gate that scores
 * translations produced by other providers. Uses the OpenAI-compatible
 * chat completions endpoint at localhost:1234.
 *
 * Returns {score: -1, available: false} when LM Studio is not running,
 * so callers can skip validation gracefully.
 *
 * See ADR-004 Phase 5
 */

import { probeLmStudio } from "./port-checker.js";

// ── Types ───────────────────────────────────────────────────────────

export interface ValidationResult {
  /** 0..1 normalized score, or -1 if unavailable */
  score: number;
  /** Human-readable issue description, empty if no issue */
  feedback: string;
  /** Whether LM Studio was reachable */
  available: boolean;
}

// ── Constants ───────────────────────────────────────────────────────

const LM_STUDIO_URL = "http://127.0.0.1:1234/v1/chat/completions";

const LOCALE_NAMES: Record<string, string> = {
  es: "Spanish",
  zh: "Simplified Chinese",
  ar: "Arabic",
  yi: "Yiddish",
};

// ── Validator ───────────────────────────────────────────────────────

let cachedAvailable: boolean | null = null;

/**
 * Score a translation using LM Studio's local LLM.
 *
 * @param original  - Source English text
 * @param translation - Translated text to validate
 * @param locale    - Target locale code (es, zh, ar, yi)
 * @param context   - Optional context hint (e.g., "music genre label")
 */
export async function validateTranslation(
  original: string,
  translation: string,
  locale: string,
  context?: string
): Promise<ValidationResult> {
  // Lazy probe, cached for session
  if (cachedAvailable === null) {
    cachedAvailable = await probeLmStudio();
  }
  if (!cachedAvailable) {
    return { score: -1, feedback: "", available: false };
  }

  const localeName = LOCALE_NAMES[locale] ?? locale;
  const contextClause = context ? ` Context: ${context}.` : "";

  const prompt = [
    `Rate this translation from English to ${localeName} on a scale of 1-10 for accuracy and naturalness.${contextClause}`,
    "",
    `English: "${original}"`,
    `${localeName}: "${translation}"`,
    "",
    'Reply with ONLY a JSON object: {"score": <1-10>, "issue": "<brief issue or empty string>"}',
  ].join("\n");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(LM_STUDIO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 100,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      return {
        score: -1,
        feedback: `LM Studio HTTP ${res.status}`,
        available: true,
      };
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = json.choices?.[0]?.message?.content ?? "";
    return parseValidationResponse(content);
  } catch {
    // LM Studio became unavailable mid-session
    cachedAvailable = false;
    return { score: -1, feedback: "", available: false };
  }
}

/**
 * Parse the LLM's JSON response, normalize score to 0..1.
 */
function parseValidationResponse(content: string): ValidationResult {
  try {
    // Extract JSON from response (LLM may wrap in markdown code block)
    const jsonMatch = content.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      return {
        score: -1,
        feedback: "Could not parse LLM response",
        available: true,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      score?: number;
      issue?: string;
    };

    const rawScore = parsed.score;
    if (typeof rawScore !== "number" || rawScore < 1 || rawScore > 10) {
      return { score: -1, feedback: "Invalid score from LLM", available: true };
    }

    return {
      score: rawScore / 10, // normalize to 0..1
      feedback: parsed.issue ?? "",
      available: true,
    };
  } catch {
    return { score: -1, feedback: "JSON parse error", available: true };
  }
}

// ── Disambiguation ──────────────────────────────────────────────────

export interface DisambiguationCandidate {
  translation: string;
  source: string; // e.g. "dictionary (music)", "NLLB", "MyMemory"
}

export interface DisambiguationResult {
  /** Index of the winning candidate (0-based), or -1 if unavailable */
  winnerIndex: number;
  /** LLM's reasoning */
  reasoning: string;
  available: boolean;
}

/**
 * Ask the LLM to rank translation candidates for a polysemous term.
 *
 * Feeds the LLM:
 *   - The original English token and its i18n key (for domain context)
 *   - Dictionary senses (all known meanings)
 *   - Candidate translations from different providers
 *   - An MT attempt with context stuffing (if available)
 *
 * The LLM acts as a disambiguation judge, not a translator.
 */
export async function disambiguateTranslation(
  original: string,
  locale: string,
  key: string,
  senses: Array<{ pos: string; gloss: string; domain: string }>,
  candidates: DisambiguationCandidate[]
): Promise<DisambiguationResult> {
  if (cachedAvailable === null) {
    cachedAvailable = await probeLmStudio();
  }
  if (!cachedAvailable) {
    return { winnerIndex: -1, reasoning: "", available: false };
  }

  const localeName = LOCALE_NAMES[locale] ?? locale;
  const namespace = key.split(".")[0] ?? "";

  const sensesBlock = senses
    .map((s, i) => `  ${i + 1}. [${s.domain}] ${s.pos}: ${s.gloss}`)
    .join("\n");

  const candidatesBlock = candidates
    .map(
      (c, i) =>
        `  ${String.fromCharCode(65 + i)}. "${c.translation}" (from: ${c.source})`
    )
    .join("\n");

  const prompt = [
    `You are a translation quality judge. A UI application needs to translate the English token "${original}" into ${localeName}.`,
    ``,
    `i18n key: "${key}" (namespace: "${namespace}")`,
    ``,
    `This word is polysemous. Known senses:`,
    sensesBlock,
    ``,
    `Candidate translations:`,
    candidatesBlock,
    ``,
    `Given that this is a "${namespace}" label in a UI context, which candidate (A, B, C...) is the best translation?`,
    ``,
    `Reply with ONLY a JSON object: {"winner": "<letter>", "reasoning": "<one sentence>"}`,
  ].join("\n");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(LM_STUDIO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 150,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      return {
        winnerIndex: -1,
        reasoning: `HTTP ${res.status}`,
        available: true,
      };
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = json.choices?.[0]?.message?.content ?? "";
    return parseDisambiguationResponse(content, candidates.length);
  } catch {
    cachedAvailable = false;
    return { winnerIndex: -1, reasoning: "", available: false };
  }
}

function parseDisambiguationResponse(
  content: string,
  candidateCount: number
): DisambiguationResult {
  try {
    const jsonMatch = content.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      return {
        winnerIndex: -1,
        reasoning: "Could not parse LLM response",
        available: true,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      winner?: string;
      reasoning?: string;
    };

    const letter = (parsed.winner ?? "").trim().toUpperCase();
    const index = letter.charCodeAt(0) - 65; // A=0, B=1, C=2
    if (isNaN(index) || index < 0 || index >= candidateCount) {
      return {
        winnerIndex: -1,
        reasoning: parsed.reasoning ?? "Invalid winner",
        available: true,
      };
    }

    return {
      winnerIndex: index,
      reasoning: parsed.reasoning ?? "",
      available: true,
    };
  } catch {
    return { winnerIndex: -1, reasoning: "JSON parse error", available: true };
  }
}

/**
 * Reset the cached availability state (useful for testing).
 */
export function resetValidatorCache(): void {
  cachedAvailable = null;
}
