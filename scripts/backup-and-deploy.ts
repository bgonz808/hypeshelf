#!/usr/bin/env npx tsx
/**
 * Backup and Deploy Script
 *
 * Creates a traceable backup of production Convex data before deploying.
 * Backup filename includes commit hash and dirty status for traceability.
 *
 * Filename format: prod-{commitHash}-{clean|dirty}-{timestamp}.zip
 *   - commitHash: short git commit ID
 *   - clean/dirty: whether working directory had uncommitted changes
 *   - timestamp: YYYYMMDD_HHMMSS
 *
 * Usage:
 *   npm run deploy:safe        # Backup prod, then deploy
 *   npm run backup:prod        # Just backup, no deploy
 *
 * Restore:
 *   npx convex import --prod ./backups/prod-abc123-clean-20260123_191500.zip
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";

const BACKUPS_DIR = join(process.cwd(), "backups");
const MAX_BACKUPS = 5; // Keep last 5 backups, delete older ones

function timestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
}

function getGitInfo(): { commitHash: string; isDirty: boolean } {
  try {
    // Get short commit hash
    const commitHash = execSync("git rev-parse --short HEAD", {
      encoding: "utf-8",
    }).trim();

    // Check if working directory is dirty
    const status = execSync("git status --porcelain", {
      encoding: "utf-8",
    }).trim();
    const isDirty = status.length > 0;

    return { commitHash, isDirty };
  } catch {
    // Not a git repo or git not available
    return { commitHash: "unknown", isDirty: false };
  }
}

function generateBackupFilename(): string {
  const { commitHash, isDirty } = getGitInfo();
  const status = isDirty ? "dirty" : "clean";
  const ts = timestamp();
  return `prod-${commitHash}-${status}-${ts}.zip`;
}

function ensureBackupsDir(): void {
  if (!existsSync(BACKUPS_DIR)) {
    mkdirSync(BACKUPS_DIR, { recursive: true });
    console.log(`📁 Created backups directory: ${BACKUPS_DIR}`);
  }
}

function cleanOldBackups(): void {
  const files = readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith("prod-") && f.endsWith(".zip"))
    .map((f) => ({
      name: f,
      path: join(BACKUPS_DIR, f),
      mtime: statSync(join(BACKUPS_DIR, f)).mtime,
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  if (files.length > MAX_BACKUPS) {
    const toDelete = files.slice(MAX_BACKUPS);
    for (const file of toDelete) {
      console.log(`🗑️  Deleting old backup: ${file.name}`);
      unlinkSync(file.path);
    }
  }
}

function backup(): string {
  ensureBackupsDir();

  const filename = generateBackupFilename();
  const filepath = join(BACKUPS_DIR, filename);

  const { commitHash, isDirty } = getGitInfo();

  console.log(`\n📦 Creating production backup...`);
  console.log(`   Commit:      ${commitHash}${isDirty ? " (dirty)" : ""}`);
  console.log(`   Destination: ${filepath}\n`);

  if (isDirty) {
    console.log(`⚠️  Warning: Working directory has uncommitted changes`);
    console.log(`   Consider committing before deploy for cleaner rollback\n`);
  }

  try {
    execSync(`npx convex export --prod --path "${filepath}"`, {
      stdio: "inherit",
    });
    console.log(`\n✅ Backup complete: ${filename}`);
    cleanOldBackups();
    return filepath;
  } catch (error) {
    console.error(`\n❌ Backup failed!`);
    process.exit(1);
  }
}

function deploy(): void {
  console.log(`\n🚀 Deploying to Convex production...\n`);

  try {
    execSync(`npx convex deploy -y`, { stdio: "inherit" });
    console.log(`\n✅ Deploy complete!`);
  } catch (error) {
    console.error(`\n❌ Deploy failed!`);
    console.log(
      `\n💡 To restore from backup, check ./backups/ for latest file:`
    );
    console.log(`   npx convex import --prod ./backups/<filename>.zip`);
    process.exit(1);
  }
}

// Main
const args = process.argv.slice(2);
const backupOnly = args.includes("--backup-only");

console.log("═".repeat(55));
console.log("  HypeShelf: Safe Deploy");
console.log("═".repeat(55));

const backupPath = backup();

if (backupOnly) {
  console.log(`\n📋 Backup-only mode. To deploy manually:`);
  console.log(`   npx convex deploy`);
  console.log(`\n📋 To restore if needed:`);
  console.log(`   npx convex import --prod "${backupPath}"`);
} else {
  deploy();
  console.log(`\n📋 If you need to rollback:`);
  console.log(`   npx convex import --prod "${backupPath}"`);
}

console.log("\n" + "═".repeat(55));
