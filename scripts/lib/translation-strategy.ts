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
  type ValidationResult,
} from "./lm-studio-validator.js";
import { probeAllServices } from "./port-checker.js";

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

    // ── Step 1: Dictionary (short words, ≤ 2 tokens) ──────────────
    if (wordCount <= 2 && this.dictionary.has(enValue)) {
      const senses = this.dictionary.getSenses(enValue);
      dictionarySenses = senses;
      report.push(`Dictionary: ${senses?.length ?? 0} senses found`);

      try {
        translation = await this.dictionary.translate(enValue, "en", locale, {
          key,
        });
        method = "dictionary";
        provider = "dictionary";
        confidence = 0.95; // curated = high confidence
        report.push(
          `Dictionary hit: "${translation}" (domain from key "${key}")`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.push(`Dictionary miss: ${msg}`);
      }
    }

    // ── Step 2: Local NLLB (if available and no dictionary hit) ────
    if (!translation && services.nllb) {
      try {
        translation = await this.localModel.translate(enValue, "en", locale);
        method = "mt-local";
        provider = "nllb-local";
        confidence = 0.7;
        report.push(`NLLB local: "${translation}"`);

        // Cross-check with dictionary if the word is known
        if (dictionarySenses && dictionarySenses.length > 0) {
          try {
            const dictTranslation = await this.dictionary.translate(
              enValue,
              "en",
              locale,
              { key }
            );
            if (dictTranslation === translation) {
              confidence = 0.9; // local MT agrees with dictionary
              report.push("NLLB agrees with dictionary → confidence boost");
            } else {
              report.push(
                `NLLB differs from dictionary ("${dictTranslation}") — using NLLB`
              );
            }
          } catch {
            // Dictionary didn't have a match for this domain, that's fine
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.push(`NLLB unavailable: ${msg}`);
      }
    }

    // ── Step 3: MyMemory cloud (fallback) ─────────────────────────
    if (!translation) {
      if (!this.cloudProvider.supportsLocale(locale)) {
        throw new Error(`No provider supports locale "${locale}"`);
      }

      try {
        translation = await this.cloudProvider.translate(enValue, "en", locale);
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
