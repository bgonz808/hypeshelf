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
import {
  probeAllServices,
  detectHardware,
  recommendProfile,
} from "./lib/port-checker.js";
import { ensureApiKey } from "./lib/nllb-keygen.js";
import { execSync } from "node:child_process";
import { MS_PER_SECOND } from "../src/lib/temporal-constants.js";

// ── CLI Args ────────────────────────────────────────────────────────

interface CliOptions {
  locale?: string;
  dryRun: boolean;
  includeTranslated: boolean;
  limit?: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = { dryRun: false, includeTranslated: false };

  for (const arg of args) {
    if (arg.startsWith("--locale=")) {
      opts.locale = arg.slice("--locale=".length);
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--include-translated" || arg === "--force") {
      opts.includeTranslated = true;
    } else if (arg.startsWith("--limit=")) {
      const n = parseInt(arg.slice("--limit=".length), 10);
      if (isNaN(n) || n <= 0) {
        console.error("--limit must be a positive integer");
        process.exit(1);
      }
      opts.limit = n;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: npx tsx scripts/i18n-translate-batch.ts [options]",
          "",
          "Options:",
          "  --locale=XX              Translate only this locale (es, zh, ar, yi)",
          "  --dry-run                Show what would be translated without writing",
          "  --include-translated     Retranslate existing keys (normally skipped)",
          "  --limit=N                Translate at most N keys per locale",
          "  --help                   Show this help",
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

  // ── Hardware detection ──────────────────────────────────────────
  console.log("Detecting hardware...\n");
  const hw = await detectHardware();
  const { gpu } = hw;
  if (gpu.available) {
    const vramStr = gpu.vramMb ? `${gpu.vramMb} MB VRAM` : "unified memory";
    console.log(
      `  GPU: ${gpu.name} [${gpu.vendor}] (${vramStr}) — Docker GPU: ${gpu.dockerGpu ? "yes" : "no"}`
    );
  } else {
    console.log("  GPU: not detected (CPU mode)");
  }
  const { cpu } = hw;
  const cpuFeats = [
    cpu.features.avx2 && "AVX2",
    cpu.features.avx512 && "AVX-512",
    cpu.features.avx512bf16 && "AVX512BF16",
    cpu.features.neon && "NEON",
  ]
    .filter(Boolean)
    .join(", ");
  console.log(
    `  CPU: ${cpu.model} (${cpu.cores} cores${cpuFeats ? `, ${cpuFeats}` : ""})`
  );
  console.log(`  RAM: ${hw.systemRamMb} MB`);

  // Model + precision selection is deferred to the Python server inside
  // the container, which uses canonical PyTorch APIs. We only decide
  // the Docker profile (CPU vs GPU) here.
  const profileRec = recommendProfile(hw);
  console.log(`  Profile: ${profileRec.label}`);

  // ── Auto-launch NLLB if Docker available but service not running ─
  let services = await probeAllServices();

  if (!services.nllb) {
    const hasDocker = isDockerAvailable();
    if (hasDocker) {
      const profileFlag = profileRec.profile
        ? `--profile ${profileRec.profile}`
        : "";
      const composeFile = path.resolve(
        __dirname,
        "..",
        "docker",
        "docker-compose.i18n.yml"
      );
      const mode = profileRec.useGpu ? "GPU" : "CPU";
      console.log(`\n  NLLB offline — launching Docker container (${mode})...`);

      // Ensure bind-mount directory exists (prevents Docker creating it as root)
      const volumeDir = path.resolve(
        __dirname,
        "..",
        ".docker-volumes",
        "nllb-cache"
      );
      fs.mkdirSync(volumeDir, { recursive: true });

      // Generate API key if not already present
      const apiKey = ensureApiKey();

      // Determine bind address from NLLB_NETWORK_MODE
      const networkMode = process.env["NLLB_NETWORK_MODE"] ?? "local";
      const nllbBind = networkMode === "lan" ? "0.0.0.0" : "127.0.0.1";

      try {
        // Pass env var overrides through to the container — the server
        // validates and uses them (or auto-selects if unset).
        execSync(
          `docker compose -f "${composeFile}" ${profileFlag} up -d --build`.trim(),
          {
            stdio: "pipe",
            timeout: 300_000,
            env: {
              ...process.env,
              NLLB_API_KEY: apiKey,
              NLLB_BIND: nllbBind,
            },
          }
        );
        console.log("  Container started (TLS + HMAC auth enabled).");
        if (networkMode === "lan") {
          console.log(`  LAN mode: bound to 0.0.0.0:8000`);
          console.log(
            `  Teammates: set NLLB_HOST=<this-machine-ip> and copy .docker-volumes/nllb-api-key`
          );
        }
        console.log("  Waiting for model to load...");
        // Poll health endpoint — model download + load can take a while
        services = await waitForNllb(180_000, composeFile);
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

    // Find keys to translate
    const candidateKeys = enKeys.filter(({ key }) => {
      if (opts.includeTranslated) return true;
      return !manager.hasKey(locale, key);
    });

    if (candidateKeys.length === 0) {
      console.log(`  No missing keys for ${locale}.`);
      totalSkipped += enKeys.length;
      continue;
    }

    const missingKeys = opts.limit
      ? candidateKeys.slice(0, opts.limit)
      : candidateKeys;

    const limitNote =
      opts.limit && candidateKeys.length > opts.limit
        ? ` (limited to ${opts.limit} of ${candidateKeys.length})`
        : "";
    console.log(
      `  ${missingKeys.length} keys to translate${limitNote} (${enKeys.length - candidateKeys.length} existing)\n`
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

        // Print per-key result with metrics when available
        const conf = `${Math.round(result.confidence * 100)}%`;
        const methodTag = result.method.padEnd(10);
        const m = result.metrics;
        if (m) {
          console.log(
            `  ✓ ${key.padEnd(30)} ${methodTag} ${conf.padStart(4)}  ` +
              `${m.input_tokens}→${m.output_tokens}tok  ` +
              `ttft=${m.ttft_ms.toFixed(0)}ms  gen=${m.generate_ms.toFixed(0)}ms  ` +
              `${m.decode_ms.toFixed(1)}ms  ${m.total_ms.toFixed(0)}ms  ` +
              `${m.throughput_tok_s}tok/s  "${result.translation}"`
          );
        } else {
          console.log(
            `  ✓ ${key.padEnd(30)} ${methodTag} ${conf.padStart(4)}  "${result.translation}"`
          );
        }

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
  timeoutMs: number,
  composeFile?: string
): Promise<{ nllb: boolean; lmStudio: boolean }> {
  const start = Date.now();
  const poll = 5_000; // check every 5s

  // Stream Docker logs in background for progress visibility
  let logProc: ReturnType<typeof import("node:child_process").spawn> | null =
    null;
  if (composeFile) {
    const { spawn } = await import("node:child_process");
    logProc = spawn(
      "docker",
      ["compose", "-f", composeFile, "logs", "-f", "--tail=5"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    logProc.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        // Filter to model download/loading progress lines
        if (
          /download|loading|model|tokenizer|ready|error|percent|%/i.test(line)
        ) {
          console.log(`  [nllb] ${line.replace(/^nllb[^|]*\| ?/, "").trim()}`);
        }
      }
    });
  }

  let lastPhase = "";
  while (Date.now() - start < timeoutMs) {
    // Try HTTPS health endpoint for phase status
    try {
      const https = await import("node:https");
      const host = process.env["NLLB_HOST"] ?? "127.0.0.1";
      const phase = await new Promise<string>((resolve) => {
        const req = https.get(
          {
            hostname: host,
            port: 8000,
            path: "/health",
            rejectUnauthorized: false,
            timeout: 2000,
          },
          (res) => {
            let body = "";
            res.on("data", (c: Buffer) => {
              body += c;
            });
            res.on("end", () => {
              try {
                const j = JSON.parse(body) as {
                  phase?: string;
                  status?: string;
                };
                resolve(j.phase ?? j.status ?? "unknown");
              } catch {
                resolve("connecting");
              }
            });
          }
        );
        req.on("error", () => resolve("offline"));
        req.on("timeout", () => {
          req.destroy();
          resolve("offline");
        });
      });

      if (phase !== lastPhase) {
        lastPhase = phase;
        const elapsed = Math.round((Date.now() - start) / MS_PER_SECOND);
        console.log(`  [${elapsed}s] NLLB phase: ${phase}`);
      }

      if (phase === "ready") {
        logProc?.kill();
        const elapsed = Math.round((Date.now() - start) / MS_PER_SECOND);
        console.log(`  NLLB ready (${elapsed}s).`);
        return probeAllServices();
      }
    } catch {
      // Server not up yet
    }

    await delay(poll);
  }

  logProc?.kill();
  console.log("\n  NLLB did not become ready within timeout.");
  return probeAllServices();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
