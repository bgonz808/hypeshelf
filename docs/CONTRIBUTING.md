# Contributing Guide

## Development Setup

### Prerequisites

- Node.js 20+
- npm 9+
- Git
- Gitleaks (for secret scanning)
- Accounts: Clerk, Convex, Vercel

### First-Time Setup

```bash
# Clone the repository
git clone git@github.com:bgonz808/hypeshelf.git
cd hypeshelf

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local
# Edit .env.local with your credentials

# Start development
npm run dev
```

### VS Code Setup

1. Install recommended extensions (VS Code will prompt you)
2. Copy `.vscode/settings.json.example` to `.vscode/settings.json`
3. Adjust paths if needed

## Git Workflow

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:**
| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code restructure, no behavior change |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `build` | Build system or dependencies |
| `ci` | CI/CD changes |
| `chore` | Maintenance tasks |
| `security` | Security fix |

**Examples:**

```bash
feat(auth): add Google OAuth login
fix(recommendations): prevent XSS in blurb field
docs: update README with setup instructions
chore(deps): update eslint to 8.57.0
security: sanitize user-provided URLs
```

### Branch Naming

```
<type>/<short-description>

# Examples
feat/add-genre-filter
fix/auth-redirect-loop
docs/update-architecture
```

### Pull Request Process

1. Create a feature branch from `main`
2. Make atomic commits (each commit should be bisectable)
3. Ensure all checks pass locally:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   ```
4. Push and create PR
5. Address review feedback
6. Squash merge to main

## Code Style

### TypeScript

- Strict mode enabled (no `any` escapes without justification)
- Prefer explicit return types for public functions
- Use `unknown` over `any` when type is truly unknown

### React

- Functional components only
- Use hooks appropriately
- Server Components by default, Client Components when needed
- Accessibility: all interactive elements must be keyboard accessible

### Security

- Never log sensitive data
- Validate all inputs server-side
- Use parameterized queries (Convex handles this)
- Sanitize user content before display

## Testing

```bash
# Run all tests
npm run test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Pre-commit Hooks

Husky runs automatically on commit:

1. **Gitleaks** - Scans for secrets (warns on commit)
2. **lint-staged** - Runs ESLint and Prettier on staged files
3. **commitlint** - Validates commit message format

If a hook fails, fix the issue and try again.

## Secret Handling

**NEVER commit secrets.** If you accidentally do:

1. **Immediately rotate the credential**
2. Use BFG or git-filter-repo to remove from history
3. Force push (coordinate with team)
4. Assume the secret is compromised regardless

## Questions?

Open an issue or reach out to the maintainers.
