/**
 * ESLint rule: no-fragile-date-ops
 *
 * Detects and blocks fragile Date/time patterns at lint time.
 * See the decision matrix in the plan for rationale per pattern.
 *
 * Pattern A: .toISOString() + .slice()/.replace()/.substring() — error
 * Pattern B: .toLocaleDateString() etc. without locale arg — error
 * Pattern C: Magic time literals in date arithmetic — warn
 * Pattern D: Month/year duration constants — error
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow fragile Date/time patterns; prefer named utilities and constants",
      recommended: true,
    },
    messages: {
      isoSlice:
        "Do not slice/replace toISOString() output. Use utcDate(), utcTimestamp(), or a named formatter instead.",
      localeNoArg:
        "{{method}}() called without a locale argument. Use next-intl or pass an explicit locale.",
      magicTimeLiteral:
        "Magic number {{value}} in date/time arithmetic. Use a named constant from temporal-constants.ts.",
      monthYearConstant:
        "Month/year duration constants are fundamentally incorrect (irregular lengths). Do not define {{name}}.",
      monthYearChain:
        "Multiplication chain looks like a month/year duration (uses {{suspect}}). Months and years have irregular lengths.",
    },
    schema: [],
  },

  create(context) {
    // ── Helpers ──────────────────────────────────────────────────────

    const TIME_NAME_RE =
      /time|stamp|millis|seconds|hours|days|minutes|duration|age|cutoff|diff|ttl|elapsed|old|created|updated/i;

    const MONTH_YEAR_NAME_RE = /month|year/i;
    const DURATION_NAME_RE = /ms|per|days|duration|millis/i;

    /**
     * Walk up the AST (max depth) looking for a date-arithmetic context.
     * Returns true if the literal is used in a time-related expression.
     */
    function isInDateArithmeticContext(node, maxDepth = 5) {
      let current = node;
      for (let i = 0; i < maxDepth; i++) {
        const parent = current.parent;
        if (!parent) return false;

        if (
          parent.type === "BinaryExpression" &&
          ["+", "-", "*", "/", "%"].includes(parent.operator)
        ) {
          // Check other operand and surrounding identifiers
          const other = parent.left === current ? parent.right : parent.left;
          if (containsDateReference(other)) return true;
          if (containsTimeNamedIdentifier(parent)) return true;
        }

        current = parent;
      }
      return false;
    }

    /** Check if a node is or contains Date.now() */
    function containsDateReference(node) {
      if (!node) return false;
      // Date.now()
      if (
        node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        node.callee.object.name === "Date" &&
        node.callee.property.type === "Identifier" &&
        node.callee.property.name === "now"
      ) {
        return true;
      }
      // Identifier with time-related name
      if (node.type === "Identifier" && TIME_NAME_RE.test(node.name)) {
        return true;
      }
      if (node.type === "MemberExpression") {
        return (
          containsDateReference(node.object) ||
          containsDateReference(node.property)
        );
      }
      if (
        node.type === "BinaryExpression" ||
        node.type === "LogicalExpression"
      ) {
        return (
          containsDateReference(node.left) || containsDateReference(node.right)
        );
      }
      if (node.type === "CallExpression") {
        return containsDateReference(node.callee);
      }
      return false;
    }

    /** Check if any identifier in the expression tree matches TIME_NAME_RE */
    function containsTimeNamedIdentifier(node) {
      if (!node) return false;
      if (node.type === "Identifier") return TIME_NAME_RE.test(node.name);
      if (node.type === "MemberExpression") {
        return (
          containsTimeNamedIdentifier(node.object) ||
          containsTimeNamedIdentifier(node.property)
        );
      }
      if (
        node.type === "BinaryExpression" ||
        node.type === "LogicalExpression"
      ) {
        return (
          containsTimeNamedIdentifier(node.left) ||
          containsTimeNamedIdentifier(node.right)
        );
      }
      if (node.type === "CallExpression") {
        return (
          containsTimeNamedIdentifier(node.callee) ||
          node.arguments.some(containsTimeNamedIdentifier)
        );
      }
      if (node.type === "UnaryExpression") {
        return containsTimeNamedIdentifier(node.argument);
      }
      return false;
    }

    /**
     * Check if the literal is the direct init of a VariableDeclarator
     * whose name already matches TIME_NAME_RE (already named — skip).
     */
    function isDirectInitOfNamedTimeVar(node) {
      const parent = node.parent;
      if (!parent) return false;
      if (parent.type === "VariableDeclarator" && parent.init === node) {
        if (
          parent.id.type === "Identifier" &&
          TIME_NAME_RE.test(parent.id.name)
        ) {
          return true;
        }
      }
      return false;
    }

    /**
     * Collect all numeric literal values from a multiplication chain.
     */
    function collectMultiplicationLiterals(node) {
      const values = [];
      if (node.type === "Literal" && typeof node.value === "number") {
        values.push(node.value);
      } else if (node.type === "BinaryExpression" && node.operator === "*") {
        values.push(...collectMultiplicationLiterals(node.left));
        values.push(...collectMultiplicationLiterals(node.right));
      }
      return values;
    }

    // ── Visitors ─────────────────────────────────────────────────────

    return {
      // Pattern A: .toISOString().slice() / .replace() / .substring()
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          ["slice", "replace", "substring"].includes(node.callee.property.name)
        ) {
          const obj = node.callee.object;
          if (
            obj.type === "CallExpression" &&
            obj.callee.type === "MemberExpression" &&
            obj.callee.property.type === "Identifier" &&
            obj.callee.property.name === "toISOString"
          ) {
            context.report({ node, messageId: "isoSlice" });
            return;
          }
        }

        // Pattern B: .toLocaleDateString() etc. without locale arg
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier"
        ) {
          const method = node.callee.property.name;
          if (
            [
              "toLocaleDateString",
              "toLocaleTimeString",
              "toLocaleString",
            ].includes(method) &&
            node.arguments.length === 0
          ) {
            context.report({
              node,
              messageId: "localeNoArg",
              data: { method },
            });
          }
        }
      },

      // Pattern C: Magic time literals in date arithmetic context
      Literal(node) {
        if (typeof node.value !== "number") return;
        // Skip 0, 1, 2 — too common and usually not time-related
        if (node.value <= 2) return;

        // Skip if it's the direct init of an already-named time variable
        if (isDirectInitOfNamedTimeVar(node)) return;

        if (isInDateArithmeticContext(node)) {
          context.report({
            node,
            messageId: "magicTimeLiteral",
            data: { value: String(node.value) },
          });
        }
      },

      // Pattern D: Month/year duration constants
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier") return;
        const name = node.id.name;

        // Check 1: variable named like MS_PER_MONTH, DAYS_PER_YEAR, etc.
        if (MONTH_YEAR_NAME_RE.test(name) && DURATION_NAME_RE.test(name)) {
          context.report({
            node,
            messageId: "monthYearConstant",
            data: { name },
          });
          return;
        }

        // Check 2: variable named like DAYS_PER_YEAR = 365
        if (
          MONTH_YEAR_NAME_RE.test(name) &&
          node.init &&
          node.init.type === "Literal" &&
          (node.init.value === 365 ||
            node.init.value === 366 ||
            node.init.value === 30 ||
            node.init.value === 31 ||
            node.init.value === 28 ||
            node.init.value === 29)
        ) {
          context.report({
            node,
            messageId: "monthYearConstant",
            data: { name },
          });
          return;
        }

        // Check 3: multiplication chains with 30 or 365 + other time literals
        if (node.init && node.init.type === "BinaryExpression") {
          const literals = collectMultiplicationLiterals(node.init);
          const has30or365 = literals.includes(30) || literals.includes(365);
          const hasTimeLiterals = literals.some((v) =>
            [24, 60, 1000, 3600].includes(v)
          );
          if (has30or365 && hasTimeLiterals) {
            const suspect = literals.includes(30) ? "30" : "365";
            context.report({
              node,
              messageId: "monthYearChain",
              data: { suspect },
            });
          }
        }
      },
    };
  },
};

module.exports = rule;
