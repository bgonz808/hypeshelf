/**
 * Multi-provider translation abstraction with back-translation sanity checking.
 *
 * Providers:
 *   1. MyMemory (primary) — 50K chars/day with email, Yiddish via Hebrew approximation
 *   2. LibreTranslate (fallback) — public instance, no Yiddish
 *
 * See ADR-004 §13 (Machine Translation Workflow)
 */

import * as fs from "fs";
import * as path from "path";
import { utcDate } from "./message-manager.js";

// ── Types ──────────────────────────────────────────────────────────

export interface TranslationResult {
  translation: string;
  backTranslation: string;
  similarity: number;
  provider: string;
  alternatives?: string[];
}

export interface TranslationProvider {
  name: string;
  translate(text: string, from: string, to: string): Promise<string>;
  supportsLocale(locale: string): boolean;
  getRemainingQuota(): number;
}

// ── Similarity ─────────────────────────────────────────────────────

/**
 * Jaccard bag-of-words overlap (normalized lowercase).
 * Returns 0..1 where 1 = identical word sets.
 */
export function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

// ── Quota Manager ──────────────────────────────────────────────────

const USAGE_FILE = path.resolve(__dirname, "..", "..", ".i18n-usage.json");

interface UsageRecord {
  date: string;
  chars: number;
}

interface UsageData {
  [provider: string]: UsageRecord;
}

export class QuotaManager {
  private data: UsageData;

  constructor() {
    this.data = this.load();
  }

  private load(): UsageData {
    try {
      const raw = fs.readFileSync(USAGE_FILE, "utf-8");
      return JSON.parse(raw) as UsageData;
    } catch {
      return {};
    }
  }

  private save(): void {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(this.data, null, 2) + "\n");
  }

  private today(): string {
    return utcDate();
  }

  getUsed(provider: string): number {
    const rec = this.data[provider];
    if (!rec || rec.date !== this.today()) return 0;
    return rec.chars;
  }

  addUsage(provider: string, chars: number): void {
    const today = this.today();
    const rec = this.data[provider];
    if (!rec || rec.date !== today) {
      this.data[provider] = { date: today, chars };
    } else {
      rec.chars += chars;
    }
    this.save();
  }
}

// ── Locale mapping helpers ─────────────────────────────────────────

/** MyMemory language codes — Yiddish approximated via Hebrew */
const MYMEMORY_LOCALE_MAP: Record<string, string> = {
  en: "en",
  es: "es",
  zh: "zh-CN",
  ar: "ar",
  yi: "he", // Yiddish approximated via Hebrew
};

/** LibreTranslate supported locales (no Yiddish/Hebrew) */
const LIBRE_LOCALES = new Set(["en", "es", "zh", "ar"]);

// ── MyMemory Provider ──────────────────────────────────────────────

const MYMEMORY_DAILY_LIMIT = 50_000;

export class MyMemoryProvider implements TranslationProvider {
  name = "mymemory";
  private quota: QuotaManager;
  private email: string;

  constructor(quota: QuotaManager) {
    this.quota = quota;
    this.email = process.env.INITIAL_ADMIN_EMAIL ?? "";
  }

  supportsLocale(locale: string): boolean {
    return locale in MYMEMORY_LOCALE_MAP;
  }

  getRemainingQuota(): number {
    return MYMEMORY_DAILY_LIMIT - this.quota.getUsed(this.name);
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    if (this.getRemainingQuota() < text.length) {
      throw new Error("MyMemory daily quota exhausted");
    }

    const fromCode = MYMEMORY_LOCALE_MAP[from] ?? from;
    const toCode = MYMEMORY_LOCALE_MAP[to] ?? to;
    const langpair = `${fromCode}|${toCode}`;
    const params = new URLSearchParams({ q: text, langpair });
    if (this.email) params.set("de", this.email);

    const url = `https://api.mymemory.translated.net/get?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);

    const json = (await res.json()) as {
      responseData?: { translatedText?: string };
    };
    const translated = json.responseData?.translatedText;
    if (!translated) throw new Error("MyMemory returned empty translation");

    this.quota.addUsage(this.name, text.length);
    return translated;
  }
}

// ── LibreTranslate Provider ────────────────────────────────────────

const LIBRE_API = "https://libretranslate.com/translate";

export class LibreTranslateProvider implements TranslationProvider {
  name = "libretranslate";
  private quota: QuotaManager;

  constructor(quota: QuotaManager) {
    this.quota = quota;
  }

  supportsLocale(locale: string): boolean {
    return LIBRE_LOCALES.has(locale);
  }

  getRemainingQuota(): number {
    // Public instance has no hard char limit, but we track for awareness
    return Infinity;
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    const res = await fetch(LIBRE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: from === "zh" ? "zh" : from,
        target: to === "zh" ? "zh" : to,
      }),
    });
    if (!res.ok) throw new Error(`LibreTranslate HTTP ${res.status}`);

    const json = (await res.json()) as { translatedText?: string };
    if (!json.translatedText) {
      throw new Error("LibreTranslate returned empty translation");
    }

    this.quota.addUsage(this.name, text.length);
    return json.translatedText;
  }
}

// ── Provider Chain ─────────────────────────────────────────────────

export class ProviderChain {
  private providers: TranslationProvider[];

  constructor(providers: TranslationProvider[]) {
    this.providers = providers;
  }

  /**
   * Translate text and back-translate for sanity checking.
   * Tries providers in order, falls through on failure.
   */
  async translateWithVerification(
    text: string,
    from: string,
    to: string
  ): Promise<TranslationResult> {
    const errors: string[] = [];

    for (const provider of this.providers) {
      if (!provider.supportsLocale(to)) continue;
      if (provider.getRemainingQuota() < text.length) continue;

      try {
        const translation = await provider.translate(text, from, to);
        let backTranslation: string;
        try {
          backTranslation = await provider.translate(translation, to, from);
        } catch {
          // If back-translation fails, still return forward with 0 similarity
          backTranslation = "";
        }
        const similarity = backTranslation
          ? computeSimilarity(text, backTranslation)
          : 0;

        return {
          translation,
          backTranslation,
          similarity,
          provider: provider.name,
        };
      } catch (err) {
        errors.push(
          `${provider.name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    throw new Error(
      `All providers failed for "${text}" (${from}→${to}): ${errors.join("; ")}`
    );
  }
}

// ── Factory ────────────────────────────────────────────────────────

export function createProviderChain(): ProviderChain {
  const quota = new QuotaManager();
  return new ProviderChain([
    new MyMemoryProvider(quota),
    new LibreTranslateProvider(quota),
  ]);
}
