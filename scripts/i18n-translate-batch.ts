#!/usr/bin/env npx tsx
/**
 * Headless batch translation script — Phase 5 deliverable.
 *
 * Translates missing i18n keys using a muxed signal approach:
 *   1. Dictionary (curated polysemous terms)
 *   2. Local NLLB-600M via Docker (localhost:8000)
 *   3. MyMemory cloud API (50K chars/day free)
 *   4. LM Studio validation (localhost:1234, optional)
 *
 * Newcomers without Docker/GPU get: Dictionary + MyMemory (still functional).
 *
 * Usage:
 *   npx tsx scripts/i18n-translate-batch.ts --locale=es
 *   npx tsx scripts/i18n-translate-batch.ts --locale=es --dry-run
 *   npx tsx scripts/i18n-translate-batch.ts --locale=es --force
 *   npx tsx scripts/i18n-translate-batch.ts  # all non-en locales
 *
 * See ADR-004 Phase 5
 */

import * as fs from "fs";
import * as path from "path";
import {
  MessageFileManager,
  utcDate,
  type ProvenanceEntry,
} from "./lib/message-manager.js";
import {
  TranslationStrategy,
  type EnhancedTranslationResult,
} from "./lib/translation-strategy.js";
import { probeAllServices } from "./lib/port-checker.js";

// ── CLI Args ────────────────────────────────────────────────────────

interface CliOptions {
  locale?: string;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = { dryRun: false, force: false };

  for (const arg of args) {
    if (arg.startsWith("--locale=")) {
      opts.locale = arg.slice("--locale=".length);
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--force") {
      opts.force = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: npx tsx scripts/i18n-translate-batch.ts [options]",
          "",
          "Options:",
          "  --locale=XX   Translate only this locale (es, zh, ar, yi)",
          "  --dry-run     Show what would be translated without writing",
          "  --force       Retranslate existing keys (normally skipped)",
          "  --help        Show this help",
        ].join("\n")
      );
      process.exit(0);
    }
  }

  return opts;
}

// ── Key extraction ──────────────────────────────────────────────────

type NestedRecord = { [key: string]: string | NestedRecord };

/** Flatten nested JSON to dot-path keys */
function flattenKeys(
  obj: NestedRecord,
  prefix = ""
): Array<{ key: string; value: string }> {
  const result: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      result.push({ key: fullKey, value: v });
    } else if (typeof v === "object" && v !== null) {
      result.push(...flattenKeys(v as NestedRecord, fullKey));
    }
  }
  return result;
}

// ── Rate limiting ───────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ────────────────────────────────────────────────────────────

const LOCALES = ["es", "zh", "ar", "yi"];
const MESSAGES_DIR = path.resolve(__dirname, "..", "messages");
const RATE_LIMIT_MS = 500; // delay between API calls

async function main(): Promise<void> {
  const opts = parseArgs();

  // ── Probe services ──────────────────────────────────────────────
  console.log("Probing translation services...\n");
  const services = await probeAllServices();

  console.log("┌─────────────────────────┬───────────┐");
  console.log("│ Service                 │ Status    │");
  console.log("├─────────────────────────┼───────────┤");
  console.log(`│ Dictionary (built-in)   │ ${pad("available", 9)} │`);
  console.log(
    `│ NLLB (localhost:8000)   │ ${pad(services.nllb ? "available" : "offline", 9)} │`
  );
  console.log(`│ MyMemory (cloud)        │ ${pad("available", 9)} │`);
  console.log(
    `│ LM Studio (:1234)       │ ${pad(services.lmStudio ? "available" : "offline", 9)} │`
  );
  console.log("└─────────────────────────┴───────────┘\n");

  if (opts.dryRun) {
    console.log("[DRY RUN] No files will be modified.\n");
  }

  // ── Load en.json as source of truth ─────────────────────────────
  const enPath = path.join(MESSAGES_DIR, "en.json");
  const enData = JSON.parse(fs.readFileSync(enPath, "utf-8")) as NestedRecord;
  const enKeys = flattenKeys(enData).filter(
    ({ key }) => !key.startsWith("_meta")
  );

  const targetLocales = opts.locale ? [opts.locale] : LOCALES;
  const manager = new MessageFileManager();
  const strategy = new TranslationStrategy();

  let totalTranslated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const locale of targetLocales) {
    console.log(`\n═══ ${locale.toUpperCase()} ═══\n`);

    // Find missing keys
    const missingKeys = enKeys.filter(({ key }) => {
      if (opts.force) return true;
      return !manager.hasKey(locale, key);
    });

    if (missingKeys.length === 0) {
      console.log(`  No missing keys for ${locale}.`);
      totalSkipped += enKeys.length;
      continue;
    }

    console.log(
      `  ${missingKeys.length} keys to translate (${enKeys.length - missingKeys.length} existing)\n`
    );

    const results: Array<{
      key: string;
      enValue: string;
      result?: EnhancedTranslationResult;
      error?: string;
    }> = [];

    for (const { key, value: enValue } of missingKeys) {
      try {
        const result = await strategy.translateKey(key, enValue, locale);
        results.push({ key, enValue, result });

        if (!opts.dryRun) {
          manager.setMessage(locale, key, result.translation);

          const provenance: ProvenanceEntry = {
            method:
              result.confidence >= 0.85 ? "machine" : "machine-needs-review",
            engine: result.provider,
            source: "en",
            date: utcDate(),
            confidence: result.confidence,
            translationMethod: result.method,
            report: result.report,
          };
          manager.setProvenance(locale, key, provenance, result.translation);
        }

        // Print per-key result
        const conf = `${Math.round(result.confidence * 100)}%`;
        const methodTag = result.method.padEnd(10);
        console.log(
          `  ✓ ${key.padEnd(30)} ${methodTag} ${conf.padStart(4)}  "${result.translation}"`
        );

        totalTranslated++;

        // Rate limit for cloud API calls
        if (result.provider === "mymemory") {
          await delay(RATE_LIMIT_MS);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ ${key.padEnd(30)} FAILED: ${msg}`);
        results.push({ key, enValue, error: msg });
        totalFailed++;
      }
    }

    // Print locale summary with audit trail
    if (results.length > 0) {
      console.log(`\n  ── ${locale} Audit Trail ──`);
      for (const { key, result } of results) {
        if (result) {
          for (const line of result.report) {
            console.log(`    ${key}: ${line}`);
          }
        }
      }
    }
  }

  // ── Flush ───────────────────────────────────────────────────────
  if (!opts.dryRun && totalTranslated > 0) {
    const { written } = manager.flush();
    console.log(`\n  Wrote ${written.length} file(s):`);
    for (const f of written) {
      console.log(`    ${path.relative(process.cwd(), f)}`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────
  console.log("\n════════════════════════════════");
  console.log(`  Translated: ${totalTranslated}`);
  console.log(`  Skipped:    ${totalSkipped}`);
  console.log(`  Failed:     ${totalFailed}`);
  console.log("════════════════════════════════\n");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

function pad(s: string, len: number): string {
  return s.padEnd(len);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
