#!/usr/bin/env npx tsx
/**
 * Pre-push version check hook
 *
 * Enforces semantic versioning based on conventional commits.
 * Blocks push if feat:/fix: commits exist without appropriate version bump.
 *
 * Bypass with: git push --no-verify (use sparingly)
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

interface VersionCheck {
  hasFeats: boolean;
  hasFixes: boolean;
  hasBreaking: boolean;
  commits: string[];
}

function run(cmd: string): string {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function getLastTag(): string | null {
  const tag = run("git describe --tags --abbrev=0 2>/dev/null");
  return tag || null;
}

function getCommitsSinceTag(tag: string | null): string[] {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const log = run(`git log ${range} --pretty=format:"%s"`);
  return log ? log.split("\n").filter(Boolean) : [];
}

function analyzeCommits(commits: string[]): VersionCheck {
  const result: VersionCheck = {
    hasFeats: false,
    hasFixes: false,
    hasBreaking: false,
    commits,
  };

  for (const msg of commits) {
    const lower = msg.toLowerCase();

    if (msg.includes("!:") || lower.includes("breaking change")) {
      result.hasBreaking = true;
    }

    if (/^feat(\(.+\))?!?:/.test(msg)) {
      result.hasFeats = true;
    }

    if (/^fix(\(.+\))?!?:/.test(msg)) {
      result.hasFixes = true;
    }
  }

  return result;
}

function getCurrentVersion(): string {
  const pkgPath = join(process.cwd(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

function getTagVersion(tag: string | null): string | null {
  if (!tag) return null;
  return tag.replace(/^v/, "");
}

function parseVersion(version: string): {
  major: number;
  minor: number;
  patch: number;
} {
  const [major, minor, patch] = version.split(".").map(Number);
  return { major: major ?? 0, minor: minor ?? 0, patch: patch ?? 0 };
}

function versionBumpedAppropriately(
  oldVersion: string | null,
  newVersion: string,
  check: VersionCheck
): { ok: boolean; reason?: string; suggestion?: string } {
  if (!oldVersion) {
    return { ok: true };
  }

  const old = parseVersion(oldVersion);
  const curr = parseVersion(newVersion);

  const majorBumped = curr.major > old.major;
  const minorBumped = curr.minor > old.minor || majorBumped;
  const patchBumped = curr.patch > old.patch || minorBumped;

  if (check.hasBreaking && !majorBumped) {
    return {
      ok: false,
      reason: "Breaking change detected but major version not bumped",
      suggestion: `npm version major (${old.major}.${old.minor}.${old.patch} → ${old.major + 1}.0.0)`,
    };
  }

  if (check.hasFeats && !minorBumped) {
    return {
      ok: false,
      reason: "New feature (feat:) detected but minor version not bumped",
      suggestion: `npm version minor (${old.major}.${old.minor}.${old.patch} → ${old.major}.${old.minor + 1}.0)`,
    };
  }

  if (check.hasFixes && !patchBumped) {
    return {
      ok: false,
      reason: "Bug fix (fix:) detected but patch version not bumped",
      suggestion: `npm version patch (${old.major}.${old.minor}.${old.patch} → ${old.major}.${old.minor}.${old.patch + 1})`,
    };
  }

  return { ok: true };
}

function main(): void {
  console.log("🔍 Checking version consistency with commits...\n");

  const lastTag = getLastTag();
  const commits = getCommitsSinceTag(lastTag);

  if (commits.length === 0) {
    console.log("✓ No new commits since last tag\n");
    process.exit(0);
  }

  const check = analyzeCommits(commits);
  const currentVersion = getCurrentVersion();
  const tagVersion = getTagVersion(lastTag);

  console.log(`  Last tag: ${lastTag ?? "(none)"}`);
  console.log(`  Current version: ${currentVersion}`);
  console.log(`  Commits since tag: ${commits.length}`);
  console.log(`  Contains feat: ${check.hasFeats}`);
  console.log(`  Contains fix: ${check.hasFixes}`);
  console.log(`  Contains breaking: ${check.hasBreaking}\n`);

  if (!check.hasFeats && !check.hasFixes && !check.hasBreaking) {
    console.log("✓ No version-affecting commits (feat:/fix:/breaking)\n");
    process.exit(0);
  }

  const result = versionBumpedAppropriately(tagVersion, currentVersion, check);

  if (result.ok) {
    console.log("✓ Version bump is appropriate for commits\n");
    process.exit(0);
  }

  console.error(
    "╔════════════════════════════════════════════════════════════╗"
  );
  console.error(
    "║  VERSION CHECK FAILED                                      ║"
  );
  console.error(
    "╚════════════════════════════════════════════════════════════╝\n"
  );
  console.error(`❌ ${result.reason}\n`);
  console.error(`💡 Suggestion: ${result.suggestion}\n`);
  console.error("   Then amend your commit or create a new one.\n");
  console.error("   To bypass (use sparingly): git push --no-verify\n");

  process.exit(1);
}

main();
