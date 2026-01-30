/**
 * AES-256-GCM encryption for provider API keys stored in Convex.
 *
 * Format: base64(iv):base64(ciphertext):base64(authTag)
 * - 16-byte random IV per encryption (unique ciphertext every time)
 * - GCM provides authenticated encryption (tamper detection)
 *
 * PROVIDER_ENCRYPTION_KEY env var: 32-byte hex string (64 hex chars)
 */

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.PROVIDER_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "PROVIDER_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)"
    );
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    encrypted.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
}

export function decrypt(token: string): string {
  const key = getKey();
  const parts = token.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }
  const [ivB64, ciphertextB64, authTagB64] = parts as [string, string, string];

  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
