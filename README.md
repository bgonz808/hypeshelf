# HypeShelf

A shared recommendations hub for friends - collect and share the stuff you're hyped about.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Authentication**: Clerk
- **Database**: Convex
- **Styling**: Tailwind CSS
- **Language**: TypeScript (strict mode)

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+
- Accounts on: [Clerk](https://clerk.com), [Convex](https://convex.dev), [Vercel](https://vercel.com)

### Setup

1. Clone the repository:

   ```bash
   git clone git@github.com:bgonz808/hypeshelf.git
   cd hypeshelf
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy environment template and fill in your values:

   ```bash
   cp .env.example .env.local
   ```

4. Start development servers:

   ```bash
   npm run dev
   ```

   This runs both Next.js and Convex dev servers.

## Project Structure

```
src/
├── app/           # Next.js App Router pages
├── components/    # React components
└── lib/           # Utilities and helpers
convex/            # Convex schema and functions
messages/          # i18n translation files
docs/              # Architecture documentation
```

## Scripts

| Command                 | Description               |
| ----------------------- | ------------------------- |
| `npm run dev`           | Start development servers |
| `npm run build`         | Build for production      |
| `npm run lint`          | Run ESLint                |
| `npm run typecheck`     | Run TypeScript checks     |
| `npm run test`          | Run tests                 |
| `npm run audit:deps`    | Check for vulnerabilities |
| `npm run audit:secrets` | Scan for leaked secrets   |

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Security](./docs/SECURITY.md)
- [Contributing](./docs/CONTRIBUTING.md)

## License

MIT - see [LICENSE](./LICENSE)
