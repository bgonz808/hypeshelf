#!/usr/bin/env npx tsx
/**
 * Lightweight Security Pattern Scanner
 *
 * Replaces eslint-plugin-security without the dependency baggage.
 * Scans for common security anti-patterns in TypeScript/JavaScript.
 *
 * Run: npm run security:check
 * Runs automatically in pre-commit hook.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

interface Finding {
  file: string;
  line: number;
  pattern: string;
  code: string;
  severity: "error" | "warn";
}

interface Pattern {
  name: string;
  regex: RegExp;
  severity: "error" | "warn";
  description: string;
  falsePositiveHints?: string[];
}

// Patterns to detect
const PATTERNS: Pattern[] = [
  {
    name: "object-injection",
    // Matches obj[variable] but not obj['literal'] or obj[0]
    regex: /\[\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\]/g,
    severity: "warn",
    description: "Potential object injection (prototype pollution)",
    falsePositiveHints: [
      "Array index loops (for i in arr) are usually fine",
      "Known-safe keys from typed sources are fine",
      "Consider: Object.hasOwn() check, or Map instead of object",
    ],
  },
  {
    name: "non-literal-regexp",
    // Matches new RegExp(variable) but not new RegExp('literal')
    regex: /new\s+RegExp\s*\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*(?:\s*[,)])/g,
    severity: "warn",
    description: "Non-literal RegExp (potential ReDoS)",
    falsePositiveHints: [
      "Sanitize input with escapeRegExp() before use",
      "Consider string methods instead: includes(), startsWith()",
    ],
  },
  {
    name: "eval-usage",
    regex: /\beval\s*\(/g,
    severity: "error",
    description: "eval() usage (code injection risk)",
    falsePositiveHints: ["There is almost never a good reason to use eval()"],
  },
  {
    name: "function-constructor",
    regex: /new\s+Function\s*\(/g,
    severity: "error",
    description: "Function constructor (equivalent to eval)",
    falsePositiveHints: ["Avoid dynamic code generation"],
  },
  {
    name: "innerhtml-assignment",
    regex: /\.innerHTML\s*=/g,
    severity: "warn",
    description: "innerHTML assignment (XSS risk)",
    falsePositiveHints: [
      "Use textContent for text, or sanitize HTML",
      "React handles this safely - check if this is in raw DOM code",
    ],
  },
  {
    name: "document-write",
    regex: /document\.write\s*\(/g,
    severity: "error",
    description: "document.write() (XSS risk, blocks parsing)",
    falsePositiveHints: ["Use DOM methods instead"],
  },
];

// Directories/files to scan
const INCLUDE_DIRS = ["src", "convex", "scripts"];
const INCLUDE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const EXCLUDE_PATTERNS = [
  "node_modules",
  ".next",
  "_generated",
  "*.test.*",
  "*.spec.*",
  "security-check.ts", // Don't flag ourselves
];

function shouldExclude(filePath: string): boolean {
  return EXCLUDE_PATTERNS.some((pattern) => {
    if (pattern.includes("*")) {
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      return regex.test(filePath);
    }
    return filePath.includes(pattern);
  });
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
    // Directory doesn't exist, skip
  }

  return files;
}

function scanFile(filePath: string): Finding[] {
  const findings: Finding[] = [];
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Skip comments and TypeScript type declarations (no runtime code)
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (trimmed.startsWith("type ") || trimmed.startsWith("interface "))
      continue;

    for (const pattern of PATTERNS) {
      // Reset regex state
      pattern.regex.lastIndex = 0;

      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        // Additional filtering for object-injection to reduce false positives
        if (pattern.name === "object-injection") {
          const matchText = match[0];
          // Skip common safe patterns
          if (
            /\[\s*i\s*\]/.test(matchText) || // [i] loop index
            /\[\s*index\s*\]/.test(matchText) || // [index]
            /\[\s*key\s*\]/.test(matchText) || // [key] in Object.keys loop
            /\[\s*id\s*\]/.test(matchText) || // [id] common pattern
            /\[\s*0\s*\]/.test(matchText) // [0] array access
          ) {
            continue;
          }
        }

        findings.push({
          file: relative(process.cwd(), filePath),
          line: i + 1,
          pattern: pattern.name,
          code: line.trim().substring(0, 80),
          severity: pattern.severity,
        });
      }
    }
  }

  return findings;
}

function main(): void {
  console.log("🔒 Security Pattern Scanner\n");

  const allFiles: string[] = [];
  for (const dir of INCLUDE_DIRS) {
    allFiles.push(...getFiles(dir));
  }

  console.log(`Scanning ${allFiles.length} files...\n`);

  const allFindings: Finding[] = [];
  for (const file of allFiles) {
    allFindings.push(...scanFile(file));
  }

  if (allFindings.length === 0) {
    console.log("✅ No security issues detected\n");
    process.exit(0);
  }

  // Group by severity
  const errors = allFindings.filter((f) => f.severity === "error");
  const warnings = allFindings.filter((f) => f.severity === "warn");

  // Print findings
  for (const finding of allFindings) {
    const icon = finding.severity === "error" ? "❌" : "⚠️";
    console.log(`${icon} ${finding.file}:${finding.line}`);
    console.log(`   Pattern: ${finding.pattern}`);
    console.log(`   Code: ${finding.code}`);

    const pattern = PATTERNS.find((p) => p.name === finding.pattern);
    if (pattern) {
      console.log(`   Risk: ${pattern.description}`);
    }
    console.log("");
  }

  // Summary
  console.log("─".repeat(50));
  console.log(`Found: ${errors.length} errors, ${warnings.length} warnings\n`);

  if (errors.length > 0) {
    console.log("❌ Security check failed (errors must be fixed)\n");
    console.log("To bypass (use sparingly): git commit --no-verify\n");
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log("⚠️  Security check passed with warnings");
    console.log("   Review warnings to ensure they are false positives\n");
  }

  process.exit(0);
}

main();
