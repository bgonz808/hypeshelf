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

/**
 * Reset the cached availability state (useful for testing).
 */
export function resetValidatorCache(): void {
  cachedAvailable = null;
}
