# ADR-003: Security Scanning Strategy

## Status

Accepted

## Context

Modern web applications face numerous security threats including XSS, injection attacks, dependency vulnerabilities, and secrets exposure. We need automated scanning at multiple levels to catch issues before they reach production.

The question isn't whether to scan, but how comprehensively and at what cost (time, false positives, complexity).

## Decision

We implement a **defense-in-depth** scanning strategy across four layers:

### Layer 1: Commit Time (Local)

| Tool              | Purpose                       | Blocking |
| ----------------- | ----------------------------- | -------- |
| Gitleaks          | Secrets detection             | Yes      |
| security-check.ts | Custom PII/injection patterns | Warn     |
| lint-staged       | Formatting consistency        | Yes      |

### Layer 2: Push Time (Local)

| Tool                     | Purpose           | Blocking         |
| ------------------------ | ----------------- | ---------------- |
| TypeScript               | Type safety       | Yes              |
| ESLint + security plugin | 14 security rules | Yes (8 critical) |
| Vitest                   | Unit tests        | Yes              |

### Layer 3: CI (Every PR)

| Tool                 | Purpose                | Blocking |
| -------------------- | ---------------------- | -------- |
| npm audit            | Dependency CVEs        | Yes      |
| Gitleaks             | Git history secrets    | Yes      |
| Semgrep (paranoid)   | SAST - 711 rules       | Yes      |
| CodeQL               | Deep semantic analysis | Yes      |
| Tool drift detection | Config coverage        | Yes      |

### Layer 4: Scheduled (Weekly)

| Tool      | Purpose             | Blocking       |
| --------- | ------------------- | -------------- |
| OWASP ZAP | DAST baseline scan  | Report only    |
| Nuclei    | Known CVE detection | Creates issues |
| CodeQL    | Full codebase scan  | Report only    |

## Rationale

### ESLint Security Plugin (14 Rules)

We use `eslint-plugin-security` with ALL rules enabled:

**Error level (8 rules)** - Block the build:

- `detect-eval-with-expression` - eval() is XSS vector
- `detect-child-process` - Command injection
- `detect-unsafe-regex` - ReDoS attacks
- `detect-pseudoRandomBytes` - Insecure randomness
- `detect-buffer-noassert` - Buffer overflow
- `detect-disable-mustache-escape` - Template XSS
- `detect-new-buffer` - Deprecated API
- `detect-bidi-characters` - Trojan source attacks

**Warn level (6 rules)** - Alert but don't block:

- `detect-object-injection` - Too many false positives
- `detect-non-literal-fs-filename` - Common in build scripts
- `detect-non-literal-require` - Dynamic imports are valid
- `detect-non-literal-regexp` - Search features need this
- `detect-possible-timing-attacks` - Many false positives
- `detect-no-csrf-before-method-override` - Framework handles

### Semgrep Configuration

We chose the **paranoid configuration** (711 rules) because:

1. Current codebase has 0 findings even with maximum rules
2. User explicitly prefers bulletproof security over fewer false positives
3. Adding frameworks later is easier than auditing missed vulnerabilities

Rulesets included:

- `p/security-audit` - Core security patterns
- `p/secrets` - Hardcoded credentials
- `p/owasp-top-ten` - OWASP coverage
- `p/cwe-top-25` - CWE coverage
- `p/typescript` - TS-specific issues
- `p/react` - React antipatterns (dangerouslySetInnerHTML)
- `p/nextjs` - Next.js specific issues
- `p/jwt` - JWT misuse patterns
- `p/xss` - XSS patterns
- `p/sql-injection` - Injection patterns (for future)

### CodeQL vs Semgrep

We run BOTH because they're complementary:

| Aspect   | Semgrep          | CodeQL                               |
| -------- | ---------------- | ------------------------------------ |
| Analysis | Pattern matching | Semantic/data flow                   |
| Speed    | Fast (~10s)      | Slow (~2-5min)                       |
| Findings | Obvious patterns | Complex flows                        |
| Example  | `eval(x)`        | User input → eval after 5 transforms |

### DAST: Weekly Not Per-PR

DAST (OWASP ZAP, Nuclei) runs weekly because:

1. Requires deployed application (slow, ~5-10min)
2. Finds config issues, not code issues
3. Diminishing returns running on every PR
4. Scheduled scans catch drift over time

### Tool Drift Detection

Custom script `detect-tool-drift.ts` fails CI if:

- New language files added (e.g., `.py`, `.go`) without scanning config
- New frameworks detected in package.json without Semgrep rules

This prevents silent security gaps when the codebase evolves.

## Alternatives Considered

### ESLint: All Rules as Errors

Rejected because:

- `detect-object-injection` triggers on every `obj[key]` access
- Would require 100+ eslint-disable comments
- Developer friction outweighs marginal security gain

### Semgrep: Minimal Config

Rejected because:

- User explicitly wanted maximum coverage
- No false positives with 711 rules on current codebase
- Better to triage findings than miss vulnerabilities

### DAST: Per-PR

Rejected because:

- 5-10 minute scan time per PR is unacceptable
- Requires deployed preview (complexity)
- Weekly catches same issues with less overhead

### SonarQube

Not chosen because:

- Requires self-hosting or paid cloud
- Semgrep + CodeQL provide equivalent coverage for free
- More complexity for marginal benefit

## Consequences

### Positive

- Defense in depth - vulnerabilities caught at multiple stages
- Fast feedback - most issues caught locally (seconds)
- Comprehensive - OWASP Top 10 and CWE Top 25 covered
- Automated - no manual security reviews needed for routine changes
- Drift detection - won't silently lose coverage

### Negative

- CI time increased (~3-5 min for security scans)
- Learning curve for security rule warnings
- False positives possible (configured to minimize)
- Weekly DAST requires deployed environment

### Neutral

- GitHub Security tab shows all findings (SARIF upload)
- Nuclei creates GitHub issues automatically
- All tools are free/open-source

## Compliance Mapping

| Standard     | Coverage                  |
| ------------ | ------------------------- |
| OWASP Top 10 | Semgrep `p/owasp-top-ten` |
| CWE Top 25   | Semgrep `p/cwe-top-25`    |
| ASVS L1      | Partial via SAST + DAST   |
| SOC 2        | Audit trail via CI logs   |

## Related Decisions

- ADR-001: Tech Stack (defines what we're scanning)
- ADR-002: Testing Strategy (unit/integration tests)
