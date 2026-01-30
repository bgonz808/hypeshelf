/**
 * Local NLLB/Opus-MT translation provider via Docker container.
 *
 * Expects a FastAPI server on localhost:8000 with:
 *   POST /translate  { text, source_lang, target_lang }
 *   GET  /health     { status: "ok" }
 *
 * Lazy port probe on first use — cached for the session.
 * Graceful: throws on unavailable so the provider chain falls through.
 *
 * See ADR-004 Phase 5, docker/docker-compose.i18n.yml
 */

import type { TranslationProvider } from "./translation-providers.js";
import { probeNllb } from "./port-checker.js";

// ── NLLB BCP-47 → Flores-200 code mapping ──────────────────────────

const NLLB_LOCALE_MAP: Record<string, string> = {
  en: "eng_Latn",
  es: "spa_Latn",
  zh: "zho_Hans",
  ar: "arb_Arab",
  // Yiddish: NLLB uses Hebrew script code; closest available model code
  yi: "heb_Hebr",
};

const SUPPORTED_LOCALES = new Set(Object.keys(NLLB_LOCALE_MAP));

// ── Provider Implementation ─────────────────────────────────────────

const NLLB_BASE = "http://127.0.0.1:8000";

export class LocalModelProvider implements TranslationProvider {
  name = "nllb-local";

  private available: boolean | null = null; // null = not yet probed

  supportsLocale(locale: string): boolean {
    return SUPPORTED_LOCALES.has(locale);
  }

  getRemainingQuota(): number {
    return Infinity; // local model, no quota
  }

  /**
   * Probe availability on first call, cache result for session.
   */
  private async ensureAvailable(): Promise<void> {
    if (this.available === null) {
      this.available = await probeNllb();
    }
    if (!this.available) {
      throw new Error(
        "NLLB local model not available (localhost:8000 not responding)"
      );
    }
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    await this.ensureAvailable();

    const sourceLang = NLLB_LOCALE_MAP[from];
    const targetLang = NLLB_LOCALE_MAP[to];
    if (!sourceLang || !targetLang) {
      throw new Error(`NLLB: unsupported locale pair ${from} → ${to}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000); // 30s for model inference

    try {
      const res = await fetch(`${NLLB_BASE}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          source_lang: sourceLang,
          target_lang: targetLang,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`NLLB HTTP ${res.status}: ${await res.text()}`);
      }

      const json = (await res.json()) as { translation?: string };
      if (!json.translation) {
        throw new Error("NLLB returned empty translation");
      }

      return json.translation;
    } finally {
      clearTimeout(timer);
    }
  }
}
