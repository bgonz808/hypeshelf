/**
 * Tests for no-fragile-date-ops ESLint rule.
 * Run: npx vitest run eslint-rules/
 *
 * RuleTester.run() internally calls describe/it, so we invoke it
 * at the top level — vitest picks up the nested suites automatically.
 */

import { RuleTester } from "eslint";
import rule from "./no-fragile-date-ops.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-fragile-date-ops", rule, {
  valid: [
    // Named utilities — the right way
    "utcDate()",
    "utcTimestamp()",

    // Explicit locale — fine
    'new Date(ts).toLocaleDateString("en-US")',
    'new Date(ts).toLocaleTimeString("ar-SA")',
    'new Date(ts).toLocaleString("es")',

    // Already-named constant (direct init) — skip Pattern C
    "const CACHE_TTL_MS = 60000",
    "const durationMs = 3600000",

    // Not in date context — skip
    "arr.slice(0, 1000)",
    '"hello".slice(0, 5)',
    "items.slice(0, 10)",

    // Date.now() bare — fine
    "Date.now()",

    // Named constant usage from import
    "const hoursOld = (Date.now() - item.createdAt) / MS_PER_HOUR",

    // Non-time arithmetic with small numbers
    "const x = 3 + 4",
    "const y = arr.length * 2",

    // Regular variable with 365 not named month/year
    "const TAX_DAYS = 365",
  ],

  invalid: [
    // Pattern A: .toISOString().slice()
    {
      code: "new Date().toISOString().slice(0, 10)",
      errors: [{ messageId: "isoSlice" }],
    },
    // Pattern A: .toISOString().replace()
    {
      code: 'd.toISOString().replace(/[-:]/g, "")',
      errors: [{ messageId: "isoSlice" }],
    },
    // Pattern A: .toISOString().substring()
    {
      code: "new Date().toISOString().substring(0, 10)",
      errors: [{ messageId: "isoSlice" }],
    },

    // Pattern B: locale-less toLocaleDateString
    {
      code: "new Date(ts).toLocaleDateString()",
      errors: [
        {
          messageId: "localeNoArg",
          data: { method: "toLocaleDateString" },
        },
      ],
    },
    // Pattern B: locale-less toLocaleTimeString
    {
      code: "new Date(ts).toLocaleTimeString()",
      errors: [
        {
          messageId: "localeNoArg",
          data: { method: "toLocaleTimeString" },
        },
      ],
    },
    // Pattern B: locale-less toLocaleString
    {
      code: "new Date(ts).toLocaleString()",
      errors: [
        { messageId: "localeNoArg", data: { method: "toLocaleString" } },
      ],
    },

    // Pattern C: magic numbers in date arithmetic
    {
      code: "const hoursOld = (Date.now() - item.createdAt) / (1000 * 60 * 60)",
      errors: [
        { messageId: "magicTimeLiteral", data: { value: "1000" } },
        { messageId: "magicTimeLiteral", data: { value: "60" } },
        { messageId: "magicTimeLiteral", data: { value: "60" } },
      ],
    },
    // Pattern C: days * 24 * 60 * 60 * 1000
    {
      code: "const cutoff = Date.now() - days * 24 * 60 * 60 * 1000",
      errors: [
        { messageId: "magicTimeLiteral", data: { value: "24" } },
        { messageId: "magicTimeLiteral", data: { value: "60" } },
        { messageId: "magicTimeLiteral", data: { value: "60" } },
        { messageId: "magicTimeLiteral", data: { value: "1000" } },
      ],
    },

    // Pattern D: month duration constant
    {
      code: "const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000",
      errors: [{ messageId: "monthYearConstant" }],
    },
    // Pattern D: year duration constant
    {
      code: "const DAYS_PER_YEAR = 365",
      errors: [{ messageId: "monthYearConstant" }],
    },
    // Pattern D: multiplication chain with 30
    {
      code: "const CACHE_DURATION = 30 * 24 * 60 * 60 * 1000",
      errors: [{ messageId: "monthYearChain" }],
    },
  ],
});
