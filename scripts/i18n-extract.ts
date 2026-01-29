#!/usr/bin/env npx tsx
/**
 * Interactive i18n Extraction & Translation Script
 *
 * Finds hardcoded strings via ESLint, shows POS-tagged context,
 * machine-translates to all locales with back-translation sanity checking,
 * and writes accepted translations to message files with provenance tracking.
 *
 * Usage:
 *   npx tsx scripts/i18n-extract.ts
 *   npx tsx scripts/i18n-extract.ts --file=src/components/RecommendationCard.tsx
 *   npx tsx scripts/i18n-extract.ts --dry-run
 *   npx tsx scripts/i18n-extract.ts --auto-approve
 *
 * See ADR-004 Phase 4
 */

import { select, input } from "@inquirer/prompts";
import {
  findViolations,
  getFileContext,
  type Violation,
} from "./lib/eslint-parser.js";
import { analyzeString, suggestKey } from "./lib/string-analyzer.js";
import {
  createProviderChain,
  type TranslationResult,
  type ProviderChain,
} from "./lib/translation-providers.js";
import {
  MessageFileManager,
  type ProvenanceEntry,
} from "./lib/message-manager.js";

// Dynamic ESM imports for chalk
let chalk: typeof import("chalk").default;

// ── CLI Args ───────────────────────────────────────────────────────

interface CliOptions {
  file?: string;
  dryRun: boolean;
  autoApprove: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = { dryRun: false, autoApprove: false };

  for (const arg of args) {
    if (arg.startsWith("--file=")) {
      opts.file = arg.slice("--file=".length);
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--auto-approve") {
      opts.autoApprove = true;
    }
  }

  return opts;
}

// ── Constants ──────────────────────────────────────────────────────

const TARGET_LOCALES = ["es", "zh", "ar", "yi"];

// ── Display Helpers ────────────────────────────────────────────────

function similarityBadge(sim: number): string {
  const pct = Math.round(sim * 100);
  if (sim >= 0.75) return chalk.green(`✅ ${pct}%`);
  if (sim >= 0.5) return chalk.yellow(`⚠️  ${pct}%`);
  return chalk.red(`❌ ${pct}%`);
}

function displayContext(ctx: ReturnType<typeof getFileContext>): string {
  return ctx
    .map((line) => {
      const prefix = line.isCurrent ? chalk.red("→") : " ";
      const num = chalk.dim(String(line.lineNumber).padStart(4));
      const text = line.isCurrent ? chalk.bold(line.text) : line.text;
      return `${prefix} ${num} │ ${text}`;
    })
    .join("\n");
}

function displayTranslationTable(
  translations: Map<string, TranslationResult>
): string {
  const rows: string[] = [];
  for (const [locale, result] of translations) {
    const sim = similarityBadge(result.similarity);
    rows.push(
      `  ${chalk.cyan(locale.padEnd(4))} ${result.translation.padEnd(30)} ${chalk.dim(result.backTranslation.padEnd(20))} ${result.provider} ${sim}`
    );
  }
  return rows.join("\n");
}

// ── Translation ────────────────────────────────────────────────────

async function translateAll(
  chain: ProviderChain,
  text: string
): Promise<Map<string, TranslationResult>> {
  const results = new Map<string, TranslationResult>();

  for (const locale of TARGET_LOCALES) {
    try {
      const result = await chain.translateWithVerification(text, "en", locale);
      results.set(locale, result);
    } catch (err) {
      // Record failure gracefully
      results.set(locale, {
        translation: `[FAILED: ${err instanceof Error ? err.message : "unknown"}]`,
        backTranslation: "",
        similarity: 0,
        provider: "none",
      });
    }
  }

  return results;
}

// ── Main Processing ────────────────────────────────────────────────

interface TodoItem {
  file: string;
  line: number;
  key: string;
  original: string;
}

async function processViolation(
  violation: Violation,
  index: number,
  total: number,
  chain: ProviderChain,
  manager: MessageFileManager,
  opts: CliOptions
): Promise<{ action: "accept" | "skip" | "skipAll"; todo?: TodoItem }> {
  const ctx = getFileContext(violation.file, violation.line);
  const { display: posDisplay } = await analyzeString(violation.literal);
  const suggestedKey = suggestKey(violation.file, violation.literal);

  console.log(
    `\n${chalk.bold(`[${index + 1}/${total}]`)} ${chalk.underline(violation.file)}:${violation.line}\n`
  );
  console.log(chalk.dim("Context:"));
  console.log(displayContext(ctx));
  console.log();
  console.log(`${chalk.dim("POS:")} ${posDisplay}`);
  console.log(`${chalk.dim("Suggested key:")} ${chalk.green(suggestedKey)}`);

  // Check if key already exists
  if (manager.hasKey("en", suggestedKey)) {
    console.log(
      chalk.yellow(`  Key "${suggestedKey}" already exists in en.json`)
    );
  }

  // Translate
  console.log(chalk.dim("\nTranslating..."));
  const translations = await translateAll(chain, violation.literal);
  console.log();
  console.log(displayTranslationTable(translations));
  console.log();

  // Determine if all translations are high-confidence
  const allGreen = [...translations.values()].every(
    (t) => t.similarity >= 0.75
  );
  const hasLow = [...translations.values()].some(
    (t) => t.similarity < 0.5 && t.provider !== "none"
  );

  if (opts.dryRun) {
    console.log(chalk.dim("  [dry-run] Would write to message files"));
    return { action: "skip" };
  }

  if (opts.autoApprove && allGreen) {
    console.log(
      chalk.green("  [auto-approved] All translations ≥75% similarity")
    );
    return doAccept(suggestedKey, violation, translations, manager);
  }

  // Interactive prompt
  const reviewNote = hasLow
    ? " (low-confidence translations marked for review)"
    : "";
  const action = await select({
    message: "Action:",
    choices: [
      {
        name: `Accept all${reviewNote}`,
        value: "accept",
      },
      { name: "Edit key name", value: "editKey" },
      { name: "Skip", value: "skip" },
      { name: "Flag all for human review", value: "flag" },
      { name: "Skip all remaining", value: "skipAll" },
    ],
  });

  if (action === "skipAll") {
    return { action: "skipAll" };
  }

  if (action === "skip") {
    return { action: "skip" };
  }

  if (action === "editKey") {
    const newKey = await input({
      message: "Enter key:",
      default: suggestedKey,
    });
    return doAccept(newKey, violation, translations, manager);
  }

  if (action === "flag") {
    return doAccept(suggestedKey, violation, translations, manager, true);
  }

  // action === "accept"
  return doAccept(suggestedKey, violation, translations, manager);
}

function doAccept(
  key: string,
  violation: Violation,
  translations: Map<string, TranslationResult>,
  manager: MessageFileManager,
  forceReview: boolean = false
): { action: "accept"; todo: TodoItem } {
  const today = new Date().toISOString().slice(0, 10);

  // Write English
  manager.setMessage("en", key, violation.literal);
  manager.setProvenance("en", key, {
    method: "authored",
    date: today,
  });

  // Write translations
  for (const [locale, result] of translations) {
    if (result.provider === "none") continue; // Failed translation

    manager.setMessage(locale, key, result.translation);

    const needsReview = forceReview || result.similarity < 0.75;
    const entry: ProvenanceEntry = {
      method: needsReview ? "machine-needs-review" : "machine",
      engine: result.provider,
      source: "en",
      date: today,
    };
    manager.setProvenance(locale, key, entry);
  }

  return {
    action: "accept",
    todo: {
      file: violation.file,
      line: violation.line,
      key,
      original: violation.literal,
    },
  };
}

// ── Entry Point ────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Dynamic import for chalk (ESM)
  const chalkMod = await import("chalk");
  chalk = chalkMod.default;

  const opts = parseArgs();

  console.log(chalk.bold("\n🔍 i18n Extraction & Translation\n"));

  if (opts.dryRun) {
    console.log(chalk.yellow("  [dry-run mode] No files will be written\n"));
  }

  // Find violations
  console.log(chalk.dim("Scanning for hardcoded strings..."));
  const violations = findViolations(opts.file);

  if (violations.length === 0) {
    console.log(chalk.green("No hardcoded string violations found!"));
    process.exit(0);
  }

  console.log(`Found ${chalk.bold(String(violations.length))} violations\n`);

  // Set up translation provider and message manager
  const chain = createProviderChain();
  const manager = new MessageFileManager();
  const todos: TodoItem[] = [];
  let accepted = 0;
  let skipped = 0;

  for (let i = 0; i < violations.length; i++) {
    const violation = violations[i]!;
    const result = await processViolation(
      violation,
      i,
      violations.length,
      chain,
      manager,
      opts
    );

    if (result.action === "skipAll") {
      skipped += violations.length - i;
      break;
    }

    if (result.action === "accept" && result.todo) {
      todos.push(result.todo);
      accepted++;
    } else {
      skipped++;
    }
  }

  // Flush writes
  if (!opts.dryRun && accepted > 0) {
    const { written } = manager.flush();
    console.log(chalk.green(`\n✅ Wrote ${written.length} files`));
    for (const f of written) {
      console.log(chalk.dim(`   ${f}`));
    }
  }

  // Summary
  console.log(chalk.bold("\n── Summary ──────────────────────────────────"));
  console.log(`  Violations found: ${violations.length}`);
  console.log(`  Accepted:         ${chalk.green(String(accepted))}`);
  console.log(`  Skipped:          ${chalk.dim(String(skipped))}`);

  // Print TODO list of t() replacements
  if (todos.length > 0) {
    console.log(chalk.bold("\n── TODO: Replace in source files ─────────────"));
    console.log(chalk.dim("  These strings need manual t() wrapping:\n"));
    for (const todo of todos) {
      console.log(`  ${chalk.cyan(todo.file)}:${todo.line}`);
      console.log(
        `    ${chalk.dim(JSON.stringify(todo.original))} → ${chalk.green(`t("${todo.key}")`)}`
      );
    }
  }

  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
