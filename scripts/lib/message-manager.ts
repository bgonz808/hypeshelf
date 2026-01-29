/**
 * Atomic JSON operations for i18n message files and provenance tracking.
 *
 * Loads all messages/*.json + i18n-status.json into memory, provides
 * dot-path setters, and flushes with sorted keys for minimal diffs.
 *
 * Integrity features:
 *   - Content hash (SHA-256 prefix) stored in each provenance entry.
 *     Detects when a translation value changed without provenance update.
 *   - Atomic flush: write to .tmp sibling, then rename. On Windows,
 *     rename is best-effort (not truly atomic across volumes), but git
 *     provides the safety net for tracked files.
 *
 * See ADR-004 §7 (Provenance Tracking)
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as os from "os";

// ── Types ──────────────────────────────────────────────────────────

export interface ProvenanceEntry {
  method: "authored" | "machine" | "machine-needs-review" | "reviewed";
  engine?: string;
  source?: string;
  date: string;
  contentHash?: string;
}

type NestedRecord = { [key: string]: string | NestedRecord };

// ── Helpers ────────────────────────────────────────────────────────

function setNestedValue(
  obj: NestedRecord,
  dotPath: string,
  value: string
): void {
  const parts = dotPath.split(".");
  let current: NestedRecord = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as NestedRecord;
  }

  const lastKey = parts[parts.length - 1]!;
  current[lastKey] = value;
}

function sortKeysDeep(obj: NestedRecord): NestedRecord {
  const sorted: NestedRecord = {};
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      sorted[key] = sortKeysDeep(val as NestedRecord);
    } else {
      sorted[key] = val as string;
    }
  }
  return sorted;
}

/**
 * SHA-256 content hash (first 12 hex chars = 48 bits).
 * Used to detect provenance drift: if the translation value changes
 * but provenance is not updated, the hash won't match.
 */
export function contentHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Write content to a file atomically: write to a temp sibling,
 * then rename over the target. On POSIX this is atomic for same-volume.
 * On Windows, fs.renameSync is best-effort (not atomic across volumes),
 * but git provides the safety net for tracked files.
 */
function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);

  // Temp file in the same directory to ensure same filesystem/volume
  const tmpPath = path.join(dir, `.${base}.${process.pid}.tmp`);

  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (renameErr) {
    // Windows fallback: rename can fail if target is open.
    // Fall back to direct write; git history is the safety net.
    if (os.platform() === "win32") {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // tmp cleanup best-effort
      }
      fs.writeFileSync(filePath, content);
    } else {
      throw renameErr;
    }
  }
}

// ── Message File Manager ───────────────────────────────────────────

const MESSAGES_DIR = path.resolve(__dirname, "..", "..", "messages");
const STATUS_FILE = path.resolve(__dirname, "..", "..", "i18n-status.json");

const LOCALES = ["en", "es", "zh", "ar", "yi"];

export class MessageFileManager {
  private messages: Map<string, NestedRecord> = new Map();
  private status: Record<string, Record<string, ProvenanceEntry>> = {};
  private modified: Set<string> = new Set();
  private statusModified = false;

  constructor() {
    this.load();
  }

  private load(): void {
    for (const locale of LOCALES) {
      const filePath = path.join(MESSAGES_DIR, `${locale}.json`);
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        this.messages.set(locale, JSON.parse(raw) as NestedRecord);
      } catch {
        this.messages.set(locale, {});
      }
    }

    try {
      const raw = fs.readFileSync(STATUS_FILE, "utf-8");
      this.status = JSON.parse(raw) as Record<
        string,
        Record<string, ProvenanceEntry>
      >;
    } catch {
      this.status = {};
    }
  }

  /**
   * Set a message value for a locale at a dot-path key.
   */
  setMessage(locale: string, key: string, value: string): void {
    const msgs = this.messages.get(locale);
    if (!msgs) throw new Error(`Unknown locale: ${locale}`);
    setNestedValue(msgs, key, value);
    this.modified.add(locale);
  }

  /**
   * Set provenance tracking for a locale/key.
   * Automatically computes and stores a content hash of the translation
   * value so drift can be detected later.
   */
  setProvenance(
    locale: string,
    key: string,
    entry: ProvenanceEntry,
    translationValue?: string
  ): void {
    if (!this.status[key]) {
      this.status[key] = {};
    }

    // Attach content hash if a value was provided
    if (translationValue !== undefined) {
      entry.contentHash = contentHash(translationValue);
    }

    this.status[key]![locale] = entry;
    this.statusModified = true;
  }

  /**
   * Check if a key already exists in a locale.
   */
  hasKey(locale: string, key: string): boolean {
    const msgs = this.messages.get(locale);
    if (!msgs) return false;
    const parts = key.split(".");
    let current: NestedRecord | string = msgs;
    for (const part of parts) {
      if (typeof current !== "object" || current === null) return false;
      current = (current as NestedRecord)[part] as NestedRecord | string;
      if (current === undefined) return false;
    }
    return true;
  }

  /**
   * Write all modified files atomically (sorted keys for minimal diffs).
   *
   * Strategy: write to temp sibling (.filename.pid.tmp) then rename.
   * On rename failure (Windows edge cases), falls back to direct write.
   * Git history is the ultimate safety net for tracked files.
   */
  flush(): { written: string[] } {
    const written: string[] = [];

    for (const locale of this.modified) {
      const msgs = this.messages.get(locale);
      if (!msgs) continue;
      const sorted = sortKeysDeep(msgs);
      const filePath = path.join(MESSAGES_DIR, `${locale}.json`);
      atomicWriteFileSync(filePath, JSON.stringify(sorted, null, 2) + "\n");
      written.push(filePath);
    }

    if (this.statusModified) {
      // Sort status keys too
      const sortedStatus: Record<string, Record<string, ProvenanceEntry>> = {};
      for (const key of Object.keys(this.status).sort()) {
        sortedStatus[key] = this.status[key]!;
      }
      atomicWriteFileSync(
        STATUS_FILE,
        JSON.stringify(sortedStatus, null, 2) + "\n"
      );
      written.push(STATUS_FILE);
    }

    this.modified.clear();
    this.statusModified = false;
    return { written };
  }
}
