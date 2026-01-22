# HypeShelf Project Status

> Living document tracking project progress, versions, and milestones.

## Current Version

| Field           | Value         |
| --------------- | ------------- |
| **Version**     | `0.1.0-alpha` |
| **Last Commit** | `_pending_`   |
| **Commit Time** | `_pending_`   |
| **Branch**      | `main`        |

## Project Goals

Build a social recommendations platform demonstrating:

- Modern React/Next.js patterns (App Router, Server Components)
- Real-time data with Convex
- Secure authentication with Clerk (OAuth + RBAC)
- Production-grade DevSecOps practices
- Accessibility and i18n (including RTL)

## Phase Checklist

### Phase 1: Project Scaffolding

- [x] Initialize git repository
- [x] Create package.json with pinned dependencies
- [x] Configure TypeScript (strict mode)
- [x] Set up Next.js App Router structure
- [x] Configure ESLint (security + a11y plugins)
- [x] Set up Husky, commitlint, Gitleaks
- [x] Create documentation (ARCHITECTURE.md, SECURITY.md)
- [x] Set up i18n message files (en, es, zh, ar, yi)
- [x] Initial commit and push to GitHub

### Phase 2: Branding & Design

- [x] Logo concept exploration (Round 1)
- [x] Logo refinement (Round 2)
- [x] Main logo finalized: `bucket-shades-horizontal-v3-glow.svg`
- [x] Favicon finalized: `favicon-16-int-3slat.svg`
- [x] Logo build script: `npm run build:logos` (SVG → PNG/WebP/ICO)
- [ ] Upload branding to Clerk dashboard
- [ ] Create OG image for social sharing

### Phase 3: Dependencies & Security Audit

- [x] Run `npm install`
- [x] Verify all dependencies install cleanly
- [ ] Run `npm audit` - fix any high/critical
- [ ] Generate SBOM (`npm run sbom`)
- [ ] Document any accepted risks

### Phase 4: Authentication (Clerk)

- [ ] Configure Clerk application
- [ ] Enable OAuth providers (Google, Apple, Facebook)
- [ ] Set redirect URLs (localhost + production)
- [ ] Add Clerk environment variables to `.env.local`
- [ ] Create Clerk middleware
- [ ] Create auth provider wrapper
- [ ] Test sign-in/sign-out flow

### Phase 5: Database (Convex)

- [ ] Create Convex schema (`convex/schema.ts`)
- [ ] Create query functions
- [ ] Create mutation functions
- [ ] Set up Clerk JWT verification in Convex
- [ ] Add Convex environment variables
- [ ] Test real-time subscriptions

### Phase 6: Core Features

- [ ] Public recommendations feed (unauthenticated)
- [ ] Authenticated dashboard
- [ ] Add recommendation form
- [ ] Genre filtering
- [ ] User's own recommendations view
- [ ] Delete own recommendation

### Phase 7: Admin Features

- [ ] Admin role check middleware
- [ ] Admin dashboard
- [ ] Delete any recommendation
- [ ] Mark as Staff Pick
- [ ] Initial admin bootstrap via env var

### Phase 8: Polish & Testing

- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] E2E tests passing
- [ ] Accessibility audit (axe-core)
- [ ] Security audit (OWASP checklist)
- [ ] Performance audit (Lighthouse)
- [ ] Mobile responsive verification
- [ ] RTL layout verification

### Phase 9: Deployment

- [ ] Vercel production deployment
- [ ] Convex production deployment
- [ ] Environment variables configured
- [ ] Domain configured (if applicable)
- [ ] Monitoring/observability setup

## Testing Matrix

| Category              | Tool                             | Hook              | CI  | Status     |
| --------------------- | -------------------------------- | ----------------- | --- | ---------- |
| **Unit**              | Vitest                           | pre-push          | ✓   | Configured |
| **Integration**       | Vitest + RTL                     | pre-push          | ✓   | Configured |
| **E2E**               | Playwright                       | -                 | ✓   | Configured |
| **Accessibility**     | axe-core, eslint-plugin-jsx-a11y | pre-commit (lint) | ✓   | Partial    |
| **Security (SAST)**   | eslint-plugin-security           | pre-commit        | ✓   | Configured |
| **Secrets**           | Gitleaks                         | pre-commit        | ✓   | Configured |
| **PII Detection**     | Gitleaks (custom rules)          | pre-commit        | ✓   | Configured |
| **Dependency Audit**  | npm audit                        | pre-push          | ✓   | Configured |
| **Type Safety**       | TypeScript strict                | pre-push          | ✓   | Configured |
| **Visual Regression** | Playwright screenshots           | -                 | ✓   | Configured |
| **Load/Abuse**        | k6 or Artillery                  | manual            | -   | Future     |

## Architecture Decision Records

| ADR                                           | Title                      | Status   |
| --------------------------------------------- | -------------------------- | -------- |
| [001](docs/decisions/001-tech-stack.md)       | Technology Stack Selection | Accepted |
| [002](docs/decisions/002-testing-strategy.md) | Testing Strategy           | Accepted |
| [003](docs/decisions/003-auth-flow.md)        | Authentication Flow        | Pending  |

## Environment Status

| Environment       | URL                     | Status        |
| ----------------- | ----------------------- | ------------- |
| Local Dev         | `http://localhost:3000` | Not started   |
| Vercel Preview    | TBD                     | Not deployed  |
| Vercel Production | TBD                     | Not deployed  |
| Convex Dev        | Configured              | Not connected |
| Convex Prod       | Configured              | Not connected |

## Known Issues / Tech Debt

_None yet_

## Changelog

### 0.1.0-alpha (In Progress)

- Initial project scaffolding
- Logo design finalized (Round 2)
- Testing infrastructure (Playwright, axe-core)
- Logo build pipeline (SVG → PNG/WebP/ICO)
- Documentation structure established

---

_Last updated: 2026-01-21_
