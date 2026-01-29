/**
 * ESLint violation detection for hardcoded strings.
 *
 * Runs eslint-plugin-i18next's no-literal-string rule and parses JSON output.
 * See ADR-004 §8 (Gating Strategy)
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ── Types ──────────────────────────────────────────────────────────

export interface Violation {
  file: string;
  line: number;
  column: number;
  literal: string;
}

interface ESLintMessage {
  ruleId: string | null;
  message: string;
  line: number;
  column: number;
}

interface ESLintFileResult {
  filePath: string;
  messages: ESLintMessage[];
}

// ── Core ───────────────────────────────────────────────────────────

/**
 * Find all hardcoded string violations via ESLint.
 * @param targetFile Optional specific file to scan (otherwise scans src/components/** and src/app/**)
 */
export function findViolations(targetFile?: string): Violation[] {
  const targets = targetFile ? [targetFile] : ["src/components/", "src/app/"];

  const targetArgs = targets.map((t) => `"${t}"`).join(" ");

  let output: string;
  try {
    output = execSync(
      `npx eslint --format json --no-error-on-unmatched-pattern --rule "i18next/no-literal-string:warn" ${targetArgs}`,
      {
        cwd: path.resolve(__dirname, "..", ".."),
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
  } catch (err: unknown) {
    // ESLint exits 1 when violations found — that's expected
    const execErr = err as { stdout?: string; status?: number };
    if (execErr.stdout && execErr.status === 1) {
      output = execErr.stdout;
    } else {
      throw err;
    }
  }

  let results: ESLintFileResult[];
  try {
    results = JSON.parse(output) as ESLintFileResult[];
  } catch {
    throw new Error(
      `Failed to parse ESLint JSON output:\n${output.slice(0, 500)}`
    );
  }

  const violations: Violation[] = [];

  for (const file of results) {
    for (const msg of file.messages) {
      if (msg.ruleId !== "i18next/no-literal-string") continue;

      // Extract the literal from source rather than parsing the ESLint message.
      // The rule fires on JSX text nodes — read the source at the reported
      // line/column and collect text content between JSX tags.
      const literal = extractLiteralFromSource(
        file.filePath,
        msg.line,
        msg.column
      );

      if (!literal) continue; // Skip if we can't extract a meaningful string

      violations.push({
        file: path.relative(path.resolve(__dirname, "..", ".."), file.filePath),
        line: msg.line,
        column: msg.column,
        literal,
      });
    }
  }

  return violations;
}

// ── Source extraction ──────────────────────────────────────────────

/** File content cache to avoid repeated reads */
const sourceCache = new Map<string, string[]>();

function getSourceLines(absPath: string): string[] {
  let lines = sourceCache.get(absPath);
  if (!lines) {
    try {
      lines = fs.readFileSync(absPath, "utf-8").split("\n");
    } catch {
      lines = [];
    }
    sourceCache.set(absPath, lines);
  }
  return lines;
}

/**
 * Read source at the ESLint-reported position and extract the text content.
 *
 * The i18next/no-literal-string rule fires at the start of a JSX element
 * containing literal text. We read from that line forward, collect all text
 * between JSX tags, and return the collapsed result.
 */
function extractLiteralFromSource(
  filePath: string,
  line: number,
  _column: number
): string | null {
  const lines = getSourceLines(filePath);
  if (lines.length === 0) return null;

  // The ESLint rule fires at the opening tag of a JSX element with literal text.
  // Strategy: collect lines from the violation until we hit the matching closing tag,
  // then extract only the text nodes between tags.
  const startIdx = line - 1;
  let collected = "";
  let depth = 0;

  for (let i = startIdx; i < Math.min(startIdx + 10, lines.length); i++) {
    const ln = lines[i] ?? "";
    collected += ln + "\n";

    // Track tag depth to find the end of the element
    // Count opening tags (not self-closing)
    const opens = (ln.match(/<[a-zA-Z][^>]*(?<!\/)\s*>/g) ?? []).length;
    const closes = (ln.match(/<\/[a-zA-Z][^>]*>/g) ?? []).length;
    const selfClose = (ln.match(/<[a-zA-Z][^>]*\/\s*>/g) ?? []).length;
    depth += opens - selfClose - closes;

    // If the element is closed (or we're past it), stop collecting
    if (i > startIdx && depth <= 0) break;
  }

  // Extract text between tags: split on tag boundaries, keep non-tag parts
  const fragments = collected
    .split(/<[^>]*>/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Filter out anything that looks like code/attributes rather than display text
  const textFragments = fragments.filter(
    (f) =>
      !f.includes("className=") &&
      !f.includes("htmlFor=") &&
      !f.startsWith("{") &&
      !f.startsWith("//") &&
      !/^[a-z]+={/.test(f)
  );

  const text = textFragments.join(" ").replace(/\s+/g, " ").trim();
  if (!text || text.length < 2) return null;
  return text;
}

// ── Context ────────────────────────────────────────────────────────

/**
 * Returns ±N lines of source context around a given line.
 */
export function getFileContext(
  file: string,
  line: number,
  surrounding: number = 3
): { lineNumber: number; text: string; isCurrent: boolean }[] {
  const absPath = path.isAbsolute(file)
    ? file
    : path.resolve(__dirname, "..", "..", file);

  let content: string;
  try {
    content = fs.readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.split("\n");
  const start = Math.max(0, line - 1 - surrounding);
  const end = Math.min(lines.length, line + surrounding);
  const result: { lineNumber: number; text: string; isCurrent: boolean }[] = [];

  for (let i = start; i < end; i++) {
    result.push({
      lineNumber: i + 1,
      text: lines[i] ?? "",
      isCurrent: i + 1 === line,
    });
  }

  return result;
}
