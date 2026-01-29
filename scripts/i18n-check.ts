#!/usr/bin/env npx tsx
/**
 * i18n Coverage & Validation Script
 *
 * Validates translation files across all locales:
 * 1. JSON well-formedness
 * 2. Key completeness (en.json is canonical; other locales must match)
 * 3. Empty values in en.json (needs-translation markers)
 * 4. Stale keys in non-en locales (keys not in en.json)
 * 5. Waiver-aware reporting (reads i18n-waivers.json)
 *
 * Exit codes:
 *   0 = pass (warnings are OK)
 *   1 = hard failures (missing en keys, malformed JSON)
 *
 * Run: npx tsx scripts/i18n-check.ts
 * See: ADR-004 §8 (Gating Strategy)
 */

import * as fs from "fs";
import * as path from "path";

// ── Configuration ──────────────────────────────────────────────────

const MESSAGES_DIR = path.resolve(__dirname, "..", "messages");
const WAIVERS_PATH = path.resolve(__dirname, "..", "i18n-waivers.json");
const BASE_LOCALE = "en";

// ── Types ──────────────────────────────────────────────────────────

interface Waiver {
  keys: string[];
  locales: string[];
  reason: string;
  milestone: string;
  author: string;
  date: string;
}

interface WaiversFile {
  _meta: { description: string };
  waivers: Waiver[];
}

type Messages = Record<string, unknown>;

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Recursively collect all leaf key paths from a nested JSON object.
 * e.g. { a: { b: "x" } } → ["a.b"]
 */
function collectKeys(obj: Messages, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...collectKeys(value as Messages, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/**
 * Get a nested value from an object by dot-path.
 */
function getNestedValue(obj: Messages, keyPath: string): unknown {
  const parts = keyPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Check if a key matches a waiver pattern (supports trailing wildcard).
 */
function matchesWaiverPattern(key: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return key === prefix || key.startsWith(`${prefix}.`);
  }
  return key === pattern;
}

/**
 * Check if a key+locale combination is waived.
 */
function isWaived(
  key: string,
  locale: string,
  waivers: Waiver[]
): Waiver | null {
  for (const waiver of waivers) {
    if (!waiver.locales.includes(locale)) continue;
    for (const pattern of waiver.keys) {
      if (matchesWaiverPattern(key, pattern)) return waiver;
    }
  }
  return null;
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  let errors = 0;
  let warnings = 0;

  console.log("🌐 i18n Coverage Check\n");

  // Load waivers
  let waivers: Waiver[] = [];
  try {
    const raw = fs.readFileSync(WAIVERS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as WaiversFile;
    waivers = parsed.waivers ?? [];
    console.log(
      `  Loaded ${String(waivers.length)} waiver(s) from i18n-waivers.json`
    );
  } catch {
    console.log("  ⚠ No i18n-waivers.json found (all gaps will be reported)");
  }

  // Discover locale files
  const files = fs.readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json"));
  const locales = files.map((f) => f.replace(".json", ""));
  console.log(`  Locales: ${locales.join(", ")}\n`);

  // Parse all locale files
  const localeData = new Map<string, Messages>();
  for (const locale of locales) {
    const filePath = path.join(MESSAGES_DIR, `${locale}.json`);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as Messages;
      localeData.set(locale, parsed);
    } catch (err) {
      console.error(`  ❌ MALFORMED JSON: messages/${locale}.json`);
      console.error(`     ${err instanceof Error ? err.message : String(err)}`);
      errors++;
    }
  }

  // Get base locale keys
  const baseMessages = localeData.get(BASE_LOCALE);
  if (!baseMessages) {
    console.error(`  ❌ FATAL: ${BASE_LOCALE}.json not found or unparseable`);
    process.exit(1);
  }

  const baseKeys = collectKeys(baseMessages).filter(
    (k) => !k.startsWith("_meta")
  );
  console.log(
    `  Base locale (${BASE_LOCALE}): ${String(baseKeys.length)} keys\n`
  );

  // Check for empty values in base locale
  const emptyBaseKeys: string[] = [];
  for (const key of baseKeys) {
    const value = getNestedValue(baseMessages, key);
    if (typeof value === "string" && value.trim() === "") {
      emptyBaseKeys.push(key);
    }
  }
  if (emptyBaseKeys.length > 0) {
    console.log(`  ⚠ Empty values in ${BASE_LOCALE}.json (needs-translation):`);
    for (const key of emptyBaseKeys) {
      console.log(`    - ${key}`);
      warnings++;
    }
    console.log();
  }

  // Coverage matrix header
  const nonBaseLocales = locales.filter((l) => l !== BASE_LOCALE);
  const coverageStats = new Map<
    string,
    { total: number; present: number; waived: number }
  >();

  // Check each non-base locale
  for (const locale of nonBaseLocales) {
    const messages = localeData.get(locale);
    if (!messages) continue;

    const localeKeys = collectKeys(messages).filter(
      (k) => !k.startsWith("_meta")
    );
    const localeKeySet = new Set(localeKeys);
    let present = 0;
    let waived = 0;
    const missing: string[] = [];

    for (const key of baseKeys) {
      if (localeKeySet.has(key)) {
        const value = getNestedValue(messages, key);
        if (typeof value === "string" && value.trim() !== "") {
          present++;
        } else {
          // Key exists but empty
          const w = isWaived(key, locale, waivers);
          if (w) {
            waived++;
          } else {
            missing.push(key);
          }
        }
      } else {
        const w = isWaived(key, locale, waivers);
        if (w) {
          waived++;
        } else {
          missing.push(key);
        }
      }
    }

    coverageStats.set(locale, { total: baseKeys.length, present, waived });

    if (missing.length > 0) {
      console.log(`  ⚠ ${locale}: ${String(missing.length)} missing key(s):`);
      for (const key of missing.slice(0, 10)) {
        console.log(`    - ${key}`);
      }
      if (missing.length > 10) {
        console.log(`    ... and ${String(missing.length - 10)} more`);
      }
      warnings += missing.length;
      console.log();
    }

    // Check for stale keys (in locale but not in base)
    const baseKeySet = new Set(baseKeys);
    const stale = localeKeys.filter((k) => !baseKeySet.has(k));
    if (stale.length > 0) {
      console.log(
        `  ⚠ ${locale}: ${String(stale.length)} stale key(s) (not in ${BASE_LOCALE}):`
      );
      for (const key of stale.slice(0, 5)) {
        console.log(`    - ${key}`);
      }
      if (stale.length > 5) {
        console.log(`    ... and ${String(stale.length - 5)} more`);
      }
      warnings += stale.length;
      console.log();
    }
  }

  // Coverage matrix
  console.log("  ── Coverage Matrix ──────────────────────────────────");
  console.log(
    `  ${"Locale".padEnd(8)} ${"Keys".padEnd(6)} ${"Present".padEnd(9)} ${"Waived".padEnd(8)} Coverage`
  );
  console.log(`  ${"─".repeat(50)}`);

  // Base locale
  console.log(
    `  ${BASE_LOCALE.padEnd(8)} ${String(baseKeys.length).padEnd(6)} ${String(baseKeys.length).padEnd(9)} ${"0".padEnd(8)} 100%`
  );

  for (const locale of nonBaseLocales) {
    const stats = coverageStats.get(locale);
    if (!stats) continue;
    const pct =
      stats.total > 0
        ? Math.round(((stats.present + stats.waived) / stats.total) * 100)
        : 0;
    console.log(
      `  ${locale.padEnd(8)} ${String(stats.total).padEnd(6)} ${String(stats.present).padEnd(9)} ${String(stats.waived).padEnd(8)} ${String(pct)}%`
    );
  }

  console.log();

  // Summary
  console.log("  ── Summary ─────────────────────────────────────────");
  if (errors > 0) {
    console.log(`  ❌ ${String(errors)} error(s) (hard failures)`);
  }
  if (warnings > 0) {
    console.log(`  ⚠  ${String(warnings)} warning(s)`);
  }
  if (errors === 0 && warnings === 0) {
    console.log("  ✅ All checks passed");
  } else if (errors === 0) {
    console.log("  ✅ No hard failures (warnings are informational)");
  }

  process.exit(errors > 0 ? 1 : 0);
}

main();
