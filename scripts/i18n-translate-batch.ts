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
import { probeAllServices, detectGpu } from "./lib/port-checker.js";
import { execSync } from "node:child_process";
import { MS_PER_SECOND } from "../src/lib/temporal-constants.js";

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

  // ── GPU detection ──────────────────────────────────────────────
  console.log("Detecting hardware...\n");
  const gpu = await detectGpu();
  if (gpu.available) {
    console.log(
      `  GPU: ${gpu.name} (${gpu.vramMb} MB) — Docker GPU: ${gpu.dockerGpu ? "yes" : "no"}`
    );
  } else {
    console.log("  GPU: not detected (CPU mode)");
  }

  // ── Auto-launch NLLB if Docker available but service not running ─
  let services = await probeAllServices();

  if (!services.nllb) {
    const hasDocker = isDockerAvailable();
    if (hasDocker) {
      const profile = gpu.available && gpu.dockerGpu ? "gpu" : "";
      const profileFlag = profile ? `--profile ${profile}` : "";
      const composeFile = path.resolve(
        __dirname,
        "..",
        "docker",
        "docker-compose.i18n.yml"
      );
      const mode = profile === "gpu" ? "GPU" : "CPU";
      console.log(`\n  NLLB offline — launching Docker container (${mode})...`);

      // Ensure bind-mount directory exists (prevents Docker creating it as root)
      const volumeDir = path.resolve(
        __dirname,
        "..",
        ".docker-volumes",
        "nllb-cache"
      );
      fs.mkdirSync(volumeDir, { recursive: true });

      try {
        execSync(
          `docker compose -f "${composeFile}" ${profileFlag} up -d --build`.trim(),
          { stdio: "pipe", timeout: 300_000 }
        );
        console.log("  Container started. Waiting for model to load...");
        // Poll health endpoint — model download + load can take a while
        services = await waitForNllb(180_000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  Docker launch failed: ${msg}`);
        console.log("  Continuing without local NLLB (cloud fallback).\n");
      }
    } else {
      console.log("\n  Docker not available — skipping NLLB auto-launch.");
    }
  }

  console.log("");
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

/** Check if Docker CLI is available */
function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** Poll NLLB health endpoint until available or timeout */
async function waitForNllb(
  timeoutMs: number
): Promise<{ nllb: boolean; lmStudio: boolean }> {
  const start = Date.now();
  const poll = 3_000; // check every 3s
  while (Date.now() - start < timeoutMs) {
    const s = await probeAllServices();
    if (s.nllb) {
      console.log(
        `  NLLB ready (${Math.round((Date.now() - start) / MS_PER_SECOND)}s).`
      );
      return s;
    }
    await delay(poll);
    process.stdout.write(".");
  }
  console.log("\n  NLLB did not become ready within timeout.");
  return probeAllServices();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
