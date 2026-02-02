import nextConfig from "eslint-config-next";
import security from "eslint-plugin-security";
import i18next from "eslint-plugin-i18next";
import noFragileDateOps from "./eslint-rules/no-fragile-date-ops.js";

/** @type {import('eslint').Linter.Config[]} */
const config = [
  // Next.js config (already flat config compatible in v16)
  ...nextConfig,

  // Security plugin - ALL 14 rules from eslint-plugin-security
  // See: https://github.com/eslint-community/eslint-plugin-security
  security.configs.recommended,

  // Upgrade critical security rules from warn to error
  {
    rules: {
      // CRITICAL - These should fail the build
      "security/detect-eval-with-expression": "error", // eval() is XSS vector
      "security/detect-child-process": "error", // Command injection
      "security/detect-unsafe-regex": "error", // ReDoS
      "security/detect-pseudoRandomBytes": "error", // Insecure randomness
      "security/detect-buffer-noassert": "error", // Buffer overflow
      "security/detect-disable-mustache-escape": "error", // XSS in templates
      "security/detect-new-buffer": "error", // Deprecated Buffer()
      "security/detect-bidi-characters": "error", // Trojan source attacks

      // MODERATE - Warn but allow (common in legitimate code)
      "security/detect-non-literal-fs-filename": "warn",
      "security/detect-non-literal-require": "warn",
      "security/detect-non-literal-regexp": "warn",
      "security/detect-object-injection": "warn", // obj[key] is common
      "security/detect-possible-timing-attacks": "warn",
      "security/detect-no-csrf-before-method-override": "warn",
    },
  },

  // Custom rules
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always"],
      // Prevent dangerous React patterns
      "react/no-danger": "error",
      // Prevent javascript: URLs
      "no-script-url": "error",
    },
  },

  // i18n: Flag hardcoded strings in UI code (ADR-004 Phase 2)
  // Warn only — developers see violations but commits aren't blocked.
  // Escalates to error in Phase 3+ after component migration.
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": "warn",
    },
  },

  // Custom date/time safety rule
  {
    plugins: {
      hypeshelf: { rules: { "no-fragile-date-ops": noFragileDateOps } },
    },
    rules: {
      "hypeshelf/no-fragile-date-ops": "error",
    },
  },

  // scripts/** overrides: CLI tools legitimately use console, dynamic fs paths,
  // and bracket-access on controlled objects. Critical security rules (eval,
  // child-process, unsafe-regex, bidi, etc.) remain at error level.
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": "off",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-non-literal-regexp": "off",
      "security/detect-object-injection": "off",
    },
  },

  // Suppress date-ops rule in canonical i18n utilities (they ARE the blessed implementation)
  {
    files: ["scripts/lib/message-manager.ts"],
    rules: { "hypeshelf/no-fragile-date-ops": "off" },
  },

  // Ignore patterns
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "convex/_generated/**"],
  },
];

export default config;
