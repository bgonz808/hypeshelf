#!/usr/bin/env npx tsx
/**
 * NLLB Benchmark Client — runs the full model×precision matrix via /benchmark.
 *
 * Usage:
 *   npx tsx scripts/i18n-benchmark.ts                          # full matrix
 *   npx tsx scripts/i18n-benchmark.ts --params=600M --precision=bf16 --device=gpu
 *
 * Calls the server's /benchmark endpoint (HMAC auth), prints per-combo
 * line items, then PARAM×PRECISION matrices for each metric.
 *
 * See ADR-004
 */

import * as crypto from "node:crypto";
import * as https from "node:https";
import * as fs from "node:fs";
import * as path from "node:path";
import { getNllbApiKey } from "./lib/port-checker.js";

// ── CLI Args ─────────────────────────────────────────────────────────

interface BenchmarkCliOptions {
  params?: string;
  precision?: string;
  device?: string;
}

function parseArgs(): BenchmarkCliOptions {
  const args = process.argv.slice(2);
  const opts: BenchmarkCliOptions = {};

  for (const arg of args) {
    if (arg.startsWith("--params=")) {
      opts.params = arg.slice("--params=".length);
    } else if (arg.startsWith("--precision=")) {
      opts.precision = arg.slice("--precision=".length);
    } else if (arg.startsWith("--device=")) {
      opts.device = arg.slice("--device=".length);
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: npx tsx scripts/i18n-benchmark.ts [options]",
          "",
          "Options:",
          "  --params=600M|1.3B|3.3B   Filter to specific model size",
          "  --precision=bf16|fp32|...  Filter to specific precision",
          "  --device=gpu|cpu           Filter to specific device",
          "  --help                     Show this help",
        ].join("\n")
      );
      process.exit(0);
    }
  }
  return opts;
}

// ── HMAC auth ────────────────────────────────────────────────────────

function makeHmacAuthHeader(secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(timestamp)
    .digest("hex");
  return `Bearer HMAC-SHA256:${timestamp}:${signature}`;
}

// ── Types ────────────────────────────────────────────────────────────

interface TranslationMetrics {
  input_tokens: number;
  output_tokens: number;
  tokenize_ms: number;
  generate_ms: number;
  ttft_ms: number;
  decode_ms: number;
  total_ms: number;
  throughput_tok_s: number;
}

interface BenchmarkComboResult {
  device: string;
  model_label: string;
  params_m: number;
  precision: string;
  status: string;
  load_time_s: number | null;
  sentence_results: Array<{
    text: string;
    translation: string;
    metrics: TranslationMetrics;
  }>;
  avg_metrics: Record<string, number> | null;
}

interface BenchmarkResponse {
  hardware: Record<string, unknown>;
  combos: BenchmarkComboResult[];
  matrices: Record<string, string[][]>;
}

// ── Main ─────────────────────────────────────────────────────────────

const nllbAgent = new https.Agent({ rejectUnauthorized: false });

async function main(): Promise<void> {
  const opts = parseArgs();

  // Load test sentences
  const fixturesPath = path.resolve(
    __dirname,
    "fixtures",
    "benchmark-sentences.json"
  );
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf-8")) as {
    sentences: string[];
    source_lang: string;
    target_lang: string;
  };

  const payload: Record<string, unknown> = {
    sentences: fixtures.sentences,
    source_lang: fixtures.source_lang,
    target_lang: fixtures.target_lang,
  };
  if (opts.params) payload["filter_params"] = [opts.params];
  if (opts.precision) payload["filter_precisions"] = [opts.precision];
  if (opts.device) {
    payload["filter_devices"] = [
      opts.device.toLowerCase() === "gpu" ? "cuda" : opts.device,
    ];
  }
  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = getNllbApiKey();
  if (apiKey) {
    headers["Authorization"] = makeHmacAuthHeader(apiKey);
  }

  console.log(
    `Sending benchmark request (${fixtures.sentences.length} sentences)...`
  );
  console.log(
    "This may take several minutes as models are loaded and tested.\n"
  );

  const host = process.env["NLLB_HOST"] ?? "127.0.0.1";
  const url = new URL(`https://${host}:8000/benchmark`);

  const result = await new Promise<BenchmarkResponse>((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers,
        agent: nllbAgent,
        timeout: 600_000, // 10 min — benchmark takes a while
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
            reject(new Error(`Benchmark HTTP ${res.statusCode}: ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as BenchmarkResponse);
          } catch {
            reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Benchmark request timed out (10min)"));
    });
    req.write(body);
    req.end();
  });

  // ── Filter results if CLI flags provided ──
  let combos = result.combos;
  if (opts.params) {
    const p = opts.params.toUpperCase();
    combos = combos.filter((c) => c.model_label.toUpperCase().includes(p));
  }
  if (opts.precision) {
    combos = combos.filter((c) => c.precision === opts.precision);
  }
  if (opts.device) {
    const d = opts.device.toUpperCase();
    combos = combos.filter((c) => c.device.toUpperCase() === d);
  }

  // ── Print PARAM×PRECISION matrices ──
  for (const [metricName, grid] of Object.entries(result.matrices)) {
    console.log(`\n═══ ${metricName} ═══`);
    for (const row of grid) {
      console.log(row.map((cell) => cell.padEnd(16)).join(""));
    }
  }

  // ── Print detailed per-combo table ──
  console.log("\n═══ Detailed Results ═══\n");
  const hdr = [
    "Device",
    "Model",
    "Precision",
    "In Tok",
    "Tokenize",
    "TTFT",
    "Generate",
    "Decode",
    "Total",
    "Tok/s",
    "Load(s)",
    "Status",
  ];
  console.log(hdr.map((h) => h.padEnd(14)).join(""));
  console.log("─".repeat(14 * hdr.length));

  for (const c of combos) {
    if (c.status !== "ok") {
      const row = [
        c.device,
        c.model_label,
        c.precision,
        "—",
        "—",
        "—",
        "—",
        "—",
        "—",
        "—",
        "—",
        c.status,
      ];
      console.log(row.map((v) => v.padEnd(14)).join(""));
      continue;
    }

    const a = c.avg_metrics;
    if (!a) continue;

    const row = [
      c.device,
      c.model_label,
      c.precision,
      String(a["input_tokens"] ?? "—"),
      `${(a["tokenize_ms"] ?? 0).toFixed(1)}ms`,
      `${(a["ttft_ms"] ?? 0).toFixed(0)}ms`,
      `${(a["generate_ms"] ?? 0).toFixed(0)}ms`,
      `${(a["decode_ms"] ?? 0).toFixed(1)}ms`,
      `${(a["total_ms"] ?? 0).toFixed(0)}ms`,
      String(a["throughput_tok_s"] ?? "—"),
      String(c.load_time_s ?? "—"),
      "✓",
    ];
    console.log(row.map((v) => v.padEnd(14)).join(""));
  }

  console.log(
    `\nBenchmark complete: ${combos.filter((c) => c.status === "ok").length} combos tested, ` +
      `${combos.filter((c) => c.status !== "ok").length} infeasible.`
  );
}

main().catch((err) => {
  console.error("Benchmark error:", err);
  process.exit(1);
});
