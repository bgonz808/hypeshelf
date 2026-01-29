#!/usr/bin/env npx tsx
/**
 * i18n Translation Audit Script
 *
 * Audits all non-English translations for plausibility and provenance.
 *
 * For every key in non-en locale files, checks:
 *   1. Provenance — does i18n-status.json have a record? Is it reviewed?
 *   2. Plausibility — back-translates to English via MyMemory, compares
 *      against en.json value using Jaccard similarity.
 *
 * Exit codes:
 *   0 = all translations vetted or plausible
 *   1 = unvetted translations found (CI fail mode)
 *   (use --warn-only to always exit 0)
 *
 * Usage:
 *   npx tsx scripts/i18n-audit-translations.ts
 *   npx tsx scripts/i18n-audit-translations.ts --warn-only
 *   npx tsx scripts/i18n-audit-translations.ts --check-plausibility
 *   npx tsx scripts/i18n-audit-translations.ts --locale=es
 *
 * See ADR-004 §7 (Provenance Tracking)
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  createProviderChain,
  computeSimilarity,
  type ProviderChain,
} from "./lib/translation-providers.js";

// ── Types ──────────────────────────────────────────────────────────

interface ProvenanceEntry {
  method: string;
  engine?: string;
  source?: string;
  date?: string;
  reviews?: Array<{ reviewer: string; date: string; verdict: string }>;
}

interface AuditResult {
  key: string;
  locale: string;
  localValue: string;
  enValue: string;
  provenance: "none" | "unreviewed" | "reviewed";
  similarity?: number;
  backTranslation?: string;
}

// ── CLI Args ───────────────────────────────────────────────────────

interface AuditOptions {
  warnOnly: boolean;
  checkPlausibility: boolean;
  locale?: string;
}

function parseArgs(): AuditOptions {
  const args = process.argv.slice(2);
  const opts: AuditOptions = { warnOnly: false, checkPlausibility: false };

  for (const arg of args) {
    if (arg === "--warn-only") opts.warnOnly = true;
    else if (arg === "--check-plausibility") opts.checkPlausibility = true;
    else if (arg.startsWith("--locale="))
      opts.locale = arg.slice("--locale=".length);
  }

  return opts;
}

// ── File loading ───────────────────────────────────────────────────

const MESSAGES_DIR = path.resolve(__dirname, "..", "messages");
const STATUS_FILE = path.resolve(__dirname, "..", "i18n-status.json");
const ALL_LOCALES = ["es", "zh", "ar", "yi"];

type NestedRecord = { [key: string]: string | NestedRecord };

function loadJson(filePath: string): NestedRecord {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as NestedRecord;
  } catch {
    return {};
  }
}

/** Flatten nested JSON to dot-path → string pairs, skipping _meta */
function flattenMessages(
  obj: NestedRecord,
  prefix: string = ""
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(obj)) {
    if (key === "_meta") continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      result.set(fullKey, value);
    } else if (typeof value === "object" && value !== null) {
      for (const [k, v] of flattenMessages(value as NestedRecord, fullKey)) {
        result.set(k, v);
      }
    }
  }
  return result;
}

// ── Plausibility Cache ─────────────────────────────────────────────

const CACHE_FILE = path.resolve(
  __dirname,
  "..",
  ".i18n-plausibility-cache.json"
);

interface CacheEntry {
  similarity: number;
  backTranslation: string;
  timestamp: string;
}

type PlausibilityCache = Record<string, CacheEntry>;

/**
 * Cache key = SHA-256 of (locale, key, localValue, enValue).
 * If any of those change, the cached result is stale.
 */
function cacheKey(
  locale: string,
  key: string,
  localValue: string,
  enValue: string
): string {
  return crypto
    .createHash("sha256")
    .update(`${locale}\0${key}\0${localValue}\0${enValue}`)
    .digest("hex")
    .slice(0, 16); // 16 hex chars = 64 bits, sufficient for dedup
}

function loadCache(): PlausibilityCache {
  try {
    return JSON.parse(
      fs.readFileSync(CACHE_FILE, "utf-8")
    ) as PlausibilityCache;
  } catch {
    return {};
  }
}

function saveCache(cache: PlausibilityCache): void {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + "\n");
}

// ── Provenance lookup ──────────────────────────────────────────────

type StatusData = Record<string, Record<string, ProvenanceEntry>>;

function getProvenance(
  status: StatusData,
  key: string,
  locale: string
): "none" | "unreviewed" | "reviewed" {
  const keyEntry = status[key];
  if (!keyEntry) return "none";
  const localeEntry = keyEntry[locale];
  if (!localeEntry) return "none";

  // Check if reviewed/approved
  if (localeEntry.method === "reviewed") return "reviewed";
  if (
    localeEntry.reviews &&
    localeEntry.reviews.some((r) => r.verdict === "approved")
  ) {
    return "reviewed";
  }

  return "unreviewed";
}

// ── Plausibility check ────────────────────────────────────────────

async function checkPlausibility(
  chain: ProviderChain,
  results: AuditResult[]
): Promise<void> {
  console.log("\nChecking plausibility via back-translation...\n");

  const cache = loadCache();
  let checked = 0;
  let cached = 0;
  let failed = 0;

  for (const result of results) {
    if (result.provenance === "reviewed") continue; // Already vetted
    if (!result.localValue || !result.enValue) continue;

    const hash = cacheKey(
      result.locale,
      result.key,
      result.localValue,
      result.enValue
    );
    const hit = cache[hash];

    if (hit) {
      // Cache hit — reuse previous back-translation result
      result.similarity = hit.similarity;
      result.backTranslation = hit.backTranslation;
      cached++;
      if (hit.similarity < 0.5) failed++;
      continue;
    }

    // Cache miss — query translation API
    try {
      const backTranslation = await chain
        .translateWithVerification(result.localValue, result.locale, "en")
        .then((r) => r.backTranslation || r.translation);

      const similarity = computeSimilarity(result.enValue, backTranslation);
      result.similarity = similarity;
      result.backTranslation = backTranslation;
      checked++;

      if (similarity < 0.5) failed++;

      // Store in cache
      cache[hash] = {
        similarity,
        backTranslation,
        timestamp: new Date().toISOString(),
      };
    } catch {
      // Network failure — skip plausibility for this entry
      result.similarity = undefined;
      result.backTranslation = "[network error]";
    }
  }

  saveCache(cache);
  console.log(
    `  Checked ${checked} translations (${cached} from cache), ${failed} low-plausibility`
  );
}

// ── Report ─────────────────────────────────────────────────────────

function printReport(results: AuditResult[], opts: AuditOptions): boolean {
  const noProvenance = results.filter((r) => r.provenance === "none");
  const unreviewed = results.filter((r) => r.provenance === "unreviewed");
  const reviewed = results.filter((r) => r.provenance === "reviewed");
  const lowPlausibility = results.filter(
    (r) => r.similarity !== undefined && r.similarity < 0.5
  );
  const medPlausibility = results.filter(
    (r) =>
      r.similarity !== undefined && r.similarity >= 0.5 && r.similarity < 0.75
  );

  console.log("\n── i18n Translation Audit ─────────────────────────\n");

  // Coverage summary per locale
  const locales = [...new Set(results.map((r) => r.locale))].sort();
  console.log("  Locale  Total   No-prov  Unreviewed  Reviewed");
  console.log("  ──────  ─────   ───────  ──────────  ────────");
  for (const locale of locales) {
    const lr = results.filter((r) => r.locale === locale);
    const np = lr.filter((r) => r.provenance === "none").length;
    const ur = lr.filter((r) => r.provenance === "unreviewed").length;
    const rv = lr.filter((r) => r.provenance === "reviewed").length;
    console.log(
      `  ${locale.padEnd(8)}${String(lr.length).padEnd(8)}${String(np).padEnd(9)}${String(ur).padEnd(12)}${rv}`
    );
  }

  console.log(`\n  Total translations: ${results.length}`);
  console.log(`  No provenance:      ${noProvenance.length}`);
  console.log(`  Unreviewed:         ${unreviewed.length}`);
  console.log(`  Reviewed/approved:  ${reviewed.length}`);

  // Plausibility results (if checked)
  const hasPlausibility = results.some((r) => r.similarity !== undefined);
  if (hasPlausibility) {
    console.log(`\n  Plausibility:`);
    console.log(
      `    High (>=75%):     ${results.filter((r) => r.similarity !== undefined && r.similarity >= 0.75).length}`
    );
    console.log(`    Medium (50-74%):  ${medPlausibility.length}`);
    console.log(`    Low (<50%):       ${lowPlausibility.length}`);

    if (lowPlausibility.length > 0) {
      console.log(`\n  ⚠ Low-plausibility translations:`);
      for (const r of lowPlausibility.slice(0, 20)) {
        const pct = Math.round((r.similarity ?? 0) * 100);
        console.log(
          `    [${r.locale}] ${r.key}: ${pct}% — en: "${r.enValue}" ← back: "${r.backTranslation}"`
        );
      }
      if (lowPlausibility.length > 20) {
        console.log(`    ... and ${lowPlausibility.length - 20} more`);
      }
    }

    if (medPlausibility.length > 0) {
      console.log(
        `\n  ⚡ Medium-plausibility translations (spot-check recommended):`
      );
      for (const r of medPlausibility.slice(0, 10)) {
        const pct = Math.round((r.similarity ?? 0) * 100);
        console.log(
          `    [${r.locale}] ${r.key}: ${pct}% — en: "${r.enValue}" ← back: "${r.backTranslation}"`
        );
      }
      if (medPlausibility.length > 10) {
        console.log(`    ... and ${medPlausibility.length - 10} more`);
      }
    }
  }

  // Determine exit status
  const hasUnvetted = noProvenance.length > 0 || unreviewed.length > 0;
  const hasLowPlausibility = lowPlausibility.length > 0;

  if (hasUnvetted || hasLowPlausibility) {
    const label = opts.warnOnly ? "⚠" : "✗";
    console.log(
      `\n  ${label} ${noProvenance.length + unreviewed.length} unvetted translation(s)`
    );
    if (hasLowPlausibility) {
      console.log(
        `  ${label} ${lowPlausibility.length} low-plausibility translation(s)`
      );
    }
    if (opts.warnOnly) {
      console.log("  (--warn-only: exiting 0)\n");
    }
    return !opts.warnOnly;
  }

  console.log("\n  ✓ All translations vetted\n");
  return false;
}

// ── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  // Load English as canonical source
  const enMessages = flattenMessages(
    loadJson(path.join(MESSAGES_DIR, "en.json"))
  );

  // Load provenance
  const status = loadJson(STATUS_FILE) as unknown as StatusData;

  // Determine locales to audit
  const locales = opts.locale ? [opts.locale] : ALL_LOCALES;

  // Collect audit results
  const results: AuditResult[] = [];

  for (const locale of locales) {
    const localeMessages = flattenMessages(
      loadJson(path.join(MESSAGES_DIR, `${locale}.json`))
    );

    for (const [key, localValue] of localeMessages) {
      const enValue = enMessages.get(key) ?? "";
      const provenance = getProvenance(status, key, locale);

      results.push({
        key,
        locale,
        localValue,
        enValue,
        provenance,
      });
    }
  }

  // Plausibility check (if requested and translations exist)
  if (opts.checkPlausibility && results.length > 0) {
    const chain = createProviderChain();
    // Only check unvetted translations to save API quota
    const unvetted = results.filter((r) => r.provenance !== "reviewed");
    await checkPlausibility(chain, unvetted);
  }

  const shouldFail = printReport(results, opts);
  process.exit(shouldFail ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
