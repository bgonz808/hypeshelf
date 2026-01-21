# Architecture Overview

> This document captures architectural decisions and system design for HypeShelf.

## System Overview

HypeShelf is a social recommendations platform built with:

- **Next.js 14** (App Router) - React framework with SSR/SSG capabilities
- **Clerk** - Authentication and user management
- **Convex** - Real-time database and backend functions
- **Tailwind CSS** - Utility-first styling
- **TypeScript** - Type-safe development

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (Browser)                         │
├─────────────────────────────────────────────────────────────────┤
│  Next.js App Router                                              │
│  ├── React Components                                            │
│  ├── Clerk Auth (client SDK)                                     │
│  └── Convex Client (real-time subscriptions)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Edge / Middleware                           │
├─────────────────────────────────────────────────────────────────┤
│  Clerk Middleware (auth checks, session management)              │
│  Next.js Middleware (redirects, i18n)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│       Clerk API         │     │      Convex Backend     │
├─────────────────────────┤     ├─────────────────────────┤
│ - User authentication   │     │ - Database (document)   │
│ - Session management    │     │ - Mutations (writes)    │
│ - OAuth providers       │     │ - Queries (reads)       │
│ - JWT issuance          │◄───►│ - JWT verification      │
│ - User metadata         │     │ - Real-time sync        │
└─────────────────────────┘     │ - RBAC enforcement      │
                                └─────────────────────────┘
```

## Key Design Decisions

See `docs/decisions/` for detailed Architecture Decision Records (ADRs).

### Authentication Flow

1. User clicks "Sign in" → Clerk handles OAuth/email flow
2. Clerk issues JWT → stored in secure httpOnly cookie
3. Convex verifies JWT on each request → extracts user identity
4. RBAC checks happen server-side in Convex mutations

### Data Model

```
recommendations
├── _id: Id<"recommendations">
├── title: string
├── genre: Genre (enum)
├── link: string (URL)
├── blurb: string
├── userId: string (Clerk user ID)
├── userName: string (denormalized for display)
├── isStaffPick: boolean
├── createdAt: number (timestamp)
└── updatedAt: number (timestamp)
```

### Role-Based Access Control

| Role | Capabilities |
|------|-------------|
| `user` | Create own recs, delete own recs, view all |
| `admin` | All user capabilities + delete any rec + mark Staff Pick |

Role assignment:
- Stored in Clerk user public metadata
- Checked server-side in Convex before mutations
- Initial admin bootstrapped via `INITIAL_ADMIN_EMAIL` env var

## Environment Strategy

| Environment | Purpose | Convex Deployment |
|-------------|---------|-------------------|
| Local dev | Development | Convex Dev |
| Vercel Preview | PR testing | Convex Dev |
| Vercel Production | Live app | Convex Prod |

## Future Considerations

- **Caching**: Convex provides built-in caching; evaluate if additional edge caching needed
- **Rate Limiting**: Currently relying on Convex built-in; may need custom implementation for abuse scenarios
- **Observability**: OpenTelemetry instrumentation ready; needs collector configuration for production
