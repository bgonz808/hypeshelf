# ADR-001: Technology Stack Selection

## Status

Accepted

## Context

Building HypeShelf - a social recommendations platform for a take-home assignment. The requirements specified Next.js, Clerk, and Convex. This ADR documents the rationale and implications.

## Decision

We will use:

| Component | Technology | Version |
|-----------|------------|---------|
| Framework | Next.js (App Router) | 14.x |
| Language | TypeScript | 5.x (strict mode) |
| Authentication | Clerk | 5.x |
| Database/Backend | Convex | 1.x |
| Styling | Tailwind CSS | 3.x |
| Testing | Vitest | 2.x |
| i18n | next-intl | 3.x |

## Rationale

### Next.js 14 (App Router)

**Pros:**
- Modern React patterns (Server Components, streaming)
- Built-in API routes (though we use Convex instead)
- Excellent TypeScript support
- Vercel deployment is seamless

**Cons:**
- App Router still maturing (some edge cases)
- Learning curve for developers used to Pages Router

### Clerk

**Pros:**
- Handles complex auth flows (OAuth, MFA, sessions)
- Pre-built UI components
- Good security defaults
- Reduces auth-related security risks

**Cons:**
- Vendor lock-in
- Pricing at scale
- Less control over auth flow details

### Convex

**Pros:**
- Real-time by default
- TypeScript end-to-end
- No separate API layer needed
- Built-in auth integration

**Cons:**
- Relatively new (less ecosystem)
- Vendor lock-in
- Different mental model from traditional REST/SQL

### TypeScript Strict Mode

Non-negotiable for this project:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitReturns: true`

Catches bugs at compile time, not production.

## Consequences

### Positive

- Fast development with modern tooling
- Strong type safety throughout
- Real-time features "for free"
- Auth complexity abstracted away

### Negative

- Team must learn Convex patterns
- Vendor dependencies on Clerk and Convex
- Migration away would be significant effort

### Neutral

- Vercel deployment recommended (works elsewhere but less smooth)
- Testing patterns differ from traditional REST APIs

## Related Decisions

- ADR-002: Authentication Providers
- ADR-003: RBAC Approach
