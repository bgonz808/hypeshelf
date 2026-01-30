/**
 * NLLB API key generator.
 *
 * Generates a 32-byte random hex token and writes it to
 * `.docker-volumes/nllb-api-key`. Creates the directory if needed.
 *
 * Usage:
 *   npx tsx scripts/lib/nllb-keygen.ts          # generate if missing
 *   npx tsx scripts/lib/nllb-keygen.ts --force   # regenerate unconditionally
 *
 * Also exported for programmatic use by the batch translator.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const KEY_LENGTH_BYTES = 32;

/** Resolve the path to the API key file */
export function getKeyFilePath(): string {
  return path.resolve(__dirname, "..", "..", ".docker-volumes", "nllb-api-key");
}

/**
 * Ensure an API key file exists. Returns the key contents.
 * If `force` is true, regenerates even if the file already exists.
 */
export function ensureApiKey(force = false): string {
  const keyPath = getKeyFilePath();

  if (!force && fs.existsSync(keyPath)) {
    const existing = fs.readFileSync(keyPath, "utf-8").trim();
    if (existing.length > 0) return existing;
  }

  const key = crypto.randomBytes(KEY_LENGTH_BYTES).toString("hex");
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, key + "\n", { mode: 0o600 });
  console.log(
    `  NLLB API key written to ${path.relative(process.cwd(), keyPath)}`
  );
  return key;
}

/** Read the API key, or null if the file doesn't exist */
export function readApiKey(): string | null {
  const keyPath = getKeyFilePath();
  try {
    const key = fs.readFileSync(keyPath, "utf-8").trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

// ── CLI entry point ─────────────────────────────────────────────────
if (require.main === module) {
  const force = process.argv.includes("--force");
  const key = ensureApiKey(force);
  console.log(
    `  Key (${KEY_LENGTH_BYTES * 2} hex chars): ${key.slice(0, 8)}...`
  );
}
