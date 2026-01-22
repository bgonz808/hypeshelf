# ADR-002: Testing Strategy

## Status

Accepted

## Context

HypeShelf requires a comprehensive testing strategy that:

- Catches bugs before they reach production
- Validates accessibility compliance
- Detects security vulnerabilities early
- Prevents regressions
- Integrates with git hooks and CI/CD
- Balances thoroughness with developer velocity

## Decision

We adopt a **testing pyramid** approach with multiple layers, each serving a specific purpose.

### Testing Layers

#### 1. Unit Tests (Vitest)

**What**: Individual functions, utilities, hooks
**When**: pre-push hook, CI
**Coverage Target**: 80%+ for business logic

```typescript
// Example: src/lib/utils.test.ts
import { describe, it, expect } from "vitest";
import { isValidUrl, truncate } from "./utils";

describe("isValidUrl", () => {
  it("accepts valid https URLs", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
  });
  it("rejects javascript: URLs", () => {
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
  });
});
```

#### 2. Integration Tests (Vitest + React Testing Library)

**What**: Component interactions, form submissions, state changes
**When**: pre-push hook, CI
**Focus**: User-facing behavior, not implementation details

```typescript
// Example: src/components/AddRecommendation.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { AddRecommendation } from './AddRecommendation'

it('shows validation error for empty title', async () => {
  render(<AddRecommendation />)
  fireEvent.click(screen.getByRole('button', { name: /submit/i }))
  expect(await screen.findByText(/title is required/i)).toBeInTheDocument()
})
```

#### 3. E2E Tests (Playwright)

**What**: Full user journeys, cross-browser, real network
**When**: CI only (too slow for hooks)
**Scope**: Critical paths only

```typescript
// Example: e2e/auth-flow.spec.ts
import { test, expect } from "@playwright/test";

test("user can sign in and add recommendation", async ({ page }) => {
  await page.goto("/");
  await page.click("text=Sign In");
  // ... complete auth flow
  await expect(page.locator('[data-testid="dashboard"]')).toBeVisible();
});
```

#### 4. Accessibility Tests (axe-core + eslint-plugin-jsx-a11y)

**What**: WCAG 2.1 AA compliance
**When**:

- Static: pre-commit (eslint)
- Runtime: integration tests, CI

```typescript
// Example: src/components/Button.test.tsx
import { axe, toHaveNoViolations } from 'jest-axe'
expect.extend(toHaveNoViolations)

it('has no accessibility violations', async () => {
  const { container } = render(<Button>Click me</Button>)
  expect(await axe(container)).toHaveNoViolations()
})
```

#### 5. Security Tests

**What**: SAST, secrets detection, dependency vulnerabilities
**When**: pre-commit, pre-push, CI

| Tool                   | Purpose             | Hook       |
| ---------------------- | ------------------- | ---------- |
| eslint-plugin-security | Dangerous patterns  | pre-commit |
| Gitleaks               | Secrets/PII         | pre-commit |
| npm audit              | Dep vulnerabilities | pre-push   |
| TypeScript strict      | Type safety         | pre-push   |

#### 6. Visual Regression (Playwright Screenshots)

**What**: Unintended UI changes
**When**: CI on PRs
**Scope**: Key pages, responsive breakpoints, RTL layouts

#### 7. PII Detection (Gitleaks Custom Rules)

**What**: Prevent accidental PII commits
**When**: pre-commit

Custom rules in `.gitleaks.toml`:

- Email patterns in code (not config)
- SSN patterns
- Phone number patterns
- Credit card patterns

#### 8. Load/Abuse Testing (Future - k6)

**What**: Rate limiting effectiveness, performance under load
**When**: Manual before major releases
**Scope**: API endpoints, form submissions

### Hook Integration

```
pre-commit:
├── lint-staged (ESLint + Prettier)
├── Gitleaks (secrets + PII)
└── TypeScript (type check)

pre-push:
├── vitest run (unit + integration)
├── npm audit --audit-level=high
└── next build (compile check)

CI (GitHub Actions):
├── All pre-commit checks
├── All pre-push checks
├── Playwright E2E
├── Coverage report
├── SBOM generation
└── Visual regression (on PR)
```

### Test File Organization

```
hypeshelf/
├── src/
│   ├── lib/
│   │   ├── utils.ts
│   │   └── utils.test.ts      # Co-located unit tests
│   └── components/
│       ├── Button.tsx
│       └── Button.test.tsx    # Co-located component tests
├── e2e/                       # Playwright E2E tests
│   ├── auth-flow.spec.ts
│   ├── recommendations.spec.ts
│   └── admin.spec.ts
└── __mocks__/                 # Shared mocks
    ├── clerk.ts
    └── convex.ts
```

## Consequences

### Positive

- Comprehensive coverage across testing types
- Early bug detection via hooks
- Accessibility built into development flow
- Security checks automated
- Clear separation of test responsibilities

### Negative

- Initial setup overhead for Playwright
- E2E tests add CI time (~2-5 min)
- Developers need familiarity with multiple testing tools

### Mitigations

- Provide test templates/examples
- Parallelize CI jobs
- Cache Playwright browsers

## Dependencies

Added to `package.json`:

- `@playwright/test` - E2E testing
- `@axe-core/playwright` - Accessibility testing in Playwright
- `jest-axe` - Accessibility testing in unit tests

## References

- [Testing Trophy by Kent C. Dodds](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
