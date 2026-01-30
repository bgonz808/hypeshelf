/**
 * Local NLLB/Opus-MT translation provider via Docker container.
 *
 * Expects a FastAPI server on localhost:8000 (HTTPS, self-signed) with:
 *   POST /translate  { text, source_lang, target_lang }  (HMAC auth required)
 *   GET  /health     { status: "ok" }                    (no auth)
 *
 * Lazy port probe on first use — cached for the session.
 * Graceful: throws on unavailable so the provider chain falls through.
 *
 * See ADR-004 Phase 5, docker/docker-compose.i18n.yml
 */

import * as crypto from "node:crypto";
import * as https from "node:https";
import type {
  TranslationProvider,
  TranslationMetrics,
} from "./translation-providers.js";
import { probeNllb, getNllbApiKey } from "./port-checker.js";

// ── NLLB BCP-47 → Flores-200 code mapping ──────────────────────────

const NLLB_LOCALE_MAP: Record<string, string> = {
  en: "eng_Latn",
  es: "spa_Latn",
  zh: "zho_Hans",
  ar: "arb_Arab",
  // Yiddish: NLLB natively supports Eastern Yiddish (ydd_Hebr), not Hebrew
  yi: "ydd_Hebr",
};

const SUPPORTED_LOCALES = new Set(Object.keys(NLLB_LOCALE_MAP));

// ── HTTPS agent (scoped, self-signed OK) ────────────────────────────

const nllbAgent = new https.Agent({ rejectUnauthorized: false });

// ── HMAC auth header generation ─────────────────────────────────────

function makeHmacAuthHeader(secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(timestamp)
    .digest("hex");
  return `Bearer HMAC-SHA256:${timestamp}:${signature}`;
}

// ── Provider Implementation ─────────────────────────────────────────

function getNllbBase(): string {
  const host = process.env["NLLB_HOST"] ?? "127.0.0.1";
  return `https://${host}:8000`;
}

export class LocalModelProvider implements TranslationProvider {
  name = "nllb-local";

  private available: boolean | null = null; // null = not yet probed
  private _lastMetrics: TranslationMetrics | null = null;

  /** Metrics from the most recent translate() call (side-channel). */
  get lastMetrics(): TranslationMetrics | null {
    return this._lastMetrics;
  }

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
      const host = process.env["NLLB_HOST"] ?? "127.0.0.1";
      this.available = await probeNllb(host);
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

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const apiKey = getNllbApiKey();
    if (apiKey) {
      headers["Authorization"] = makeHmacAuthHeader(apiKey);
    }

    const body = JSON.stringify({
      text,
      source_lang: sourceLang,
      target_lang: targetLang,
    });

    // Use node:https for self-signed cert support (scoped agent)
    this._lastMetrics = null;
    const result = await new Promise<string>((resolve, reject) => {
      const url = new URL(`${getNllbBase()}/translate`);
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          headers,
          agent: nllbAgent,
          timeout: 30_000,
        },
        (res) => {
          let data = "";
          res.setEncoding("utf-8");
          res.on("data", (chunk: string) => {
            data += chunk;
          });
          res.on("end", () => {
            if (
              !res.statusCode ||
              res.statusCode < 200 ||
              res.statusCode >= 300
            ) {
              reject(new Error(`NLLB HTTP ${res.statusCode}: ${data}`));
              return;
            }
            try {
              const json = JSON.parse(data) as {
                translation?: string;
                metrics?: TranslationMetrics;
              };
              if (!json.translation) {
                reject(new Error("NLLB returned empty translation"));
                return;
              }
              if (json.metrics) {
                this._lastMetrics = json.metrics;
              }
              resolve(json.translation);
            } catch {
              reject(new Error(`NLLB invalid JSON: ${data}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("NLLB request timed out (30s)"));
      });
      req.write(body);
      req.end();
    });

    return result;
  }
}
