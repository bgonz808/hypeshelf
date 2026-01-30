/**
 * Translation strategy orchestrator — muxes dictionary, local MT,
 * cloud MT, and optional LM Studio validation into a single
 * translateKey() call with confidence scoring and audit trail.
 *
 * Does NOT modify createProviderChain() — existing i18n-extract.ts
 * continues to work unchanged.
 *
 * See ADR-004 Phase 5
 */

import { DictionaryProvider } from "./dictionary-provider.js";
import { LocalModelProvider } from "./local-model-provider.js";
import {
  MyMemoryProvider,
  QuotaManager,
  computeSimilarity,
} from "./translation-providers.js";
import {
  validateTranslation,
  disambiguateTranslation,
  type ValidationResult,
  type DisambiguationCandidate,
} from "./lm-studio-validator.js";
import { probeAllServices } from "./port-checker.js";

// ── Context Stuffing ────────────────────────────────────────────────

/** Namespace → short hint for bracket-stuffing polysemous short strings */
const NAMESPACE_HINTS: Record<string, string> = {
  genres: "music genre",
  filters: "UI filter",
  common: "UI label",
  auth: "authentication",
  admin: "admin action",
  recommendations: "recommendation",
  home: "homepage",
  metadata: "page metadata",
};

/**
 * Wrap a short string with a bracket hint derived from its i18n key namespace.
 * e.g. "Rock" with key "genres.rock" → "Rock [music genre]"
 */
function bracketStuff(text: string, key: string): string {
  const namespace = key.split(".")[0] ?? "";
  const hint = NAMESPACE_HINTS[namespace];
  if (!hint) return text;
  return `${text} [${hint}]`;
}

/**
 * Strip bracket hints and locale-specific bracket variants from MT output.
 * Handles: [...], （...）, 「...」, «...», „...", ‹...›, ‚...'
 */
const BRACKET_STRIP_RE = /\s*[\[（(「『«„‹‚].*?[\]）)」』»"›']?\s*$/;

/**
 * Strip the context hint from an MT result.
 *
 * Strategy:
 *   1. Try regex bracket strip (works when MT preserved brackets)
 *   2. If no brackets found and the original was short (≤2 words),
 *      use Intl.Segmenter to extract the leading content words,
 *      trimming the hint that got absorbed into the translation.
 *      Compares word count: original has N words, so take first N
 *      segments from the MT output.
 */
function stripBracketHint(
  text: string,
  originalWordCount: number,
  locale: string
): string {
  // Step 1: Try bracket regex
  const bracketStripped = text.replace(BRACKET_STRIP_RE, "").trim();
  if (bracketStripped !== text.trim() && bracketStripped.length > 0) {
    return bracketStripped;
  }

  // Step 2: Segmenter-based extraction for CJK and other locales
  // where brackets were absorbed into the translation
  if (originalWordCount <= 2) {
    try {
      const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
      const segments = Array.from(segmenter.segment(text))
        .filter((s) => s.isWordLike)
        .map((s) => s.segment);

      // If MT produced more word-segments than the original had words,
      // the extra segments are likely the absorbed hint
      if (segments.length > originalWordCount && originalWordCount > 0) {
        return segments.slice(0, originalWordCount).join("");
      }
    } catch {
      // Intl.Segmenter not available or locale not supported — return as-is
    }
  }

  return text.trim();
}

// ── Types ───────────────────────────────────────────────────────────

export interface EnhancedTranslationResult {
  translation: string;
  method: "dictionary" | "mt-local" | "mt-cloud" | "ensemble";
  confidence: number; // 0..1 composite
  provider: string;
  backTranslation?: string;
  similarity?: number;
  dictionarySenses?: Array<{ pos: string; gloss: string; domain: string }>;
  validationScore?: number; // 0..1 from LM Studio, or undefined
  report: string[]; // human-readable audit trail
}

interface ServiceAvailability {
  nllb: boolean;
  lmStudio: boolean;
}

// ── Strategy ────────────────────────────────────────────────────────

export class TranslationStrategy {
  private dictionary: DictionaryProvider;
  private localModel: LocalModelProvider;
  private cloudProvider: MyMemoryProvider;
  private quota: QuotaManager;
  private services: ServiceAvailability | null = null;

  constructor() {
    this.quota = new QuotaManager();
    this.dictionary = new DictionaryProvider();
    this.localModel = new LocalModelProvider();
    this.cloudProvider = new MyMemoryProvider(this.quota);
  }

  /** Probe services once, cache for session */
  async getServiceAvailability(): Promise<ServiceAvailability> {
    if (!this.services) {
      this.services = await probeAllServices();
    }
    return this.services;
  }

  /**
   * Translate a single i18n key using the best available strategy.
   *
   * Priority chain:
   * 1. Dictionary (short polysemous words)
   * 2. Local NLLB (if Docker running)
   * 3. MyMemory cloud (fallback)
   * 4. LM Studio validation (optional scoring pass)
   */
  async translateKey(
    key: string,
    enValue: string,
    locale: string
  ): Promise<EnhancedTranslationResult> {
    const report: string[] = [];
    const wordCount = enValue.trim().split(/\s+/).length;
    const services = await this.getServiceAvailability();

    let translation: string | undefined;
    let method: EnhancedTranslationResult["method"] = "mt-cloud";
    let provider = "";
    let confidence = 0;
    let backTranslation: string | undefined;
    let similarity: number | undefined;
    let dictionarySenses: EnhancedTranslationResult["dictionarySenses"];

    // ── Step 1: Gather candidates from dictionary + MT ────────────
    let dictTranslation: string | undefined;

    if (wordCount <= 2 && this.dictionary.has(enValue)) {
      const senses = this.dictionary.getSenses(enValue);
      dictionarySenses = senses;
      report.push(`Dictionary: ${senses?.length ?? 0} senses found`);

      try {
        dictTranslation = await this.dictionary.translate(
          enValue,
          "en",
          locale,
          { key }
        );
        report.push(
          `Dictionary hit: "${dictTranslation}" (domain from key "${key}")`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.push(`Dictionary miss: ${msg}`);
      }
    }

    // ── Step 2: Local NLLB (if available) ─────────────────────────
    let mtTranslation: string | undefined;
    let mtProvider = "";

    if (services.nllb) {
      try {
        // Context-stuff short strings so NLLB can disambiguate
        const needsHint =
          wordCount <= 2 && dictionarySenses && dictionarySenses.length > 1;
        const mtInput = needsHint ? bracketStuff(enValue, key) : enValue;
        if (needsHint) {
          report.push(`Context-stuffed for NLLB: "${mtInput}"`);
        }

        let raw = await this.localModel.translate(mtInput, "en", locale);

        // Strip bracket hint remnants from the translation
        if (needsHint) {
          const stripped = stripBracketHint(raw, wordCount, locale);
          if (stripped && stripped !== raw) {
            report.push(`Stripped hint: "${raw}" → "${stripped}"`);
            raw = stripped;
          }
        }

        mtTranslation = raw;
        mtProvider = "nllb-local";
        report.push(`NLLB local: "${mtTranslation}"`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.push(`NLLB unavailable: ${msg}`);
      }
    }

    // ── Step 2b: LLM disambiguation (when we have dictionary senses + MT) ─
    if (
      dictionarySenses &&
      dictionarySenses.length > 0 &&
      dictTranslation &&
      mtTranslation &&
      dictTranslation !== mtTranslation &&
      services.lmStudio
    ) {
      // Build candidates: dictionary pick + MT result
      const candidates: DisambiguationCandidate[] = [
        {
          translation: dictTranslation,
          source: `dictionary (${key.split(".")[0]} domain)`,
        },
        { translation: mtTranslation, source: mtProvider },
      ];

      report.push("LLM disambiguation: dictionary vs MT disagree");

      const result = await disambiguateTranslation(
        enValue,
        locale,
        key,
        dictionarySenses,
        candidates
      );

      if (result.available && result.winnerIndex >= 0) {
        const winner = candidates[result.winnerIndex]!;
        translation = winner.translation;
        method = "ensemble";
        provider = `ensemble(${winner.source})`;
        confidence = 0.92; // LLM-judged disambiguation
        report.push(
          `LLM picked "${winner.translation}" (${winner.source}): ${result.reasoning}`
        );
      } else {
        // LLM unavailable or unparseable — fall back to dictionary (curated > MT)
        report.push(
          result.available
            ? `LLM disambiguation failed: ${result.reasoning} — using dictionary`
            : "LLM became unavailable — using dictionary"
        );
        translation = dictTranslation;
        method = "dictionary";
        provider = "dictionary";
        confidence = 0.95;
      }
    } else if (dictTranslation) {
      // No MT disagreement or no LLM — dictionary wins
      translation = dictTranslation;
      method = "dictionary";
      provider = "dictionary";
      confidence = 0.95;
      if (mtTranslation && mtTranslation === dictTranslation) {
        confidence = 0.97;
        report.push("NLLB agrees with dictionary → high confidence");
      }
    } else if (mtTranslation) {
      // No dictionary entry — MT is the only candidate
      translation = mtTranslation;
      method = "mt-local";
      provider = mtProvider;
      confidence = 0.7;
    }

    // ── Step 3: MyMemory cloud (fallback) ─────────────────────────
    if (!translation) {
      if (!this.cloudProvider.supportsLocale(locale)) {
        throw new Error(`No provider supports locale "${locale}"`);
      }

      try {
        // Context-stuff short polysemous strings for cloud MT too
        const needsHint =
          wordCount <= 2 && dictionarySenses && dictionarySenses.length > 1;
        const cloudInput = needsHint ? bracketStuff(enValue, key) : enValue;
        if (needsHint) {
          report.push(`Context-stuffed for MyMemory: "${cloudInput}"`);
        }

        let raw = await this.cloudProvider.translate(cloudInput, "en", locale);

        if (needsHint) {
          const stripped = stripBracketHint(raw, wordCount, locale);
          if (stripped && stripped !== raw) {
            report.push(`Stripped hint: "${raw}" → "${stripped}"`);
            raw = stripped;
          }
        }

        translation = raw;
        method = "mt-cloud";
        provider = "mymemory";
        confidence = 0.6;
        report.push(`MyMemory cloud: "${translation}"`);

        // Back-translate for sanity check (only for strings ≥ 3 words)
        if (wordCount >= 3) {
          try {
            backTranslation = await this.cloudProvider.translate(
              translation,
              locale,
              "en"
            );
            similarity = computeSimilarity(enValue, backTranslation);
            report.push(
              `Back-translation: "${backTranslation}" (similarity: ${similarity.toFixed(2)})`
            );

            // Adjust confidence based on back-translation quality
            if (similarity >= 0.6) {
              confidence = Math.min(confidence + 0.15, 0.85);
              report.push("Good back-translation → confidence boost");
            } else if (similarity < 0.3) {
              confidence = Math.max(confidence - 0.1, 0.3);
              report.push("Poor back-translation → confidence penalty");
            }
          } catch {
            report.push("Back-translation failed (non-fatal)");
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.push(`MyMemory failed: ${msg}`);
        throw new Error(
          `All translation providers failed for "${enValue}" (en → ${locale}): ${msg}`
        );
      }
    }

    // ── Step 4: LM Studio validation (optional) ───────────────────
    let validationScore: number | undefined;
    if (services.lmStudio && translation) {
      const namespace = key.split(".")[0] ?? "";
      const context = `${namespace} UI label`;
      const result: ValidationResult = await validateTranslation(
        enValue,
        translation,
        locale,
        context
      );

      if (result.available && result.score >= 0) {
        validationScore = result.score;
        report.push(
          `LM Studio validation: ${result.score.toFixed(2)}${result.feedback ? ` — "${result.feedback}"` : ""}`
        );

        // Adjust confidence based on LM validation
        if (result.score >= 0.8) {
          confidence = Math.min(confidence + 0.1, 1.0);
        } else if (result.score < 0.5) {
          confidence = Math.max(confidence - 0.15, 0.2);
          report.push("Low LM Studio score → confidence penalty");
        }
      } else if (!result.available) {
        report.push("LM Studio became unavailable");
      }
    }

    return {
      translation: translation!,
      method,
      confidence: Math.round(confidence * 100) / 100, // 2 decimal places
      provider,
      backTranslation,
      similarity,
      dictionarySenses,
      validationScore,
      report,
    };
  }
}
