#!/usr/bin/env npx tsx
/**
 * Tool Drift Detection
 *
 * Detects when new languages/frameworks are added but security scanning
 * configs haven't been updated to cover them.
 *
 * Run: npx tsx scripts/detect-tool-drift.ts
 * Add to CI for automated drift detection.
 */

import * as fs from "fs";
import * as path from "path";

// Languages/frameworks we have scanning configured for
const CONFIGURED_SCANNING = {
  languages: ["typescript", "javascript", "python"],
  frameworks: ["react", "nextjs", "convex"],
  // These rulesets are in our Semgrep config
  semgrepRulesets: [
    "p/security-audit",
    "p/secrets",
    "p/typescript",
    "p/react",
    "p/nextjs",
    "p/python",
  ],
};

// File extension to language mapping (Map for safe key lookup)
const EXTENSION_MAP = new Map<string, string>([
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".py", "python"],
  [".go", "go"],
  [".rs", "rust"],
  [".rb", "ruby"],
  [".java", "java"],
  [".kt", "kotlin"],
  [".scala", "scala"],
  [".php", "php"],
  [".cs", "csharp"],
  [".swift", "swift"],
  [".m", "objectivec"],
  [".c", "c"],
  [".cpp", "cpp"],
  [".h", "c"],
  [".hpp", "cpp"],
]);

// Framework detection patterns
const FRAMEWORK_PATTERNS: Record<string, { files: string[]; deps: string[] }> =
  {
    react: {
      files: [],
      deps: ["react", "react-dom"],
    },
    nextjs: {
      files: ["next.config.js", "next.config.mjs", "next.config.ts"],
      deps: ["next"],
    },
    convex: {
      files: ["convex/"],
      deps: ["convex"],
    },
    express: {
      files: [],
      deps: ["express"],
    },
    fastify: {
      files: [],
      deps: ["fastify"],
    },
    nestjs: {
      files: [],
      deps: ["@nestjs/core"],
    },
    django: {
      files: ["manage.py", "settings.py"],
      deps: [],
    },
    flask: {
      files: [],
      deps: [], // Would need requirements.txt parsing
    },
    rails: {
      files: ["Gemfile", "config/routes.rb"],
      deps: [],
    },
    springboot: {
      files: ["pom.xml", "build.gradle"],
      deps: [],
    },
  };

interface DriftReport {
  newLanguages: string[];
  newFrameworks: string[];
  recommendations: string[];
}

function getFilesRecursive(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip common non-source directories
    if (
      entry.isDirectory() &&
      !["node_modules", ".git", ".next", "dist", "build", "coverage"].includes(
        entry.name
      )
    ) {
      getFilesRecursive(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function detectLanguages(files: string[]): Set<string> {
  const languages = new Set<string>();

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const lang = EXTENSION_MAP.get(ext);
    if (lang) {
      languages.add(lang);
    }
  }

  return languages;
}

function detectFrameworks(rootDir: string): Set<string> {
  const frameworks = new Set<string>();

  // Check package.json dependencies
  const pkgPath = path.join(rootDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    for (const [framework, patterns] of Object.entries(FRAMEWORK_PATTERNS)) {
      for (const dep of patterns.deps) {
        if (Object.hasOwn(allDeps, dep)) {
          frameworks.add(framework);
          break;
        }
      }
    }
  }

  // Check for framework-specific files
  for (const [framework, patterns] of Object.entries(FRAMEWORK_PATTERNS)) {
    for (const file of patterns.files) {
      if (fs.existsSync(path.join(rootDir, file))) {
        frameworks.add(framework);
        break;
      }
    }
  }

  return frameworks;
}

function checkDrift(rootDir: string): DriftReport {
  const files = getFilesRecursive(rootDir);
  const detectedLanguages = detectLanguages(files);
  const detectedFrameworks = detectFrameworks(rootDir);

  const newLanguages = [...detectedLanguages].filter(
    (lang) => !CONFIGURED_SCANNING.languages.includes(lang)
  );

  const newFrameworks = [...detectedFrameworks].filter(
    (fw) => !CONFIGURED_SCANNING.frameworks.includes(fw)
  );

  const recommendations: string[] = [];

  // Language-specific recommendations (Map for safe key lookup)
  const langToSemgrep = new Map<string, string>([
    ["python", "p/python"],
    ["go", "p/golang"],
    ["rust", "p/rust"],
    ["ruby", "p/ruby"],
    ["java", "p/java"],
    ["kotlin", "p/kotlin"],
    ["php", "p/php"],
    ["csharp", "p/csharp"],
    ["c", "p/c"],
    ["cpp", "p/cpp"],
  ]);

  for (const lang of newLanguages) {
    const ruleset = langToSemgrep.get(lang);
    if (ruleset) {
      recommendations.push(
        `Add Semgrep ruleset '${ruleset}' for ${lang} files`
      );
    }
    recommendations.push(`Add CodeQL language '${lang}' to codeql.yml`);
  }

  // Framework-specific recommendations (Map for safe key lookup)
  const fwToSemgrep = new Map<string, string>([
    ["express", "p/expressjs"],
    ["django", "p/django"],
    ["flask", "p/flask"],
    ["rails", "p/ruby-on-rails"],
    ["springboot", "p/java-spring"],
  ]);

  for (const fw of newFrameworks) {
    const ruleset = fwToSemgrep.get(fw);
    if (ruleset) {
      recommendations.push(`Add Semgrep ruleset '${ruleset}' for ${fw}`);
    }
  }

  return { newLanguages, newFrameworks, recommendations };
}

// Main execution
const rootDir = process.cwd();
const report = checkDrift(rootDir);

console.log("🔍 Tool Drift Detection Report\n");
console.log("Configured languages:", CONFIGURED_SCANNING.languages.join(", "));
console.log(
  "Configured frameworks:",
  CONFIGURED_SCANNING.frameworks.join(", ")
);
console.log("");

if (report.newLanguages.length === 0 && report.newFrameworks.length === 0) {
  console.log("✅ No drift detected - all languages/frameworks are covered\n");
  process.exit(0);
} else {
  console.log("⚠️  DRIFT DETECTED\n");

  if (report.newLanguages.length > 0) {
    console.log("New languages found (not in scanning config):");
    for (const lang of report.newLanguages) {
      console.log(`  - ${lang}`);
    }
    console.log("");
  }

  if (report.newFrameworks.length > 0) {
    console.log("New frameworks found (not in scanning config):");
    for (const fw of report.newFrameworks) {
      console.log(`  - ${fw}`);
    }
    console.log("");
  }

  if (report.recommendations.length > 0) {
    console.log("Recommendations:");
    for (const rec of report.recommendations) {
      console.log(`  → ${rec}`);
    }
    console.log("");
  }

  console.log(
    "Update CONFIGURED_SCANNING in this script after adding scanning coverage.\n"
  );
  process.exit(1);
}
