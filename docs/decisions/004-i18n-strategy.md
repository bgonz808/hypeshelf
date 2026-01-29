# ADR-004: Internationalization Strategy

## Status

Accepted

## Context

ADR-001 selected **next-intl** as the i18n library and declared support for 5 locales: English (en, primary), Spanish (es), Simplified Chinese (zh), Arabic (ar, RTL), and Yiddish (yi, RTL). Translation files were scaffolded in `messages/*.json` with namespaced keys covering all existing UI concepts.

However, **zero integration code was written**. No configuration file, no provider wiring, no middleware, no component using `useTranslations()`. Every UI string in the codebase is hardcoded English. The `<html>` element hardcodes `lang="en"`. The translation files exist as content assets that nothing reads at runtime.

This ADR acknowledges the gap, reaffirms the tooling choice with updated rationale, defines the integration strategy, establishes enforcement mechanisms, and lays out a phased roadmap that decouples development work from translation work.

### Key Constraints

- **MVP scope**: The Fluence take-home evaluates code quality, security thinking, and architecture — not full multilingual support. i18n infrastructure must be demonstrably sound without requiring complete translations.
- **Developer workflow**: Developers write in English (the base language). The system must be correct by default — no reliance on human memory for tagging, tracking, or filing translation work.
- **Decoupled concerns**: Developers are not translators. Translation can happen asynchronously, by different people, using different tools, without blocking feature development.

## Decision

### 1. Library: next-intl 4.x (Reaffirmed)

ADR-001 listed next-intl 3.x. We are now on **4.7.0**, which uses a different configuration API (`i18n/request.ts` instead of the older `i18n.ts`). We reaffirm next-intl as the correct choice.

**Alternatives evaluated:**

| Library                    | Strengths                                       | Why not                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **typesafe-i18n**          | Generated types, interpolation safety           | Not Next.js-native; no server component support; replaces next-intl entirely; different file format (TS literals, not JSON) — migration cost with no proportional benefit |
| **react-intl (FormatJS)**  | Mature, has extraction CLI (`formatjs extract`) | React-generic, not App Router optimized; server component story weaker                                                                                                    |
| **i18next + next-i18next** | Largest ecosystem, `i18next-parser` extraction  | `next-i18next` lags App Router support; built for Pages Router                                                                                                            |
| **Paraglide (Inlang)**     | Compiler-based, VS Code extension, extraction   | Young ecosystem; risky for MVP demonstrating maturity                                                                                                                     |

**Rationale for next-intl:**

- Native App Router and server component support (layout.tsx is a server component)
- Existing `messages/*.json` files are directly compatible — zero migration
- Type safety via `IntlMessages` global declaration closes the gap with typesafe-i18n
- Most actively maintained Next.js-specific i18n library
- Fallback chains built in (missing key in `es.json` → falls back to `en.json`)

### 2. Base Language: English

English (`en.json`) is the canonical source of truth for all translation keys. All development defaults to English. Non-English contributions are supported (see Signal Stack below) but English remains the base from which all translations derive.

### 3. Locale Routing: Deferred

No `/en/`, `/es/` URL prefixes for MVP. Reasons:

- Adds middleware complexity (rewrites, cookie detection, redirect chains) orthogonal to the core goal of eliminating hardcoded strings
- The app is primarily English for the demo
- Locale routing is **additive** — it can be layered on later without restructuring components

When locale routing is added (post-MVP), it will use next-intl's middleware with cookie-based locale persistence and `Accept-Language` header detection.

### 4. Type Safety: Global IntlMessages Declaration

```typescript
// global.d.ts
type Messages = typeof import("../messages/en.json");
declare interface IntlMessages extends Messages {}
```

This gives:

- Compile-time errors for misspelled or missing keys (`t("nonexistent.key")` fails `tsc`)
- Autocomplete for all available keys in editors
- No additional dependency — uses next-intl's built-in TypeScript support

### 5. Key Naming Convention

Keys mirror the component tree using descriptive paths:

```
recommendations.add       ✓  (self-evident)
recommendations.title     ✓  (clear context)
r.a                       ✗  (opaque)
genres.sci-fi             ✓  (namespace + slug)
```

Top-level namespaces correspond to feature areas: `common`, `auth`, `home`, `recommendations`, `genres`, `filters`, `admin`. New features add new namespaces.

### 6. Translation Maturity Levels

| Level | Name          | Meaning                                                  | Enforcement                         |
| ----- | ------------- | -------------------------------------------------------- | ----------------------------------- |
| 0     | **Hardcoded** | Raw string literal in JSX                                | ESLint warns; must not persist      |
| 1     | **en-only**   | Uses `t()`, key in `en.json` only                        | Minimum for any committed code      |
| 2     | **Partial**   | Key in en + some locales (machine or human)              | Acceptable for non-critical paths   |
| 3     | **Full**      | Key in all locales, at least one human review per locale | Required for production-critical UI |

### 7. Provenance Tracking: i18n-status.json Sidecar

Translation metadata lives in `i18n-status.json`, separate from the message files (which must remain flat string values for next-intl compatibility).

```jsonc
{
  "genres.rock": {
    "en": {
      "method": "authored",
      "author": "bgonz808",
      "date": "2026-01-29",
      "commit": "abc1234",
    },
    "es": {
      "method": "machine",
      "engine": "deepl",
      "source": "en",
      "date": "2026-01-29",
      "commit": "def5678",
      "reviews": [],
    },
    "ar": {
      "method": "machine",
      "engine": "deepl",
      "source": "en",
      "date": "2026-01-30",
      "commit": "def5678",
      "reviews": [
        {
          "reviewer": "native-speaker-id",
          "date": "2026-02-01",
          "verdict": "approved",
        },
      ],
    },
  },
}
```

Fields:

- **method**: `authored` (human wrote directly), `machine` (auto-translated), `reviewed` (machine + human approved)
- **engine**: Translation engine used (`deepl`, `gpt-4`, `google`, etc.) — only for `method: machine`
- **source**: Locale translated from — only for `method: machine`
- **reviews**: Array of human review records with verdict (`approved`, `revised`)

### 8. Gating Strategy

#### Commit-level (pre-commit, Husky + lint-staged)

- `eslint-plugin-i18next` `no-literal-string` at **warn** — developer sees warnings, commit proceeds
- No commit block for i18n. Rationale: blocking commits during active development creates friction that makes developers resent the system. Warn-and-proceed maintains awareness without breaking flow.

#### Pre-push (Husky)

- `i18n:check` script runs. Warns on missing keys in non-en locales. **Errors** on:
  - Keys referenced in source (`t("x")`) that don't exist in `en.json` (would break at runtime)
  - Malformed JSON in any locale file

#### CI (GitHub Actions)

- `i18n:check` runs as a CI job alongside lint and security
- **Hard fail**: `t()` key missing from `en.json`; malformed locale JSON
- **Warn (annotation)**: keys missing in non-en locales
- **Waiver mechanism**: `i18n-waivers.json` declares acknowledged gaps with reason and milestone

```json
{
  "waivers": [
    {
      "keys": ["admin.*"],
      "locales": ["ar", "yi"],
      "reason": "Admin UI is English-only for MVP",
      "milestone": "post-launch",
      "author": "bgonz808",
      "date": "2026-01-29"
    }
  ]
}
```

CI reads this file and suppresses warnings for waived key/locale combinations.

#### ESLint Rule Escalation

| Phase                                    | `no-literal-string` | Scope                                                        |
| ---------------------------------------- | ------------------- | ------------------------------------------------------------ |
| Phase 1-2 (infrastructure + enforcement) | `warn`              | `src/components/**`, `src/app/**`                            |
| Phase 3+ (detection)                     | `error`             | Same scope, exceptions via eslint-disable with justification |

### 9. Language Detection Signal Stack

When tooling encounters a new string (during extraction or CI audit), these signals combine to determine the language, in priority order:

```
Signal 1: Content detection (franc/tinyld)
  "This string's character patterns suggest Portuguese"
  Strength: Primary automated signal. High confidence for non-Latin
  scripts (CJK, Arabic, Hebrew). Lower for short Latin-script strings.

Signal 2: System locale (Intl API)
  "Developer's system reports pt-BR"
  Strength: Good default for interactive prompts. Zero cost.
  Does NOT override content detection — a pt-BR system developer
  may be writing English.

Signal 3: Git history (i18n-status.json)
  "This author has previously contributed pt-BR strings"
  Strength: Tiebreaker for ambiguous Latin-script strings.
  NEVER assumes non-English on history alone. A developer who
  contributed pt-BR last month may be writing English today.
  Also tracks that an author may contribute to multiple languages.

Signal 4: Spell check (cspell, post-confirmation)
  "Confirmed as pt-BR — checking spelling against pt-BR dictionary"
  Strength: Catches typos in the confirmed language. Runs after
  human confirms, not before.

Signal 5: Human confirmation
  "Yes, this is pt-BR" / adjusts
  Strength: Non-negotiable final gate. All other signals improve
  the default presented to the human.
```

**Design principle**: Signals improve the default suggestion so that human confirmation is usually "press Enter." No signal overrides human intent. Ambiguity is surfaced, never silently resolved.

### 10. Non-English Developer Workflow

When a developer whose primary language is not English contributes strings:

1. Developer writes `t("feature.title")` in the component (same as anyone)
2. During extraction, content detection flags the string as non-English
3. System locale provides a default language suggestion
4. Developer confirms the language
5. String goes into the correct locale file (e.g., `pt-BR.json`)
6. `en.json` gets an empty value for the key, marked `needs-translation` in `i18n-status.json`
7. CI reports the empty `en.json` value as needing translation
8. Translation (human or machine) fills the `en.json` gap asynchronously

This keeps `en.json` as the canonical key registry while acknowledging that the first draft of a string may not be English.

### 11. Considered and Rejected: IP Geolocation

Network-based location detection (office IP ranges, GeoIP) was evaluated as an additional developer locale signal. **Rejected** because:

- Incompatible with VPN and remote work patterns
- Requires network access, but extraction tooling must work offline
- System locale provides equivalent signal without privacy implications
- Developer tooling should not collect or infer location data without explicit consent

This reflects the project's security-first posture. In a corporate environment with fixed office locations and explicit consent, IP-based hints could supplement system locale, but the trust and privacy tradeoffs favor the simpler signal for this project.

### 12. Spell Checking per Locale

**cspell** configured with per-locale-file language overrides:

```jsonc
// cspell.json (relevant excerpt)
{
  "overrides": [
    { "filename": "messages/en.json", "language": "en" },
    { "filename": "messages/es.json", "language": "es" },
    { "filename": "messages/zh.json", "language": "en,zh" },
    { "filename": "messages/ar.json", "language": "en,ar" },
    { "filename": "messages/yi.json", "language": "en,yi" },
  ],
}
```

Catches typos in translation values that content detection wouldn't flag (e.g., "Recomendation" is classified as English but is misspelled).

### 13. Machine Translation Workflow (Phase 5)

A separate CI/CD job, triggered on schedule or manually:

1. Diffs `en.json` against each locale file to find missing keys
2. For each missing key, gathers context (namespace, neighboring keys in same namespace) to improve translation quality
3. Calls translation API (DeepL or equivalent) with context
4. Runs spell check on results
5. Writes to locale files
6. Records provenance in `i18n-status.json` as `method: machine`
7. Opens a PR: `chore(i18n): machine-translate N new keys`
8. PR body includes per-key provenance table for reviewer
9. PR requires human review before merge — machine translations never land on main without human eyes

### 14. Cross-Locale Visibility

- **VS Code**: i18n Ally extension for inline translation visibility, missing key highlighting, and side-panel editing
- **CI report**: `i18n:check` outputs a coverage matrix showing per-locale, per-namespace completeness and translation method breakdown
- **Post-MVP**: The coverage matrix could be published as a PR comment or dashboard artifact

## Phased Roadmap

### Phase 1: Infrastructure (MVP)

Wire up next-intl so the system works end-to-end with `en.json`.

- Create `src/i18n/request.ts` configuration
- Add `NextIntlClientProvider` to layout
- Add `global.d.ts` IntlMessages type declaration
- Convert at least one component to `useTranslations()` to prove the pipeline
- Update `<html lang>` to use locale from next-intl

### Phase 2: Enforcement (MVP)

Establish guardrails that prevent regression and track provenance.

- Install `eslint-plugin-i18next`, configure `no-literal-string` as `warn` for `src/components/**` and `src/app/**`
- Create `scripts/i18n-check.ts` — validates key completeness across locales, detects malformed JSON, reports coverage matrix
- Create `i18n-status.json` sidecar with provenance schema (initially empty, populated as components migrate)
- Create `i18n-waivers.json` with initial MVP waivers
- Add `i18n:check` to `package.json` scripts
- Add `i18n:check` to CI workflow (new job in `.github/workflows/ci.yml`)
- Add `i18n:check` to pre-push hook

### Phase 3: Detection

Automated language and quality detection.

- Add content-based language detection (franc or tinyld) to `i18n:check` script — flag values in `en.json` that don't detect as English
- Add system locale detection utility for extraction tooling
- Add git history heuristic (read `i18n-status.json` for author's past language contributions)
- Configure `cspell` with per-locale language overrides
- Add cspell to CI and/or pre-push

### Phase 4: Extraction DX

Interactive tooling to reduce friction from Level 0 → Level 1.

- Build extraction helper script (`scripts/i18n-extract.ts`):
  - Runs ESLint `no-literal-string` in JSON output mode to find hardcoded strings
  - For each violation: proposes key path (from file path + string content), runs language detection, presents default with system locale
  - High-confidence English: auto-slots into `en.json`, minimal prompt
  - Detected non-English or ambiguous: prompts with detected language, developer confirms
  - Writes to correct locale file, adds provenance to `i18n-status.json`
  - Post-confirmation: runs spell check on the value
- Escalate `no-literal-string` from `warn` to `error`

### Phase 5: Auto-Translation

Machine translation with human review gate.

- Build CI job (`i18n-translate.yml`):
  - Trigger: scheduled (weekly), manual (`workflow_dispatch`), or post-merge when `en.json` changes
  - Diffs en.json against locale files for missing keys
  - Translates with context (namespace, neighboring keys)
  - Spell checks results
  - Opens PR with provenance table in body
  - PR requires human review before merge
- Integrate review verdicts back into `i18n-status.json` provenance

### Future: Locale Routing

When user-facing language switching is needed:

- Add next-intl middleware for `/en/`, `/es/`, etc. prefix routing
- Cookie-based locale persistence
- `Accept-Language` header detection for initial visit
- Language picker component in header

## Consequences

### Positive

- **Correct by default**: No reliance on developer memory for tagging, tracking, or provenance
- **Decoupled workflows**: Developers ship features in English; translators work asynchronously; machine translation fills gaps automatically
- **Incremental progress**: Every phase is independently valuable — stop at any phase and the system is coherent
- **Type safety**: Misspelled keys caught at compile time, not runtime
- **Auditable**: Full provenance chain from string creation through translation to human review
- **Existing assets preserved**: All 5 locale JSON files work as-is with next-intl

### Negative

- **Phase 4-5 are custom tooling**: No off-the-shelf tool does extraction + detection + provenance for next-intl. Build cost is real.
- **Initial ESLint noise**: `no-literal-string` as warn will flag ~200+ existing violations until components are migrated
- **Sidecar maintenance**: `i18n-status.json` must be kept in sync with message files. Tooling mitigates this but it's an additional artifact.

### Mitigations

- Phase 4-5 tooling is documented but deferred — the ADR proves the thinking without requiring implementation for MVP
- ESLint warn (not error) avoids blocking development during migration
- The `i18n:check` script validates sidecar/message file consistency

## Relationship to Other ADRs

- **ADR-001**: Selected next-intl 3.x. This ADR updates to 4.x (different config API), reaffirms the choice with expanded rationale, and **implements what ADR-001 proposed but never delivered**. This is not a tooling change — it is the completion of an existing commitment.
- **ADR-002**: Testing strategy. i18n adds a new testing dimension: `i18n:check` in CI alongside existing lint, typecheck, and security jobs. The integration follows the same defense-in-depth pattern (commit → push → CI).
- **ADR-003**: Security scanning. Language detection signals follow the same principle of multiple independent signals combining for confidence (like SAST + DAST + secrets scanning). The IP geolocation rejection reflects the same security-first posture documented in ADR-003.

## References

- [next-intl documentation (App Router)](https://next-intl.dev/docs/getting-started/app-router)
- [next-intl TypeScript integration](https://next-intl.dev/docs/workflows/typescript)
- [eslint-plugin-i18next](https://github.com/edvardchen/eslint-plugin-i18next)
- [franc — natural language detection](https://github.com/wooorm/franc)
- [cspell — spell checker with multi-language support](https://cspell.org/)
- [i18n Ally — VS Code extension](https://marketplace.visualstudio.com/items?itemName=Lokalise.i18n-ally)

---

## Implementation Log

Commits implementing this ADR, recorded as completed:

### Phase 1: Infrastructure

**Commit**: `bae6958` — `feat(i18n): wire up next-intl infrastructure (ADR-004 Phase 1)`

- Created `src/i18n/request.ts` — next-intl request config (hardcoded `en`, routing deferred)
- Converted `next.config.js` → `next.config.mjs` with `createNextIntlPlugin`
- Created `global.d.ts` — `IntlMessages` type declaration for compile-time key safety
- Updated `src/app/layout.tsx` — `NextIntlClientProvider`, dynamic `lang` attribute via `getLocale()`
- Converted `src/components/Header.tsx` — first component using `useTranslations()` (`auth` + `recommendations` namespaces)
- Added `*.d.json.ts` to `.gitignore`

### Phase 2: Enforcement

**Commit**: (this commit) — `feat(i18n): add enforcement tooling (ADR-004 Phase 2)`

- Installed `eslint-plugin-i18next@6.1.3` — `no-literal-string` rule at `warn` for `src/components/**` and `src/app/**`
- Created `scripts/i18n-check.ts` — validates key completeness, empty values, stale keys, coverage matrix, waiver-aware
- Created `i18n-status.json` — provenance tracking sidecar (schema defined, initially empty)
- Created `i18n-waivers.json` — 2 initial waivers (admin UI en-only, non-en locales pending review)
- Added `i18n:check` npm script
- Added `i18n:check` CI job in `.github/workflows/ci.yml`
- Added `i18n:check` to `.husky/pre-push` hook

### Phase 3: Detection

**Commit**: `65e5e07` — `feat(i18n): add language detection and spellcheck (ADR-004 Phase 3)`

- Integrated `franc@6.2.0` for language detection in `i18n-check.ts` — flags `en.json` values that don't detect as English
- Set 20-char minimum threshold for franc detection (short strings produce too many false positives)
- Created `cspell.json` — spell checking with per-locale overrides (non-Latin locales disabled, custom word list)
- Added `spellcheck` npm script for `messages/**/*.json` and `src/**/*.{ts,tsx}`
- Dynamic `import("franc")` — graceful degradation when not installed

### Related Commits (same session)

- `92505c3` — `feat(schema): replace genre enum with free-form string + curated suggestions` — expanded i18n genre keys across all 5 locales (music, game, board-game genres)
- `a088f3a` — `docs(adr): add ADR-004 internationalization strategy` — this document
