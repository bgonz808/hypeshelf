/** @type {import('@commitlint/types').UserConfig} */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Enforce conventional commit types
    "type-enum": [
      2,
      "always",
      [
        "feat", // New feature
        "fix", // Bug fix
        "docs", // Documentation only
        "style", // Formatting, whitespace (no code change)
        "refactor", // Code restructure without behavior change
        "perf", // Performance improvement
        "test", // Adding or fixing tests
        "build", // Build system or dependencies
        "ci", // CI/CD changes
        "chore", // Maintenance tasks
        "revert", // Revert previous commit
        "security", // Security fix (custom type)
      ],
    ],
    // Require lowercase type
    "type-case": [2, "always", "lower-case"],
    // Subject must not be empty
    "subject-empty": [2, "never"],
    // Subject should be sentence case or lower
    "subject-case": [0],
    // Max header length for readability
    "header-max-length": [2, "always", 100],
    // Body should wrap at 100 chars
    "body-max-line-length": [1, "always", 100],
  },
};

module.exports = config;
