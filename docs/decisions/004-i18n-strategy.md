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

### 7. Provenance Tracking: i18n-status.jsonl (Append-Only JSONL)

Translation metadata lives in `i18n-status.jsonl`, separate from the message files (which must remain flat string values for next-intl compatibility).

**Format**: Append-only JSONL (one JSON object per line). On read, last-write-wins for duplicate `(key, locale)` pairs — updates are new appended lines, no rewrite needed. A crash can only lose the incomplete last line, never corrupt prior records. Malformed lines (crash residue) are silently skipped.

> **Migration note**: Originally `i18n-status.json` (monolithic JSON). Migrated to JSONL in `4a7cf89` because JSON requires full-file rewrite on every update, making it vulnerable to corruption on crash. JSONL's append-only semantics are inherently crash-safe.

```jsonl
{"key":"genres.rock","locale":"en","method":"authored","date":"2026-01-29","contentHash":"a1b2c3d4e5f6","lifecycleAction":"created","lifecycleAt":"2026-01-29T15:00:00.000Z"}
{"key":"genres.rock","locale":"es","method":"machine","engine":"mymemory","source":"en","date":"2026-01-29","contentHash":"f6e5d4c3b2a1","lifecycleAction":"created","lifecycleAt":"2026-01-29T15:01:00.000Z"}
```

Fields:

- **key**, **locale**: Routing fields (which translation this record describes)
- **method**: `authored` (human wrote directly), `machine` (auto-translated), `machine-needs-review`, `reviewed` (machine + human approved)
- **engine**: Translation engine used (`mymemory`, `libretranslate`, `deepl`, etc.) — only for `method: machine`
- **source**: Locale translated from — only for `method: machine`
- **date**: Date string (YYYY-MM-DD)
- **contentHash**: SHA-256 prefix (12 hex chars) of the translation value. Detects drift: if the translation changes without a provenance update, the hash won't match
- **lifecycleAction**: `created`, `updated`, `reviewed`, or `audited` — what happened
- **lifecycleAt**: UTC ISO-8601 timestamp (Z suffix) — when it happened

**Integrity features** (added in Phase 4 hardening):

1. **Content hash drift detection**: Audit tooling compares stored `contentHash` against SHA-256 of the current translation value. Mismatch means the translation changed without provenance update.
2. **Atomic flush**: Message JSON files are written via temp-file + rename (POSIX-atomic for same-volume; Windows best-effort with git as safety net).
3. **Sidecar cross-validation**: `i18n-check` flags orphaned provenance (key deleted from messages) and missing provenance (translations with no tracking record).

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

Signal 3: Git history (i18n-status.jsonl)
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
6. `en.json` gets an empty value for the key, marked `needs-translation` in `i18n-status.jsonl`
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

A CI job (`i18n-translate.yml`), triggered manually (`workflow_dispatch`) or on `en.json` changes:

1. Diffs `en.json` against each locale file to find missing keys
2. For each missing key, gathers context using namespace-aware strategies:
   - **Sibling batching**: namespaces with ≥5 keys (e.g., `genres.*`) are comma-batched in one request — sibling context disambiguates polysemous terms (see Addendum A)
   - **Bracket hints**: isolated short strings (≤2 words) get a `[namespace hint]` suffix, stripped from the result
   - **Raw**: sentences (≥3 words) translate without context augmentation
3. Calls MyMemory API (primary; free tier, 50K chars/day with email). LibreTranslate available as optional paid fallback.
4. Post-validates: placeholder preservation (`{count}` etc.), split alignment for batches, bracket remnant check, empty result detection
5. Runs spell check on results via `cspell`
6. Writes to locale files (atomic flush via `MessageFileManager`)
7. Records provenance in `i18n-status.jsonl` as `method: machine` with content hash, lifecycle timestamp, and provider name
8. Opens a PR: `chore(i18n): machine-translate N new keys` with per-key provenance table (match quality, human-TM vs MT source, alternatives, flags for context-stuffed strings)
9. PR requires human review before merge — machine translations never land on main without human eyes
10. Manual override map (`translation-overrides.json`) bypasses API for known polysemous failures (see Addendum A)

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
- Create provenance sidecar with schema (initially `i18n-status.json`; migrated to `i18n-status.jsonl` in Phase 4)
- Create `i18n-waivers.json` with initial MVP waivers
- Add `i18n:check` to `package.json` scripts
- Add `i18n:check` to CI workflow (new job in `.github/workflows/ci.yml`)
- Add `i18n:check` to pre-push hook

### Phase 3: Detection

Automated language and quality detection.

- Add content-based language detection (franc or tinyld) to `i18n:check` script — flag values in `en.json` that don't detect as English
- Add system locale detection utility for extraction tooling
- Add git history heuristic (read `i18n-status.jsonl` for author's past language contributions)
- Configure `cspell` with per-locale language overrides
- Add cspell to CI and/or pre-push

### Phase 4: Extraction DX + Provenance Hardening

Interactive tooling to reduce friction from Level 0 → Level 1, plus integrity hardening of the provenance system.

- Build extraction helper script (`scripts/i18n-extract.ts`):
  - Runs ESLint `no-literal-string` in JSON output mode to find hardcoded strings
  - For each violation: proposes key path (from file path + string content), runs language detection, presents default with system locale
  - High-confidence English: auto-slots into `en.json`, minimal prompt
  - Detected non-English or ambiguous: prompts with detected language, developer confirms
  - Writes to correct locale file, adds provenance to `i18n-status.jsonl`
  - Post-confirmation: runs spell check on the value
- Build translation provenance audit (`scripts/i18n-audit-translations.ts`):
  - Flags non-en translations lacking provenance records
  - Optional back-translation via MyMemory with Jaccard similarity plausibility scoring
  - Cache layer (`.i18n-plausibility-cache.json`) keys on SHA-256 of (locale, key, localValue, enValue) to avoid redundant API calls
  - `i18n:audit` (warn-only) and `i18n:audit:strict` (exit 1) npm scripts; wired into CI
- Provenance integrity hardening:
  - SHA-256 content hash in each provenance record (drift detection)
  - Atomic flush: temp-file + rename for message JSON; append-only for JSONL
  - `i18n-check` cross-validates sidecar against message files (orphaned + missing provenance)
- Migrate provenance from `i18n-status.json` to append-only `i18n-status.jsonl` (crash-safe, no full-file rewrite)
- Add `lifecycleAction` and `lifecycleAt` fields to provenance records (auditable history)
- Centralize `utcDate()` and `utcTimestamp()` helpers in `message-manager.ts` (store-UTC convention)
- Escalate `no-literal-string` from `warn` to `error`

### Phase 5: Auto-Translation

Machine translation with human review gate. See **Addendum A** for probe results informing these decisions.

- Build context-aware batch translation script (`scripts/i18n-translate-batch.ts`):
  - Headless (non-interactive) mode for CI — reuses `MessageFileManager` and `ProviderChain` from Phase 4
  - Context-stuffing: namespace sibling batching (≥5 siblings), bracket hints (≤2 words), raw (sentences)
  - Placeholder extraction/reinsertion (`{count}`, `{name}`, etc.) to prevent mangling
  - Post-validation: split alignment, bracket remnant check, empty result check
  - Manual override map (`translation-overrides.json`) for polysemous terms that resist automated disambiguation
- Build translation utilities (`src/lib/translation-utils.ts`):
  - Locale-aware delimiter splitting (regex: `[、，،,]`)
  - Bracket hint stripping (handles `[...]`, `（...）`, `「...」`, `«...»`, `„..."`)
  - `Intl.Segmenter`-based CJK word extraction (zero dependencies)
- Build CI job (`i18n-translate.yml`):
  - Trigger: `workflow_dispatch` (manual), or post-merge when `messages/en.json` changes
  - Runs batch translation script
  - Commits to branch, opens PR via `gh pr create`
  - PR body: per-key provenance table with match quality, human-TM vs MT source, alternatives, flags
  - PR requires human review before merge
- Provider configuration:
  - **Primary**: MyMemory (free, 50K chars/day with email). No API key needed.
  - **Fallback**: LibreTranslate demoted — requires paid API key ($29+/mo) or self-hosting since late 2025. Optional; configure via `LIBRETRANSLATE_API_KEY` env var if available.
  - **Budget enforcement**: Track chars per provider per day in `.i18n-usage.json`. Abort with clear error if quota would be exceeded.
- Integrate review verdicts back into `i18n-status.jsonl` provenance (post-MVP: script triggered on PR merge)

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
- **Sidecar maintenance**: `i18n-status.jsonl` must be kept in sync with message files. Tooling mitigates this (content hash drift detection, sidecar cross-validation) but it's an additional artifact.

### Mitigations

- Phase 4-5 tooling is documented but deferred — the ADR proves the thinking without requiring implementation for MVP
- ESLint warn (not error) avoids blocking development during migration
- The `i18n:check` script validates sidecar/message file consistency, including orphaned and missing provenance
- Content hash drift detection catches silent translation edits
- Append-only JSONL eliminates the crash-corruption risk of the original JSON sidecar

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
- Created `i18n-status.json` — provenance tracking sidecar (schema defined, initially empty; later migrated to JSONL in Phase 4)
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

### Phase 4: Extraction DX + Provenance Hardening

**Commit 1**: `de4bb06` — `feat(i18n): add interactive extraction and translation script (ADR-004 Phase 4)`

- Created `scripts/i18n-extract.ts` — interactive CLI: finds ESLint violations, POS-tags context, machine-translates with back-translation sanity checking, writes to message files with provenance
- Created `scripts/lib/translation-providers.ts` — MyMemory (primary) + LibreTranslate (fallback) with quota tracking and Jaccard similarity scoring
- Created `scripts/lib/eslint-parser.ts` — runs ESLint `no-literal-string` in JSON mode, parses violations with file context
- Created `scripts/lib/string-analyzer.ts` — POS tagging via `compromise`, heuristic key suggestion from file path + string content
- Created `scripts/lib/message-manager.ts` — atomic JSON read/write for all locale files + i18n-status.json provenance sidecar
- Added `@inquirer/prompts@8.2.0`, `compromise@14.14.5`, `chalk@5.6.2` devDependencies (exact-pinned)
- Added `i18n:extract` npm script
- Added `.i18n-usage.json` to `.gitignore` (quota tracking)

**Commit 2**: `e4f153f` — `feat(i18n): add translation provenance audit with plausibility cache`

- Created `scripts/i18n-audit-translations.ts` — flags non-en translations without provenance; optional back-translation plausibility scoring via MyMemory API
- Cache layer (`.i18n-plausibility-cache.json`) keys on SHA-256 of (locale, key, localValue, enValue) — unchanged translations reuse prior results
- Added `i18n:audit` (warn-only) and `i18n:audit:strict` (exit 1) npm scripts
- Wired `i18n:audit` into CI i18n job

**Commit 3**: `9267da0` — `feat(i18n): add provenance integrity checks and atomic file writes`

- Content hash: SHA-256 prefix stored in each provenance entry; audit script reports drifted entries
- Atomic flush: write to `.tmp` sibling then rename (POSIX-atomic; Windows best-effort, git safety net)
- Sidecar validation in `i18n-check`: cross-references provenance against message files (orphaned + missing)

**Commit 4**: `4a7cf89` — `refactor(i18n): migrate provenance from JSON to append-only JSONL`

- Replaced `i18n-status.json` with `i18n-status.jsonl` — one JSON object per line, append-only
- On read: last-write-wins for duplicate (key, locale) pairs; malformed lines silently skipped
- On write: `fs.appendFileSync` — crash can only lose incomplete last line, never corrupt prior records
- Updated all consumers: `message-manager.ts`, `i18n-audit`, `i18n-check`

**Commit 5**: `cf6eaff` — `feat(i18n): add lifecycle tracking fields and centralize UTC helpers`

- Added `lifecycleAction` (`created` | `updated` | `reviewed` | `audited`) and `lifecycleAt` (UTC ISO-8601) to provenance records
- Centralized `utcDate()` and `utcTimestamp()` in `message-manager.ts` — single canonical location for date formatting, eliminating scattered `toISOString()` calls
- Store-UTC, display-local convention established

### Phase 5: Hybrid Auto-Translation Infrastructure

**Commit**: (this commit) — `feat(i18n): add hybrid auto-translation infrastructure (ADR-004 Phase 5)`

Hybrid translation system with graceful degradation. Newcomers without Docker/GPU get Dictionary + MyMemory (fully functional). Full stack adds local NLLB model and LM Studio validation.

**Provider priority chain**:

1. **Dictionary** — curated translations for ~15 polysemous terms (Rock, Metal, Country, etc.). Domain inferred from key namespace (`genres.*` → music). Single matching sense = high confidence (0.95), done. Ambiguous = fall through.
2. **Local NLLB-600M** (localhost:8000, Docker) — Facebook's distilled model via FastAPI container. CPU by default, GPU optional. Lazy port probe, cached for session.
3. **MyMemory** (cloud fallback) — 50K chars/day free tier. Back-translation sanity check for strings ≥ 3 words.
4. **LM Studio** (localhost:1234, optional) — Scores winning translation via chat completions API. Flags low quality with confidence penalty.

**New files**:

- `scripts/lib/port-checker.ts` — TCP probe + HTTP health checks for local services (zero deps, `node:net` + `fetch`)
- `scripts/lib/dictionary-provider.ts` — Curated dictionary with domain-aware lookups for polysemous UI terms
- `scripts/lib/local-model-provider.ts` — NLLB client with BCP-47 → Flores-200 code mapping, 30s inference timeout
- `scripts/lib/lm-studio-validator.ts` — Post-processing validator (NOT a TranslationProvider), normalizes 1-10 scores to 0..1
- `scripts/lib/translation-strategy.ts` — Orchestrator: decides provider per key, computes confidence composite, builds audit trail
- `scripts/i18n-translate-batch.ts` — Headless batch script: `--locale=es`, `--dry-run`, `--force`, service availability table, per-key audit trail
- `docker/docker-compose.i18n.yml` + `docker/Dockerfile.nllb` + `docker/nllb-server.py` — NLLB container with FastAPI, model cached in Docker volume

**Modified files**:

- `scripts/lib/translation-providers.ts` — Added optional `context?: { key?: string }` to `TranslationProvider.translate()` (backward compatible)
- `scripts/lib/message-manager.ts` — Extended `ProvenanceEntry` with `confidence`, `translationMethod`, `report` fields (backward compatible)
- `package.json` — Added `i18n:translate`, `i18n:services:up`, `i18n:services:down` scripts

**Architecture decisions**:

- Zero new npm dependencies — all new code uses `node:net`, global `fetch`, and existing deps
- Dictionary is embedded as a TypeScript const (no external JSON file to load/parse)
- `TranslationStrategy` does NOT modify `createProviderChain()` — existing `i18n-extract.ts` keeps working unchanged
- NLLB Yiddish uses Hebrew model code (`heb_Hebr`) — closest available in NLLB's Flores-200 taxonomy
- Confidence scoring: dictionary 0.95, NLLB 0.7, MyMemory 0.6, adjusted by back-translation quality and LM Studio validation

**Deferred items**:

- CI workflow (`i18n-translate.yml`) for automated PR creation on `en.json` changes
- Full Wiktionary dump parsing for dictionary expansion
- Opus-MT as alternative local model (lighter weight, different language pairs)
- Argos Translate integration (offline, LGPL)

**Self-hosting findings**:

- NLLB-200 distilled 600M: ~1.2 GB download, ~2 GB RAM, CPU inference ~2-5s/sentence
- Opus-MT: ~300 MB per language pair, faster CPU inference, but separate model per pair
- Argos Translate: ~100 MB per pair, LGPL, Python package with optional GUI

### Related Commits (same session)

- `92505c3` — `feat(schema): replace genre enum with free-form string + curated suggestions` — expanded i18n genre keys across all 5 locales (music, game, board-game genres)
- `a088f3a` — `docs(adr): add ADR-004 internationalization strategy` — this document
- `e95f431` — `feat(lint): add no-fragile-date-ops ESLint rule and temporal constants` — custom ESLint rule enforcing the `utcDate()`/`utcTimestamp()` convention established in commit 5, plus named temporal constants for all date arithmetic

---

## Addendum A: Translation API Probe Results (Phase 5 Pre-Work)

> Added 2026-01-29. Raw API responses stored in `.translation-probe/` (gitignored).

### Glossary

**Polysemy**: A single word having multiple distinct meanings. "Rock" is polysemous: it means a stone (geology), a music genre, or a verb (to rock). Translation APIs cannot disambiguate polysemous words without context — they pick one meaning, often the most common corpus occurrence, which may not match the intended domain. This is the central challenge for translating short UI strings like genre labels.

### Provider Status

#### MyMemory (Primary)

- **Status**: Operational. Free tier works reliably.
- **Quota model**: Per-character, not per-request. Anonymous: 5K chars/day. With email (`de=` parameter): 50K chars/day. Whitelisted CAT tools: 150K chars/day.
- **Max query size**: 500 bytes per request.
- **Response headers**: No quota/rate-limit headers returned. Quota status is in the JSON body: `"quotaFinished": false`. No `X-RateLimit-*` or `Retry-After` headers.
- **Response metadata**: `matches[]` array with `created-by` (human TM `"MateCat"` vs machine `"MT!"`), `quality` score (74 = human, 70 = machine), `match` score (0–1 fuzzy TM similarity), `model` field (`"neural"` when MT), `usage-count`, and source/target locale variants.
- **No linguistic metadata**: No POS tagging, no disambiguation signals, no confidence score on the primary result. `match: 1.0` means "exact TM hit" but says nothing about semantic correctness for our domain.

#### LibreTranslate (Fallback)

- **Status**: Requires paid API key since late 2025. Public instance returns `400 Bad Request` with `{"error":"Visit https://portal.libretranslate.com to get an API key"}`.
- **Pricing**: Pro $29/mo (80 req/min burst, 2K char limit per call), Business $58/mo (200 req/min burst).
- **`/frontend/settings` confirms**: `"keyRequired": true`, `"charLimit": 2000`.
- **`/languages` works** without a key (read-only metadata endpoint), confirming the instance is live — only translation endpoints are gated.
- **Self-hosting**: LibreTranslate is open-source (AGPLv3). Self-hosting avoids the API key requirement but adds infrastructure burden.
- **Decision**: Demote from "fallback provider" to "optional paid/self-hosted provider." MyMemory alone is sufficient for our ~80-key, 5-locale scope. At ~4K chars per full translation pass, even anonymous MyMemory (5K/day) covers a single run. With email, 50K/day allows ~12 full passes.

### Probe Findings: Disambiguation

#### Problem: Polysemous single words

| Word  | Target | Bare result                | Correct? | Context-stuffed result      | Correct? |
| ----- | ------ | -------------------------- | -------- | --------------------------- | -------- |
| Rock  | zh-CN  | 岩石 (stone)               | No       | 摇滚 (music, via batch)     | Yes      |
| Metal | zh-CN  | 金属 (physical)            | No       | 金属 (still physical)       | No       |
| Live  | ar     | [untranslated placeholder] | No       | مباشر (real-time, via hint) | Yes      |
| Post  | es     | Publicación (noun)         | Partial  | Publicar (verb, via hint)   | Yes      |
| Party | zh-CN  | 派对 (social party)        | Partial  | 派对 (same)                 | Partial  |

Metal → zh-CN remains incorrect even with sibling context. This is a known limitation: when the dominant corpus meaning (physical metal) overwhelms the domain sense (music genre), no amount of sibling context recovers the right translation. A manual override map is required for these cases.

#### Solution: Context-stuffing strategies

**Strategy 1: Namespace sibling batching.** Send all `genres.*` values as a comma-delimited list: `"Rock, Jazz, Classical, Hip-Hop, ..."`. The API uses sibling context to disambiguate. Tested with 12 and 30 items across all 4 target locales — **100% positional alignment on split**.

Locale-appropriate delimiters in results:

| Locale | Delimiter used | Unicode                        |
| ------ | -------------- | ------------------------------ |
| es     | `, `           | U+002C (ASCII comma)           |
| zh-CN  | `、`           | U+3001 (CJK enumeration comma) |
| ar     | `،`            | U+060C (Arabic comma)          |
| yi/he  | `, `           | U+002C (ASCII comma)           |

Split regex: `[、，،,]` covers all observed delimiters. Word-level extraction (e.g., extracting "摇滚" from "摇滚音乐") uses `Intl.Segmenter` (V8 built-in, zero dependencies) with ICU dictionary-based CJK word breaking.

**Strategy 2: Bracket hints for isolated strings.** Append `[short hint]` derived from the namespace. The API translates both the word and the hint; strip the hint suffix with regex. Tested 28 cases across 4 locales — **93% clean strip** (26/28). Two failures caused by long hints being truncated by the API. Mitigation: keep hints to 1–2 words.

Strip regex (handles square brackets, CJK fullwidth parens, corner brackets, guillemets):

```
/\s*[\[（(「『«„‹‚].*?[\]）)」』»"›']?\s*$/
```

**Strategy 3: Phrase-extract.** Translate `"Rock music"` instead of `"Rock"`, then extract the first word(s). Works well for zh-CN (`"摇滚音乐"` → segment → `"摇滚"`). Less useful for languages where word order differs (Arabic: `"موسيقى الروك"` = "music the-Rock" — target word is last).

#### Decision tree for Phase 5 batch translator

```
For each missing (key, locale):
  1. If namespace has ≥ 5 siblings → comma-batch all siblings
     - Split result by delimiter regex
     - Verify split count matches input count
     - If mismatch → fall back to per-key with bracket hint
  2. Else if value is ≤ 2 words → bracket-hint from namespace
     - Strip hint suffix from result
     - Verify no bracket remnants
  3. Else → translate raw (sentences carry their own context)
  4. Post-validation:
     - Placeholder preservation check ({count}, {name}, etc.)
     - Empty result check
     - Bracket remnant check
     - Flag failures for human review
```

#### Limitations

- **Back-translation Jaccard is unreliable for short strings.** "just now" → ar → back = "All you want." (Jaccard: 0.0). Legitimate translations of 1–3 word strings frequently back-translate to different words. Only apply Jaccard scoring to strings ≥ 5 words.
- **Placeholder mangling.** `{count}` was rewritten to `@count` (ar), `{{count}}` (es), or preserved (zh). Pre-extract placeholders before translation, reinsert after.
- **Manual override map needed.** Some polysemous terms (Metal, Party) resist all context strategies. A small `translation-overrides.json` keyed by `(key, locale)` allows human-curated translations to bypass the API for known problem cases.

### Quotation and Boundary Symbols

Translation output may use locale-specific quotation marks and delimiters:

| Language        | Primary quotes          | Nested quotes      | List delimiter |
| --------------- | ----------------------- | ------------------ | -------------- |
| English         | `"..."`                 | `'...'`            | `,` U+002C     |
| Spanish         | `«...»` or `"..."`      | `"..."` or `'...'` | `,` U+002C     |
| Chinese (Simp.) | `\u201C...\u201D`       | `\u2018...\u2019`  | `、` U+3001    |
| Chinese (Trad.) | `「...」`               | `『...』`          | `、` U+3001    |
| Arabic          | `«...»`                 | `"..."`            | `،` U+060C     |
| Hebrew          | `"..."`                 | `'...'`            | `,` U+002C     |
| Yiddish         | `„..."`                 | `‚...'`            | `,` U+002C     |
| German          | `„..."`                 | `‚...'`            | `,` U+002C     |
| French          | `« ... »` (with spaces) | `"..."`            | `,` U+002C     |
| Japanese        | `「...」`               | `『...』`          | `、` U+3001    |

All boundary detection uses `Intl.Segmenter` (zero-dependency V8 built-in) and regex character classes — no external NLP libraries required.
