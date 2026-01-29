/**
 * Atomic JSON operations for i18n message files and provenance tracking.
 *
 * Message files (messages/*.json): loaded into memory, written atomically
 * via temp-file + rename. Sorted keys for minimal git diffs.
 *
 * Provenance (i18n-status.jsonl): append-only JSONL. Each line is a
 * self-contained JSON record. On read, last-write-wins for duplicate
 * (key, locale) pairs. On write, new records are appended — a crash
 * can only lose the incomplete last line, never corrupt prior records.
 *
 * Integrity features:
 *   - Content hash (SHA-256 prefix) stored in each provenance record.
 *     Detects when a translation value changed without provenance update.
 *   - Atomic flush for message JSON: write to .tmp sibling, then rename.
 *     On Windows, rename is best-effort; git is the safety net.
 *   - Append-only for provenance JSONL: inherently crash-safe.
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
  /** What happened: created, updated, reviewed, audited */
  lifecycleAction?: "created" | "updated" | "reviewed" | "audited";
  /** When it happened — always UTC ISO-8601 (Z suffix) */
  lifecycleAt?: string;
}

/** On-disk JSONL record: provenance entry + routing fields */
export interface ProvenanceRecord extends ProvenanceEntry {
  key: string;
  locale: string;
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
 * UTC date as YYYY-MM-DD. Derived from Date.toISOString() which is
 * spec-guaranteed to return YYYY-MM-DDTHH:mm:ss.sssZ (24 chars).
 */
export function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * UTC timestamp as full ISO-8601 with Z suffix.
 */
export function utcTimestamp(): string {
  return new Date().toISOString();
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

// ── JSONL Provenance Store ─────────────────────────────────────────

const STATUS_FILE = path.resolve(__dirname, "..", "..", "i18n-status.jsonl");

/**
 * Read all provenance records from JSONL. Last-write-wins for
 * duplicate (key, locale) pairs, which is how append-only updates work.
 */
export function loadProvenance(): Map<string, Map<string, ProvenanceEntry>> {
  const result = new Map<string, Map<string, ProvenanceEntry>>();

  let raw: string;
  try {
    raw = fs.readFileSync(STATUS_FILE, "utf-8");
  } catch {
    return result;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue; // skip blank/comment

    let record: ProvenanceRecord;
    try {
      record = JSON.parse(trimmed) as ProvenanceRecord;
    } catch {
      continue; // skip malformed lines (crash residue)
    }

    if (!record.key || !record.locale) continue;

    let keyMap = result.get(record.key);
    if (!keyMap) {
      keyMap = new Map();
      result.set(record.key, keyMap);
    }

    // Strip routing fields before storing as entry
    const { key: _k, locale: _l, ...entry } = record;
    keyMap.set(record.locale, entry);
  }

  return result;
}

/**
 * Append provenance records to the JSONL file.
 * Each record is one complete JSON line — append-only, crash-safe.
 */
function appendProvenance(records: ProvenanceRecord[]): void {
  if (records.length === 0) return;
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.appendFileSync(STATUS_FILE, lines);
}

// ── Message File Manager ───────────────────────────────────────────

const MESSAGES_DIR = path.resolve(__dirname, "..", "..", "messages");

const LOCALES = ["en", "es", "zh", "ar", "yi"];

export class MessageFileManager {
  private messages: Map<string, NestedRecord> = new Map();
  private provenance: Map<string, Map<string, ProvenanceEntry>>;
  private modified: Set<string> = new Set();
  private pendingProvenance: ProvenanceRecord[] = [];

  constructor() {
    this.provenance = loadProvenance();
    this.loadMessages();
  }

  private loadMessages(): void {
    for (const locale of LOCALES) {
      const filePath = path.join(MESSAGES_DIR, `${locale}.json`);
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        this.messages.set(locale, JSON.parse(raw) as NestedRecord);
      } catch {
        this.messages.set(locale, {});
      }
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
   * Queue a provenance record for append on flush.
   * Automatically computes content hash if translationValue is provided.
   * Stamps timestamp (ISO-8601) and infers action (added vs updated)
   * if not explicitly set.
   */
  setProvenance(
    locale: string,
    key: string,
    entry: ProvenanceEntry,
    translationValue?: string
  ): void {
    if (translationValue !== undefined) {
      entry.contentHash = contentHash(translationValue);
    }

    // Auto-stamp UTC timestamp
    if (!entry.lifecycleAt) {
      entry.lifecycleAt = utcTimestamp();
    }

    // Infer lifecycle action: if a record already exists for this (key, locale), it's an update
    if (!entry.lifecycleAction) {
      const existing = this.provenance.get(key)?.get(locale);
      entry.lifecycleAction = existing ? "updated" : "created";
    }

    // Update in-memory state (last-write-wins)
    let keyMap = this.provenance.get(key);
    if (!keyMap) {
      keyMap = new Map();
      this.provenance.set(key, keyMap);
    }
    keyMap.set(locale, entry);

    // Queue for append
    this.pendingProvenance.push({ key, locale, ...entry });
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
   * Write all modified message files (atomic rename) and append
   * provenance records (JSONL append — crash-safe by design).
   */
  flush(): { written: string[] } {
    const written: string[] = [];

    // Message files: atomic write via temp + rename
    for (const locale of this.modified) {
      const msgs = this.messages.get(locale);
      if (!msgs) continue;
      const sorted = sortKeysDeep(msgs);
      const filePath = path.join(MESSAGES_DIR, `${locale}.json`);
      atomicWriteFileSync(filePath, JSON.stringify(sorted, null, 2) + "\n");
      written.push(filePath);
    }

    // Provenance: append-only JSONL
    if (this.pendingProvenance.length > 0) {
      appendProvenance(this.pendingProvenance);
      written.push(STATUS_FILE);
      this.pendingProvenance = [];
    }

    this.modified.clear();
    return { written };
  }
}
