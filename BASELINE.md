# BASELINE — classifier brain + matching layer (Phase 0)

Date: 2026-07-02 · Branch: `claude/new-session-tu0nna` · Baseline commit: (Phase 0 commit)

## 1. One-page map

### The brain (`packages/classify` — TypeScript, single source of truth)

| File | Purpose |
| --- | --- |
| `packages/classify/src/index.ts` | Status classifier (`detectStatus`/`classifyStatus`/`scoreStatus`, scored not first-match, negation-aware), relevance gate (`looksLikeJobApplication`), base company resolution (`resolveCompany`, `companyFromDomain`, `companyFromSenderName`, subject/body patterns, ATS domain list), role extraction (`extractRole`) |
| `packages/classify/src/aggregate.ts` | `resolveCompanySmart` (extra ATS-employer recovery: smart subject/body patterns + apply-URL tenant slugs), `cleanRole` (display polish), `statusForThread` (last decisive signal wins), `classifyThread` (rich result: status+confidence+reasons, company/role fields with fallback flags, enrichment), `threadToApplication` (thread → persisted record) |
| `packages/classify/src/extract.ts` | Enrichment extractors, value-or-null: `extractInterview` (date/time text + booking link), `extractCompensation`, `extractLocation`, `extractRecruiterContact` |
| `classify.js` (repo root) | **Frozen legacy CommonJS build** (desktop/local web). Same 5 primitives: `detectStatus`, `resolveCompany`, `companyFromDomain`, `companyFromSenderName`, `extractRole` |
| `packages/classify/src/parity.test.ts` | Parity gate: legacy `classify.js` must agree with the TS port on the 5 primitives over the corpus |
| `packages/classify/corpus/cases.json` | Labeled golden corpus (all English) |
| `packages/classify/scripts/eval.ts` | **NEW (Phase 0)**: per-category + per-language accuracy scoreboard, incl. matching-layer eval |

### The matching/grouping layer (critical for Known Issue A)

| Site | File | Key used | Bundling risk |
| --- | --- | --- | --- |
| Thread construction (Gmail) | `gmail.js` / `packages/providers/src/mappers.ts` / `providers.py` | Gmail native `threadId` | none |
| Thread construction (Outlook/Graph) | `msgraph.js` / `mappers.ts` / `providers.py` | Graph `conversationId` | low (server-side) |
| Thread construction (IMAP, desktop) | `imap.js` `mapParsedToThreads` (line ~58) | **`sender-domain \| normalized-subject`** | **CONFIRMED: two companies through one ATS domain with identical boilerplate subjects merge into ONE thread → one application record** |
| Record upsert (hosted) | `packages/db/src/repo.ts` `upsertApplications` | `(userId, threadId)` | none |
| Board grouping (hosted API + DB) | `packages/contracts/src/index.ts` `boardFromApplications` | **lowercased company name** | **CONFIRMED: all platform-fallback records ("Myworkday", "Linkedin", …) merge into one company group** |
| Board grouping (desktop UI) | `index.html` `groupByCompany` (line ~672) | company name | same as above |
| Board grouping (web UI) | `apps/web/src/lib/derive.ts` `companyCards` (line ~270) | lowercased company name | same as above |

Sync flow (hosted): `packages/sync/src/engine.ts` `runSync` → fetch threads → `looksLikeJobApplication` filter → `threadsToApplications` → `upsertApplications`.

### Eval harness

- `pnpm --filter @pipeline/classify eval` — accuracy table; `-- --failures` dumps each miss; `-- --json` machine-readable.
- Scoring semantics per category are identical to the vitest suites. New categories added by Phase 0 (harness work, exempt from the regression gate, existing scoring semantics untouched):
  - `companySmart` — the hosted resolver on the same company cases (additive column).
  - `matching` — threads → `threadsToApplications` → `boardFromApplications`; asserts distinct employers stay distinct groups.
  - `imapThreading` — raw mails → desktop `imap.js` `mapParsedToThreads`; asserts different companies never merge into one thread.
- Corpus cases accept an optional `lang` field (default `en`) for the per-language breakdown.

## 2. Baseline numbers (Phase 0 corpus)

`pnpm --filter @pipeline/classify eval` @ baseline:

| Category | n | pass | fail | acc |
| --- | ---: | ---: | ---: | ---: |
| status | 22 | 22 | 0 | 100.0% |
| confidence | 8 | 8 | 0 | 100.0% |
| company (base resolver) | 10 | 10 | 0 | 100.0% |
| companySmart (hosted) | 10 | 10 | 0 | 100.0% |
| companyFromDomain | 3 | 3 | 0 | 100.0% |
| companyFromSenderName_null | 3 | 3 | 0 | 100.0% |
| role | 6 | 6 | 0 | 100.0% |
| roleClean | 9 | 9 | 0 | 100.0% |
| interview | 5 | 5 | 0 | 100.0% |
| compensation | 6 | 6 | 0 | 100.0% |
| location | 6 | 6 | 0 | 100.0% |
| recruiterContact | 5 | 5 | 0 | 100.0% |
| **matching** (new) | 5 | 2 | 3 | **40.0%** |
| **imapThreading** (new) | 3 | 1 | 2 | **33.3%** |
| **overall** | **101** | **96** | **5** | **95.0%** |

By language: `en` 101 cases (100%). **Turkish/multilingual coverage: zero.**

Test suites at baseline: `pnpm --filter @pipeline/classify test` 152/152 pass; legacy `node --test test/classify.test.js test/mappers.test.js` 45/45 pass.
(Root `npm test` also sweeps workspace `.test.ts` files node can't load — pre-existing harness noise, not classifier drift.)

## 3. Known Issue A — concrete failing baseline cases

All five baseline failures ARE Known Issue A encodings (added in Phase 0 so the bug is measured, not anecdotal):

1. `matching` / workday tenant local part (`initech@myworkday.com` vs `hooli@myworkday.com`) → both resolve to platform fallback "Myworkday" → **1 group instead of 2**.
2. `matching` / linkedin "viewed by <Company>" subjects → resolver misses the pattern → both "Linkedin" → **1 group instead of 2**.
3. `matching` / two content-identical LinkedIn notifications → silently merged into one "Linkedin" group instead of staying two low-confidence records.
4. `imapThreading` / two Workday tenants, identical boilerplate subject → IMAP `domain|subject` key → **1 thread instead of 2**.
5. `imapThreading` / same no-reply sender, company only in body → **1 thread instead of 2**.

Layer verdict (to be confirmed in Phase 1 with code-path traces): **both layers are at fault** —
(a) extraction falls back to the platform name; (b) grouping keys on that shared name (and IMAP threading keys on the shared domain) with no guard.

## 4. Discrepancies vs. the mission brief (stated assumptions)

- The brief describes a "150+ multilingual corpus with an eval script". Reality: ~83 labeled corpus cases (all English; the "152" is vitest test count including non-corpus tests), no standalone eval script, no per-language breakdown, no matching-layer coverage. Phase 0 built the missing harness. **ASSUMED**: the numeric targets should be set against the corpus as it grows with real failure encodings (per README: "grow with every real-world misclassification"); existing category scores start at 100% because the corpus was seeded from passing tests, so headroom lives in cases yet to be added (Phase 1) — not in the current numbers.
- `classify.js` is "frozen", but the parity gate exists precisely so the 5 shared primitives can evolve in lock-step. **ASSUMED**: bug fixes to those primitives may land in BOTH copies simultaneously (parity gate stays green and is never bypassed). Without this, the desktop app could never receive the Known Issue A fix.
- STOP-condition check: corpus labels look internally consistent; eval runs. No stop.
