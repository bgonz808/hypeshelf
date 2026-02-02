#!/usr/bin/env npx tsx
/**
 * Color Audit Script
 *
 * Ensures all components use semantic design tokens instead of
 * arbitrary Tailwind color classes. This enforces design system
 * consistency and enables global theme changes.
 *
 * Run: npm run audit:colors
 * Add to CI for automated enforcement.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

interface Violation {
  file: string;
  line: number;
  match: string;
  suggestion: string;
  type: "raw-color" | "missing-color";
}

// ============================================
// ALLOWED SEMANTIC TOKENS
// These are the ONLY color classes permitted
// ============================================
const ALLOWED_PATTERNS = [
  // Semantic background tokens
  /\bbg-page\b/,
  /\bbg-surface\b/,
  /\bbg-surface-secondary\b/,
  /\bbg-input\b/,
  /\bbg-accent\b/,
  /\bbg-accent-hover\b/,
  /\bbg-accent-light\b/,
  /\bbg-error\b/,
  /\bbg-warning\b/,
  /\bbg-success\b/,
  /\bbg-info\b/,
  /\bbg-highlight\b/,

  // Content category backgrounds
  /\bbg-cat-entertainment\b/,
  /\bbg-cat-knowledge\b/,
  /\bbg-cat-creative\b/,
  /\bbg-cat-neutral\b/,

  // Component backgrounds
  /\bbg-tag\b/,
  /\bbg-skeleton\b/,
  /\bbg-skeleton-shine\b/,
  /\bbg-overlay\b/,
  /\bbg-disabled\b/,

  // Semantic text tokens
  /\btext-primary\b/,
  /\btext-secondary\b/,
  /\btext-muted\b/,
  /\btext-accent\b/,
  /\btext-on-accent\b/,
  /\btext-error\b/,
  /\btext-warning\b/,
  /\btext-success\b/,
  /\btext-info\b/,
  /\btext-highlight\b/,

  // Content category text
  /\btext-cat-entertainment\b/,
  /\btext-cat-knowledge\b/,
  /\btext-cat-creative\b/,
  /\btext-cat-neutral\b/,

  // Component text
  /\btext-tag\b/,
  /\btext-disabled\b/,

  // Semantic border tokens
  /\bborder-default\b/,
  /\bborder-muted\b/,
  /\bborder-input\b/,
  /\bborder-accent\b/,
  /\bborder-error\b/,
  /\bborder-warning\b/,
  /\bborder-success\b/,
  /\bborder-info\b/,
  /\bborder-highlight\b/,

  // Content category borders
  /\bborder-cat-entertainment\b/,
  /\bborder-cat-knowledge\b/,
  /\bborder-cat-creative\b/,
  /\bborder-cat-neutral\b/,

  // Component borders
  /\bborder-tag\b/,
  /\bborder-disabled\b/,

  // Placeholder tokens
  /\bplaceholder:text-muted\b/,
  /\bplaceholder-muted\b/,

  // Ring/outline tokens (for focus states)
  /\bring-accent\b/,
  /\boutline-accent\b/,

  // Hover utilities
  /\bhover-bg-accent\b/,
  /\bhover-bg-surface-secondary\b/,
  /\bhover-bg-success\b/,
  /\bhover-bg-error\b/,

  // Transparent/inherit (always allowed)
  /\bbg-transparent\b/,
  /\btext-inherit\b/,
  /\bborder-transparent\b/,

  // Current color (always allowed)
  /\btext-current\b/,
  /\bborder-current\b/,

  // White/black for true white/black needs (rare)
  /\bbg-white\b/,
  /\bbg-black\b/,
  /\btext-white\b/,
  /\btext-black\b/,
];

// ============================================
// DISALLOWED RAW COLOR PATTERNS
// These indicate design system violations
// ============================================
const RAW_COLOR_PATTERN =
  /\b(bg|text|border|ring|outline|placeholder:|from-|to-|via-)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(\d{2,3})\b/g;

// Also catch brand colors used directly (should use semantic tokens)
const BRAND_COLOR_PATTERN = /\b(bg|text|border|ring)-brand-\d+\b/g;

// ============================================
// PATTERNS FOR MISSING COLOR DETECTION
// Elements that MUST have explicit colors
// ============================================

// Elements that need background colors
const NEEDS_BG_PATTERNS = [
  // Buttons (primary action elements)
  /<button[^>]*className="([^"]*)"[^>]*>/g,
  // Submit buttons
  /type="submit"[^>]*className="([^"]*)"[^>]*/g,
  // Input elements
  /<input[^>]*className="([^"]*)"[^>]*>/g,
  /<textarea[^>]*className="([^"]*)"[^>]*>/g,
  /<select[^>]*className="([^"]*)"[^>]*>/g,
];

// Pattern to check if className has any background
const HAS_BG_PATTERN = /\b(bg-\w+)/;

// Pattern to detect card-like surfaces (rounded + border often = card)
const CARD_PATTERN =
  /<div[^>]*className="([^"]*rounded[^"]*border[^"]*)"[^>]*>/g;

// Suggestions for common violations
const SUGGESTIONS = new Map<string, string>([
  // Gray backgrounds
  ["bg-gray-50", "bg-page or bg-surface"],
  ["bg-gray-100", "bg-surface-secondary"],
  ["bg-gray-200", "bg-skeleton or bg-surface-secondary"],
  ["bg-gray-900", "bg-black or bg-overlay"],
  ["bg-white", "bg-surface (unless true white needed)"],

  // Gray text
  ["text-gray-900", "text-primary"],
  ["text-gray-800", "text-primary"],
  ["text-gray-700", "text-secondary"],
  ["text-gray-600", "text-secondary"],
  ["text-gray-500", "text-muted"],
  ["text-gray-400", "text-muted"],

  // Gray borders
  ["border-gray-300", "border-default or border-input"],
  ["border-gray-200", "border-muted"],
  ["border-gray-100", "border-muted"],

  // Blue (accent/info)
  ["bg-blue-600", "bg-accent"],
  ["bg-blue-700", "bg-accent-hover"],
  ["bg-blue-100", "bg-info or bg-cat-knowledge"],
  ["bg-blue-50", "bg-info"],
  ["text-blue-600", "text-accent or text-info"],
  ["text-blue-800", "text-info or text-cat-knowledge"],
  ["ring-blue-500", "ring-accent"],
  ["border-blue-500", "border-accent"],

  // Red (error)
  ["bg-red-50", "bg-error"],
  ["bg-red-100", "bg-error"],
  ["bg-red-200", "bg-error"],
  ["bg-red-900", "bg-error (dark mode)"],
  ["text-red-700", "text-error"],
  ["text-red-800", "text-error"],
  ["text-red-500", "text-error"],
  ["text-red-400", "text-error"],
  ["border-red-200", "border-error"],

  // Yellow/Amber (warning/highlight)
  ["bg-yellow-50", "bg-warning or bg-highlight"],
  ["bg-yellow-100", "bg-highlight"],
  ["text-yellow-800", "text-warning or text-highlight"],
  ["text-yellow-700", "text-warning"],
  ["border-yellow-200", "border-warning or border-highlight"],

  // Green (success)
  ["bg-green-50", "bg-success"],
  ["bg-green-100", "bg-success"],
  ["text-green-700", "text-success"],
  ["text-green-800", "text-success"],
  ["border-green-200", "border-success"],
  ["hover:bg-green-200", "hover-bg-success"],
  ["hover:bg-red-200", "hover-bg-error"],

  // Purple (creative/brand - should use accent)
  ["bg-purple-100", "bg-cat-creative or bg-accent-light"],
  ["text-purple-800", "text-cat-creative or text-accent"],

  // Pink (entertainment)
  ["bg-pink-100", "bg-cat-entertainment"],
  ["text-pink-800", "text-cat-entertainment"],

  // Amber (similar to yellow)
  ["bg-amber-100", "bg-highlight"],
  ["text-amber-800", "text-highlight"],

  // Indigo (similar to blue/knowledge)
  ["bg-indigo-100", "bg-cat-knowledge or bg-info"],
  ["text-indigo-800", "text-cat-knowledge or text-info"],
]);

// Directories to scan
const INCLUDE_DIRS = ["src"];
const INCLUDE_EXTENSIONS = [".tsx", ".jsx"];
const EXCLUDE_PATTERNS = ["node_modules", ".next", "_generated"];

function shouldExclude(filePath: string): boolean {
  return EXCLUDE_PATTERNS.some((pattern) => filePath.includes(pattern));
}

function getFiles(dir: string): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);

      if (shouldExclude(fullPath)) continue;

      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...getFiles(fullPath));
      } else if (INCLUDE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return files;
}

function isAllowed(colorClass: string): boolean {
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(colorClass));
}

function getSuggestion(match: string): string {
  return SUGGESTIONS.get(match) || "Use a semantic token from globals.css";
}

function scanFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Check for raw Tailwind colors
    RAW_COLOR_PATTERN.lastIndex = 0;
    let match;
    while ((match = RAW_COLOR_PATTERN.exec(line)) !== null) {
      const colorClass = match[0];
      if (!isAllowed(colorClass)) {
        violations.push({
          file: relative(process.cwd(), filePath),
          line: i + 1,
          match: colorClass,
          suggestion: getSuggestion(colorClass),
          type: "raw-color",
        });
      }
    }

    // Check for direct brand color usage
    BRAND_COLOR_PATTERN.lastIndex = 0;
    while ((match = BRAND_COLOR_PATTERN.exec(line)) !== null) {
      violations.push({
        file: relative(process.cwd(), filePath),
        line: i + 1,
        match: match[0],
        suggestion: "Use semantic token (bg-accent, text-accent, etc.)",
        type: "raw-color",
      });
    }

    // Check for elements missing required background colors
    for (const pattern of NEEDS_BG_PATTERNS) {
      pattern.lastIndex = 0;
      while ((match = pattern.exec(line)) !== null) {
        const className = match[1];
        if (className && !HAS_BG_PATTERN.test(className)) {
          // Determine element type for better messaging
          let elementType = "element";
          if (line.includes("<button") || line.includes('type="submit"')) {
            elementType = "button";
          } else if (line.includes("<input")) {
            elementType = "input";
          } else if (line.includes("<textarea")) {
            elementType = "textarea";
          } else if (line.includes("<select")) {
            elementType = "select";
          }

          violations.push({
            file: relative(process.cwd(), filePath),
            line: i + 1,
            match: `<${elementType}> missing background`,
            suggestion:
              elementType === "button"
                ? "Add bg-accent or bg-surface"
                : "Add bg-input or bg-surface",
            type: "missing-color",
          });
        }
      }
    }

    // Check for card-like elements missing background
    CARD_PATTERN.lastIndex = 0;
    while ((match = CARD_PATTERN.exec(line)) !== null) {
      const className = match[1];
      if (className && !HAS_BG_PATTERN.test(className)) {
        violations.push({
          file: relative(process.cwd(), filePath),
          line: i + 1,
          match: "card/surface missing background",
          suggestion: "Add bg-surface or bg-surface-secondary",
          type: "missing-color",
        });
      }
    }
  }

  return violations;
}

// ============================================
// SELF-VALIDATION
// Ensure our suggestions only recommend valid tokens
// ============================================
function validateSuggestions(): void {
  const validTokens = new Set([
    // Background tokens
    "bg-page",
    "bg-surface",
    "bg-surface-secondary",
    "bg-input",
    "bg-accent",
    "bg-accent-hover",
    "bg-accent-light",
    "bg-error",
    "bg-warning",
    "bg-success",
    "bg-info",
    "bg-highlight",
    "bg-transparent",
    "bg-white",
    "bg-black",
    // Content category backgrounds
    "bg-cat-entertainment",
    "bg-cat-knowledge",
    "bg-cat-creative",
    "bg-cat-neutral",
    // Component backgrounds
    "bg-tag",
    "bg-skeleton",
    "bg-skeleton-shine",
    "bg-overlay",
    "bg-disabled",
    // Text tokens
    "text-primary",
    "text-secondary",
    "text-muted",
    "text-accent",
    "text-on-accent",
    "text-error",
    "text-warning",
    "text-success",
    "text-info",
    "text-highlight",
    "text-inherit",
    "text-current",
    "text-white",
    "text-black",
    // Content category text
    "text-cat-entertainment",
    "text-cat-knowledge",
    "text-cat-creative",
    "text-cat-neutral",
    // Component text
    "text-tag",
    "text-disabled",
    // Border tokens
    "border-default",
    "border-muted",
    "border-input",
    "border-accent",
    "border-error",
    "border-warning",
    "border-success",
    "border-info",
    "border-highlight",
    "border-transparent",
    "border-current",
    // Content category borders
    "border-cat-entertainment",
    "border-cat-knowledge",
    "border-cat-creative",
    "border-cat-neutral",
    // Component borders
    "border-tag",
    "border-disabled",
    // Ring/outline tokens
    "ring-accent",
    "outline-accent",
    // Placeholder tokens
    "placeholder:text-muted",
    "placeholder-muted",
    // Hover utilities
    "hover-bg-accent",
    "hover-bg-surface-secondary",
    "hover-bg-success",
    "hover-bg-error",
  ]);

  const errors: string[] = [];

  for (const [violation, suggestion] of SUGGESTIONS) {
    // Extract token names from suggestion (may have multiple options like "bg-page or bg-surface")
    const tokens =
      suggestion.match(/\b(bg|text|border|ring|outline|placeholder)[a-z-]*/g) ||
      [];

    for (const token of tokens) {
      if (!validTokens.has(token) && !token.includes("opacity")) {
        errors.push(
          `SUGGESTIONS["${violation}"] recommends invalid token: "${token}"`
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error("❌ SELF-VALIDATION FAILED\n");
    console.error("The audit script recommends invalid tokens:\n");
    for (const err of errors) {
      console.error(`   ${err}`);
    }
    console.error("\nFix SUGGESTIONS map in audit-colors.ts\n");
    process.exit(1);
  }
}

function main(): void {
  // Validate ourselves first
  validateSuggestions();

  console.log("🎨 Color Audit - Design System Enforcement\n");

  const allFiles: string[] = [];
  for (const dir of INCLUDE_DIRS) {
    allFiles.push(...getFiles(dir));
  }

  console.log(`Scanning ${allFiles.length} component files...\n`);

  const allViolations: Violation[] = [];
  for (const file of allFiles) {
    allViolations.push(...scanFile(file));
  }

  if (allViolations.length === 0) {
    console.log("✅ All components use semantic design tokens\n");
    process.exit(0);
  }

  // Group by file
  const byFile = new Map<string, Violation[]>();
  for (const v of allViolations) {
    const existing = byFile.get(v.file) || [];
    existing.push(v);
    byFile.set(v.file, existing);
  }

  // Separate by type
  const rawColorViolations = allViolations.filter(
    (v) => v.type === "raw-color"
  );
  const missingColorViolations = allViolations.filter(
    (v) => v.type === "missing-color"
  );

  if (rawColorViolations.length > 0) {
    console.log("🎨 RAW COLOR VIOLATIONS (use semantic tokens instead)\n");
    const byFileRaw = new Map<string, Violation[]>();
    for (const v of rawColorViolations) {
      const existing = byFileRaw.get(v.file) || [];
      existing.push(v);
      byFileRaw.set(v.file, existing);
    }
    for (const [file, violations] of byFileRaw) {
      console.log(`📄 ${file}`);
      for (const v of violations) {
        console.log(`   Line ${v.line}: ${v.match}`);
        console.log(`   └─ Use: ${v.suggestion}`);
      }
      console.log("");
    }
  }

  if (missingColorViolations.length > 0) {
    console.log("⚠️  MISSING COLOR DEFINITIONS\n");
    const byFileMissing = new Map<string, Violation[]>();
    for (const v of missingColorViolations) {
      const existing = byFileMissing.get(v.file) || [];
      existing.push(v);
      byFileMissing.set(v.file, existing);
    }
    for (const [file, violations] of byFileMissing) {
      console.log(`📄 ${file}`);
      for (const v of violations) {
        console.log(`   Line ${v.line}: ${v.match}`);
        console.log(`   └─ Fix: ${v.suggestion}`);
      }
      console.log("");
    }
  }

  console.log("─".repeat(50));
  console.log(
    `Found: ${rawColorViolations.length} raw colors, ${missingColorViolations.length} missing colors\n`
  );

  console.log("To fix: Replace raw Tailwind colors with semantic tokens.");
  console.log("See: src/app/globals.css for available tokens.\n");

  // Check for strict mode (CI enforcement)
  const isStrict = process.argv.includes("--strict");
  const totalViolations =
    rawColorViolations.length + missingColorViolations.length;

  if (isStrict && totalViolations > 0) {
    console.log("❌ Strict mode: Failing due to design system violations.\n");
    console.log("To bypass during migration, remove --strict flag or use:");
    console.log('  git commit -m "your message [skip-color-audit]"\n');
    process.exit(1);
  }

  console.log("⚠️  Warning mode: Violations found but not blocking.\n");
  console.log("Run with --strict to enforce (used in CI).\n");
  process.exit(0);
}

main();
