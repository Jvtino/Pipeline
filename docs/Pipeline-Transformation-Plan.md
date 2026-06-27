# Pipeline — Web + Mobile Transformation Plan

_Execution-ready plan to take Pipeline from a local-first hybrid prototype to a hosted, multi-user, open-core web + companion-mobile product. Grounded in a direct read of the jvtino/pipeline codebase (not the brief's self-description)._

> **Public edition.** Specific product prices, margins, and go-to-market/monetization detail have been removed for public publication. The open-core tier *structure* (Free / Pro / Teams capability tiers) is retained because it is an architectural input the technical plan depends on. A full edition that includes pricing and the commercial playbook is kept privately, outside this repository.

> **Ground-truth corrections baked into this plan:** the real `index.html` is **~76 KB / 1,394 lines**, not 2.6 MB (the 2.5 MB file is `business/explainer.html`, a marketing page). The total app source is **~3,600 lines**. The internal `business/OPEN-CORE-SPLIT.md`, headed *“do NOT commit to the public repo,”* **is currently committed and git-tracked** in the public MIT repo, along with ~14 MB of media — this is treated as a live incident, not a future risk.

---

## Contents

- [1. Executive Summary](#)
- [2. Current Application Assessment](#)
- [3. Product Strategy](#)
- [4. Web App Plan](#)
- [5. Mobile App Plan](#)
- [6. Architecture Recommendation](#)
- [7. Data Model Plan](#)
- [8. Backend and API Plan](#)
- [9. UX/UI Plan](#)
- [10. Security and Privacy Plan](#)
- [11. Development Roadmap](#)
- [12. Feature Prioritization](#)
- [13. Migration Strategy](#)
- [14. Testing and QA Plan](#)
- [15. DevOps and Deployment Plan](#)
- [16. Team and Role Breakdown](#)
- [17. Cost and Complexity Estimate](#)
- [18. Risk Register](#)
- [19. Final Recommended Build Path](#)

---

# 1. Executive Summary

Pipeline today is one well-factored 3,600-line codebase that does one thing honestly: it reads a job-seeker's mailbox read-only, classifies application emails with a scored keyword engine (`classify.js`), and renders a kanban board from a single unified contract. The free local build is genuinely good and is the brand's privacy proof. The commercial problem is that almost nothing about the *hosted* business exists yet, and three of the hardest pieces (incremental sync, restricted-scope verification, token-at-rest encryption) are exactly the pieces a solo founder is most tempted to defer and least able to retrofit later.

**Web vs mobile vs both — and why mobile is companion-only.** Build both, but they are not peers. The hosted **web app is the commercial surface**: first-run OAuth, billing, analytics, account deletion/export, and all heavy classification live there. **Mobile is a glance-and-act companion** (Expo/RN) that reads server-derived application records over the hosted API and never scans a mailbox on-device. This is not a scoping convenience — it is forced by the architecture. On-device scanning would re-fork the classifier per platform, multiply restricted-scope review across iOS/Android, and put OAuth tokens on the most-easily-lost devices. Companion-only keeps "one place classifies" literally true and keeps the crown-jewel mail tokens server-side under KMS.

**Migrate vs rebuild vs partial reuse.** This is a deliberate three-way split, not a wholesale rewrite. **Rebuild the hosted frontend** as React+TS+Vite — the 76 KB / 1,394-line `index.html` monolith (note: it is 76 KB, *not* the 2.5 MB file, which is `business/explainer.html`, a marketing page) is small enough that reimplementing it as components is faster than untangling vanilla DOM code and bolting on auth, billing, and routing. **Extract the classifier**: lift the status/company/role logic out of `classify.js` into a TypeScript `@pipeline/classify` package that web, mobile, and the Node API all import — collapsing the current JS-side duplication into one source of truth. **Freeze the local build**: `server.py` + `index.html` stay essentially as-is as a separate, frozen, MIT artifact. Critically, `providers.py` is a raw→unified *mapper*, not a classifier twin; its mapping logic is reimplemented as TS mappers and held to the existing `mappers.test.js` corpus.

**The hardest technical problems.** In rough order of difficulty:

| Problem | Why it is hard | Where it bites |
|---|---|---|
| Incremental sync at quota | Current sync is a **full re-read every time** (Gmail caps ~200 threads, IMAP `MAX_MESSAGES=300`, Graph up to 1000, re-searching ~1 year). Replacing it with Gmail `history`/`watch`+Pub/Sub and Graph `delta`+subscriptions means persistent cursors, subscription renewal before expiry, and a push listener. | Quota burn, scale, and CASA data-minimization review |
| Restricted-scope verification + CASA | `gmail.readonly` is a Google **restricted** scope → app verification plus likely annual **CASA Tier 2** by an approved assessor; Microsoft needs publisher verification. Today only the ≤100-user test allowlist works. | Gates any public multi-user launch |
| Token-at-rest | `.pipeline-accounts.json` is `chmod 0600` but **not encrypted**; desktop falls back to base64 (not encryption). Hosted needs envelope encryption (per-row data key, master in KMS). | Breach blast radius; verification posture |
| Classifier parity | Two source copies survive — TS `@pipeline/classify` (hosted) and the frozen Python local build — and they *will* drift. | Same email, different status across products |
| The monolith UI | `index.html` mixes state, providers, and rendering in one file with localStorage-only persistence. | Slows every hosted feature until extracted |

**The biggest product risks** are not technical. **Verification rejection** — Google declining the restricted-scope app or a failed CASA — kills the hosted launch outright; the entire compliance track (finalized `PRIVACY.md`/`TERMS.md` with a real contact, not the current drafts/placeholder) must run *ahead* of GA, not alongside it. **LLM cost outrunning revenue**: AI classification is Pro-only, server-side, and a *second pass* that only escalates low-confidence threads to a Haiku-class model — if it runs on every email it eats the Pro margin alive. **Privacy-brand breach**: the brand is "we don't keep your mail," so the hosted build must persist *derived records and the ≤600-char snippet only*, never raw bodies; and the live leak — `business/OPEN-CORE-SPLIT.md`, headed "do NOT commit," yet git-tracked and public with pricing and moat reasoning — is itself a brand/strategy breach that must be history-scrubbed before any further public work.

**Recommended build order, in one paragraph.** First, leak remediation as a release gate: purge `business/` strategy docs from git history and move the ~14 MB of marketing media out of the MIT repo. Then stand up the monorepo (pnpm+Turborepo) and extract `@pipeline/classify` + `@pipeline/contracts` with a shared golden-corpus parity gate running in both Node and Python CI. Then the hosted spine: Fastify API on Fly.io, Neon Postgres, Upstash Redis, Clerk identity decoupled from the mail grant, and **envelope-encrypted tokens from commit one**. Then incremental sync (Gmail history/watch, Graph delta) replacing the full-rescan path. Then rebuild the web board on the contract. Only then layer Pro (multi-mailbox merge already exists in desktop, reminders, analytics, export), gated server-side by subscription claim and desktop-side by Ed25519 license token. Compliance (verification, CASA, legal) runs as a parallel track that *blocks GA*, with hosted on the test-user allowlist until cleared.

**Fastest realistic path to a polished MVP:** extracted shared classifier → hosted single-mailbox Gmail connect with incremental sync and encrypted tokens → rebuilt React board reading derived records → Pro multi-mailbox merge behind the license gate, running under the ≤100-user allowlist while verification is in flight. That is a credible, demoable, privacy-honest product without waiting on CASA.

**What should NOT be built yet:** the mobile app, Teams (seats, cohort dashboards, white-label), LLM second-pass classification, interview-prep, PDF export, and any heavy DRM. None of these gate the MVP; several (LLM, cohort analytics) carry real cost or compliance surface and should wait until paying Pro users prove the funnel.

---

# 2. Current Application Assessment

Pipeline is a small, deliberately-built codebase with a genuinely good core idea and some real engineering instincts — wrapped in a few decisions that are actively dangerous the moment you go multi-user, and one mistake that is hurting you *right now* while the repo sits public. This section grades the code as it actually exists, file by file, with no charity.

First, a correction to the prompt that frames everything below:

> **The "2.6 MB index.html" claim is false.** `index.html` is **1,394 lines / ~76 KB** — it is the entire app UI in vanilla JS. The 2.5 MB HTML file is `business/explainer.html`, a marketing page, not the app. This matters: the UI monolith is *small*, which changes the migration verdict. A 2.6 MB hand-written UI would argue for a careful incremental port. A 76 KB one argues for a clean rebuild (it is faster to reimplement than to untangle — see §3). Anyone planning effort off the wrong number will mis-size the web rebuild by an order of magnitude.

## 2.1 What is genuinely reusable

This is the part worth protecting. The product's actual value is concentrated in a few hundred lines.

| Asset | File | Why it survives | Caveat |
|---|---|---|---|
| **The classifier** | `classify.js` (236 lines) | Pure, dependency-free, dual-runtime (browser globals + `module.exports`), unit-tested. `detectStatus` is *scored*, not first-match — regex families add points, highest wins, precedence offer>rejected>interview>applied. It even handles negated offers (`NEG_OFFER_RE` "unable to offer" → rejection). This is the brain. | It is JS, and the hosted plan is TS. It gets **extracted to `@pipeline/classify` (TS)**, not reused verbatim (§5). |
| **Company/role resolution** | `classify.js` (`resolveCompany`, `ATS_DOMAINS` ~40 platforms, `cleanCompanyName`, `rootName`, `extractRole`) | Genuinely non-trivial domain logic: recovers the real employer from "Acme via Greenhouse", strips legal suffixes and recruiting noise, handles multi-level TLDs (`co.uk`). You don't want to rewrite this from scratch; it encodes a lot of hard-won edge cases. | Travels with the classifier into `@pipeline/classify`. |
| **The unified contract** | everywhere — `{ threadId, domain, subject, messages:[{date, from, body}] }`, `BODY_CHARS=600` | This is the single best architectural decision in the repo. It is what lets one UI run three ways and keeps classification in one place. | Becomes `@pipeline/contracts` (zod), but the *shape* is locked and correct. Do not let it drift. |
| **The Provider abstraction** | `index.html` `LiveProvider`/`MockProvider`; `preload.js` `window.pipelineAPI` | One UI, three run modes (Electron / local web / static demo), only the data Provider swaps. `LiveProvider` prefers `window.pipelineAPI.fetchThreads` else `/api/threads`; `MockProvider` is the demo fallback. The *pattern* is exactly right and carries forward to hosted+mobile. | The *implementation* is tied to the monolith; the pattern survives, the code does not. |
| **OAuth flows as reference** | `providers.py` (343), `main.js` (203) | Working Authorization-Code-+-PKCE for both Google (web client, secret, `gmail.readonly`, `access_type=offline`+`prompt=consent`) and Microsoft (public client, PKCE, `consumers` tenant, `Mail.Read`+`offline_access`). `valid_access_token()` already does refresh with an `on_refresh` persist callback. `main.js` does loopback OAuth on a random 127.0.0.1 port. | **Reference, not reuse.** The hosted backend is Node/Fastify (§6); these are the spec you reimplement against, and they save you the discovery work. The desktop `main.js` flow stays as-is for the frozen local build. |
| **The allowlist static server instinct** | `server.py` (serves only `index.html`, `classify.js`) | Deliberately *not* a generic file server — it refuses to serve `config.json`, `.pipeline-accounts.json`, `.git`. That is a correct security instinct under pressure. | The *instinct* carries to hosted (deny-by-default). The *code* (`http.server`) does not. |
| **Test corpora** | `test/classify.test.js` (131), `test/mappers.test.js` (163), `test/providers_test.py` (130) | These are assets, not just tests. The classifier fixtures become the **shared golden corpus** that runs in both CI lanes to prevent JS↔Python drift (§5). | Must be promoted from "unit tests" to "parity gate." |

## 2.2 What is trash for hosting and must be rewritten

None of this is "bad for what it is" — `server.py` is a competent *local-single-user* server. It is simply structurally incapable of being the hosted product, and patching it would be slower and riskier than replacing it.

| Component | File | Why it cannot be hosted | Replacement |
|---|---|---|---|
| **Single-user, single-process server** | `server.py` (566) | Python stdlib `ThreadingHTTPServer`, binds `127.0.0.1` only, one user, one process. There is no concept of accounts, tenancy, or concurrency safety. | Node/TS Fastify API (§6), multi-tenant, behind managed auth. |
| **In-memory OAuth state** | `server.py` `_pending = {}` | OAuth `state` lives in a process-local dict. It does not survive a restart, and it is *wrong* the instant you run more than one worker or any hosted/load-balanced topology. CSRF-relevant state must be shared. | `state` in Postgres/Redis with TTL. |
| **Plaintext token file** | `server.py` → `.pipeline-accounts.json`, chmod `0600`, git-ignored | **Not encrypted at rest.** This is correct and acceptable for local-single-user (the file never leaves the laptop). It is categorically unacceptable hosted: one disk/backup/snapshot leak hands an attacker live `gmail.readonly` refresh tokens for every user. | Envelope encryption — per-row data key (`crypto_secretbox`) wrapping the tokens, master key in managed KMS (§9). |
| **`localStorage` as system of record** | `index.html` (`pipeline.manualPositions`, `pipeline.timeframe`, `pipeline.sort`, `pipeline.cardOrder`, pin/ignore sets, manual status-override maps) | The user's *intent data* — manual overrides, board layout, pins, ignores — lives only in the browser. No backend persistence. Clear your cache and your curation is gone; switch devices and it does not follow you. For a free local toy this is fine. For a paid hosted product it is data loss. | Persist to Postgres per-user; `localStorage` becomes a cache/offline hint only. |
| **The UI monolith** | `index.html` (1,394) | One file, vanilla JS, dark theme, no framework/bundler/TS. At 76 KB it is small enough that a React+TS+Vite rebuild is *faster* than untangling state, rendering, and provider-wiring that are all interleaved in one document. There is no component boundary to lift. | Rebuild as `apps/web` (React+TS+Vite, §3). |
| **base64 token "fallback"** | desktop (`main.js` token store) | When OS keychain (`safeStorage`) is unavailable, tokens are stored base64-encoded. base64 **is not encryption** — it is `atob()` away from plaintext. The code at least `console.warn`s so docs can't silently lie, which is honest, but it is still a plaintext store wearing a disguise. | Out of scope for hosted (envelope encryption replaces it). For the frozen desktop build, it stays *local-only* and documented; do not let this pattern leak into hosted thinking. |
| **Full-rescan sync** | `providers._fetch_gmail` (caps ~800 ids, 200 threads, `format=metadata`), `_fetch_graph` (up to 1000 via `$search`+junk), `server.py` IMAP (~12 SEARCH terms ANDed with `SINCE`, `MAX_MESSAGES=300`) | Every sync re-reads up to a year of mail. No History API, no `delta`, no cursor. It is O(mailbox) per sync forever. It does not scale, it burns API quota linearly with users, and **it will fail CASA/Google's data-minimization review** — re-scanning the whole inbox on a schedule is the opposite of minimal access. | Incremental, push-driven sync: Gmail `users.history`+`watch`→Pub/Sub, Graph `delta`+change-notifications, per-account cursor in Postgres, full backfill only on first connect (§10). |

## 2.3 What to modularize (the seam that makes everything else possible)

The single highest-leverage refactor is extracting the brain out of the UI file and killing the runtime duplication:

- **`classify.js` → `@pipeline/classify` (TS).** This is the only place classification, company resolution, and role extraction may live on the hosted side. Web, mobile, and the Node API/workers all import it. One source of truth, one set of regexes, one precedence table.
- **`providers.py` mappers → TS mappers under `@pipeline/contracts`.** Be precise about what `providers.py` *is*: it is a **raw→unified mapper**, not a classifier twin. Today there are two parallel implementations of "turn provider JSON into the unified shape" — Python (`providers.py`, for Gmail/Graph) and the JS side. The Python mapping logic gets reimplemented in TS and validated against the existing `mappers.test.js` corpus.
- **The contract → `@pipeline/contracts` (zod).** The `{ threadId, domain, subject, messages[] }` shape plus API DTOs become runtime-validated schemas, so a provider change that breaks the shape fails loudly at the boundary instead of silently corrupting the board.
- **The Provider pattern stays a pattern.** `LiveProvider`/`MockProvider`/`window.pipelineAPI` is the right shape; it gets reimplemented per surface (hosted-API provider for web, hosted-API provider for mobile, mock for demo) over the same contract.

The free **local Python build keeps its own frozen copy** of `classify.js` and `providers.py`. That is acceptable *because* it is a separate, deliberately-frozen artifact — but a **shared golden corpus** (fixtures + expected `{status, company, role}`) runs in **both** the Node and Python CI lanes to catch drift between the frozen local copy and the live TS package.

## 2.4 Where today's code lands tomorrow

| Today | Becomes a **backend service** | Becomes a **frontend component** | Becomes a **mobile flow** |
|---|---|---|---|
| `server.py` endpoints (`/api/threads`, `/api/accounts`, `/api/disconnect`, `/auth/*`) | Fastify routes (multi-tenant, authed) | — | Read-only API consumer |
| `providers.py` fetch+map, `gmail.js`/`msgraph.js`/`imap.js` | Sync workers (incremental, push-driven) + TS mappers | — | — (mobile never scans) |
| `classify.js` | Imported by API + sync workers (server-side) | Imported by web (client-side hints) | Imported (rendering derived records) |
| `index.html` board/cards/search/timeframe/sort | — | React components in `apps/web` | Glance-and-act screens in `apps/mobile` (Expo) |
| `LiveProvider`/`MockProvider` | — | Hosted-API provider + mock | Hosted-API provider |
| `localStorage` overrides/layout | Postgres-backed per-user state | Synced from server, cached locally | Read-mostly; deep edits punted to web |
| `main.js` loopback OAuth | (reference) hosted incremental-consent OAuth | First-run connect screen (web) | OAuth deep-links to **web**, never on-device |

Note the asymmetry the mobile column makes explicit: **mobile never scans a mailbox, never holds a mail token, never runs a sync.** It reads server-derived application records. First-run OAuth, billing, analytics, and account deletion/export live on web. That is what keeps "one place classifies" and "one place holds the crown-jewel tokens" true.

## 2.5 Assumptions to validate before migration

These are cheap to check and expensive to get wrong:

1. **Classifier parity across runtimes.** Confirm `@pipeline/classify` (TS) produces *byte-identical* `{status, company, role}` to `classify.js` on the full corpus before retiring the JS original. The regex semantics (Unicode, case, `\b` behavior) must match across JS/TS engines.
2. **`providers.py`'s mapping is the complete spec.** Validate that `mappers.test.js` + `providers_test.py` actually cover the Graph/Gmail shapes you'll reimplement — including the junk-folder path and `format=metadata` field availability. Gaps here become silent data loss in the TS mappers.
3. **Incremental-sync feasibility per provider.** Verify Gmail `watch`→Pub/Sub and Graph change-notification subscriptions behave as assumed (expiry windows, renewal cadence, backfill semantics) *before* committing the worker design in §10. The current full-rescan code gives you zero operational experience with delta semantics.
4. **`BODY_CHARS=600` is enough for the LLM second pass.** The Pro LLM escalation (§14) operates on the same 600-char snippet. Confirm that truncation doesn't decapitate the signal the LLM needs; if it does, the "store derived, not raw" rule (§11) and the snippet cap interact and must be reconciled.
5. **Restricted-scope status is the real gate.** Confirm the hosted app is currently only viable under Google's test-user allowlist (≤100, unverified) — i.e. **you cannot soft-launch to the public today** regardless of code readiness (§16).

## 2.6 Hidden technical debt

Ordered roughly by how much it will hurt:

| Debt | Where | Bite |
|---|---|---|
| **The committed strategy leak** | `business/OPEN-CORE-SPLIT.md`, literally headed *"Internal planning doc. Local only — do NOT commit to the public repo,"* is git-tracked and public | Your **monetization strategy, pricing, tier split, and go-to-market reasoning are public right now.** Anyone can read your playbook and your free-vs-paid line before you ship. This is a live leak, not a future risk. Purge `business/` from history (git scrub), because deleting the file does not remove it from the public git history. |
| **14 MB of media in an MIT app repo** | `business/` — `pipeline-demo.mp4` (8 MB), `explainer.html` (2.5 MB), `pipeline-demo.gif` (1.4 MB), screenshots (1.1 MB), `vo.mp3` | Every `git clone` of your *code* drags 14 MB of marketing. It bloats the repo, slows CI, and mixes marketing artifacts into the funnel repo. Move to a separate asset/marketing repo or CDN; the public repo ships **code + license + draft legal only**. |
| **No database** | entire app | State lives in a `0600` JSON file and `localStorage`. There is no system of record, no migrations, no per-user isolation. Everything hosted is greenfield persistence. |
| **No incremental sync** | `providers.py`, `server.py` IMAP | Full rescan every time (§2.2). Operationally unproven on delta APIs; quota-linear with users; CASA-hostile. |
| **Dual classifier/mapper runtimes** | `classify.js` (JS) vs `providers.py` (Python) | Two languages implementing adjacent logic. Today it's "JS classifies, Python maps" — not a perfect twin — but the duplication is real and will **drift** the moment someone fixes a regex in one and not the other. Collapse to TS + golden-corpus parity gate. |
| **Unsigned / unnotarized installers** | `electron-builder` (dmg/nsis) | Users hit Gatekeeper/SmartScreen "unknown developer" walls on first run. For a privacy-brand product asking for inbox access, scaring users at install is a conversion killer and a trust own-goal. |
| **Draft legal docs with placeholder contact** | `PRIVACY.md`/`TERMS.md` (marked *"review with legal counsel before publishing"*), placeholder contact info; `GOOGLE-VERIFICATION.md`/`PRODUCTION.md`/`WEB-OAUTH.md` are guides | You cannot pass Google verification or launch multi-user with draft policies and no real contact. This is a hard prerequisite, not a polish item (§16). |
| **OAuth state non-durability** | `server.py` `_pending = {}` | Already covered, but it's also *debt*: it silently breaks the moment hosting introduces a second worker, with a confusing "invalid state" failure mode. |

## 2.7 Risks that could kill the project if ignored

1. **The strategy leak compounds daily.** Every day `OPEN-CORE-SPLIT.md` stays public, more of your competitive plan is cached, forked, and indexed. This is the one item that is actively losing value *now*. Treat history scrub + media removal as a **release gate** before any further public work (§15).
2. **Restricted-scope / CASA wall.** `gmail.readonly` is a Google **restricted** scope. Public multi-user launch requires OAuth app verification and a likely **annual CASA Tier 2** assessment by a Google-approved third party. The current full-rescan design is the *wrong* posture to walk into that review with — fix sync (§10) and "store derived, not raw" (§11) *before* you apply, or you'll fail on data-minimization and pay for a re-assessment. Microsoft separately needs publisher verification. **No code-readiness substitutes for this; it gates GA.**
3. **Crown-jewel tokens unencrypted if you "just host server.py."** The single most tempting shortcut — wrap the existing Python server and ship — directly exposes plaintext refresh tokens for every user's inbox. One snapshot leak is an extinction-level incident for a privacy brand. Envelope encryption is non-negotiable before any multi-user data touches a disk (§9).
4. **Quota exhaustion under load.** Full-rescan sync is fine for one local user and catastrophic at scale: it multiplies API calls by users × inbox-size × sync-frequency. You can get rate-limited or scope-suspended into an outage. Incremental sync is a scaling *requirement*, not an optimization.
5. **Privacy-brand contradiction.** The brand is privacy, but the current realities (plaintext hosted tokens, full inbox rescans, persisting more than derived records if done naively, public strategy docs) all contradict it. A single credible "this privacy app isn't private" story does disproportionate damage to a product whose entire moat is trust. The architecture in the canonical brief exists specifically to make the brand *true*; shipping ahead of it makes the brand a liability.

The uncomfortable summary: the **product** (the classifier + contract + provider pattern, ~600 lines that matter) is real and worth building on. The **plumbing** (server, persistence, sync, token storage, UI host) is all local-single-user scaffolding that must be replaced, not extended. And the **repo hygiene** (committed strategy leak, 14 MB media, draft legal) is a live, public liability that should be fixed this week, independent of any roadmap.

---

# 3. Product Strategy

## The core user problem

A job seeker who is actively searching applies to 30–150 roles over a few months. The signal — "where do I actually stand with each company?" — is buried inside a noisy inbox: confirmation auto-replies, ATS no-reply addresses (`no-reply@greenhouse.io`, `talent@us.greenhouse-mail.io`), recruiter threads, rejection form letters, and interview-scheduling links, all interleaved with everything else in their life. The inbox is organized by *time*, not by *application state*. There is no pipeline view. The user's real job — "who do I need to follow up with, who ghosted me, what's still live, what's my actual response rate" — requires manual mental bookkeeping that nobody sustains past week two.

Pipeline's job is to invert the inbox: turn an undifferentiated mail stream into a stateful board of applications, each with a resolved **company**, **role**, and **status** (`applied → interview → offer/rejected`), derived read-only and privately. That inversion is the product. Everything else — analytics, reminders, exports, AI — is leverage on top of it. If the core inversion is wrong (mislabels a rejection as applied, fails to recover the employer behind an ATS sender), no feature above it matters.

The honest constraint: the classifier in `classify.js` is keyword/regex only. It's a *good* version of that (scored not first-match, negation-aware via `NEG_OFFER_RE`, ATS-employer recovery via `resolveCompany`), but it is brittle on multilingual, mixed-signal, and unusual phrasing, and the intended LLM second pass is not built. So the core problem is solved *adequately* for English-language, conventionally-phrased mail and *not at all* for the long tail — which is exactly why AI classification is the headline Pro feature and not a free one.

## Highest-value workflows

Ranked by how directly they serve the core problem and how much a user would miss them:

| # | Workflow | Why it matters | Tier |
|---|---|---|---|
| 1 | **Connect mailbox → see a populated board with no manual entry** | This is the entire "wow." If the first sync produces an accurate board, the product sells itself. | Free |
| 2 | **Trust the status/company resolution** | The board is worthless if half the cards are mislabeled. Accuracy is the product, not a feature. | Free (keyword) / Pro (LLM) |
| 3 | **Follow-up reminders** ("you haven't heard from Acme in 10 days") | Converts a passive board into an action engine. This is the single feature most likely to create a daily-return habit. | Pro |
| 4 | **Multi-mailbox merge** | Real job seekers use a personal + a dedicated job-search address. Already built in the desktop `main.js`; cheap to gate. | Pro |
| 5 | **Pipeline analytics** (funnel %, time-in-stage, response rate, weekly digest) | The "am I doing this right?" answer no spreadsheet gives them. High build cost, high differentiation. | Pro |
| 6 | **Manual override / add off-email position** | Trust valve: when the classifier is wrong, or the application happened on a portal with no email, the user fixes it in one tap. Essential for credibility. | Free |
| 7 | **Export (CSV/PDF)** | Low effort, high "I own my data" signal; also the artifact a career-services advisor asks for. | Pro (cheap gate) |
| 8 | **Interview-prep generator** | Nice, LLM-backed, but downstream of having an interview at all. | Pro |

## Prioritize first / delay / remove

**Build first (in order):**
1. **Accurate first-sync board on hosted web** — the populated board with no manual entry, backed by the extracted `@pipeline/classify` package. Nothing ships before this is good.
2. **Manual override + add-off-email** — ship *with* the board, not after. The board cannot be trusted without an escape hatch, and its presence is what lets you ship an imperfect classifier honestly.
3. **Follow-up reminders** — first feature that earns a recurring visit and the first defensible Pro line.
4. **Incremental sync** (Gmail `history` / Graph `delta`, per Canonical Decision #10). Not a user-facing "feature," but a prerequisite: the current full-rescan-every-time model (caps of 200/300/1000, ~1 year re-search) burns quota and *will fail CASA's data-minimization review*. It must land before any scale.

**Delay:**
- **Analytics dashboards** — expensive to build, and they're meaningless on a sparse pipeline. They land after enough users have enough history to make a funnel chart non-embarrassing. Ship the *weekly digest email* (cheap, derived, habit-forming) before the in-app analytics surface.
- **Interview-prep generator** — gated behind "user actually got an interview," which is a minority of threads. LLM cost, narrow trigger; not a launch feature.
- **Teams tier in its entirety** — seat admin, cohort dashboards, white-label. B2B is the eventual moat (compliance + convenience), but it requires a working, verified, multi-user Pro product first. Building Teams primitives before Pro is proven is premature.
- **Mobile app** — companion-only by Canonical Decision #2, and a companion to *nothing* until hosted web works. Build it after web Pro is real.

**Remove / simplify:**
- **The base64 token "fallback"** is local-desktop-only and explicitly out of scope for hosted (Decision #9). Do not let it leak into hosted-side thinking; hosted is envelope-encrypted or it doesn't ship.
- **The dual JS/Python classification surface** collapses to one TS package on the hosted side (Decision #5). The Python `providers.py` mapper logic is reimplemented as TS mappers under `@pipeline/contracts`; the only Python that survives is the *frozen local build's* copy, kept honest by a shared golden-corpus run in both CI lanes.
- **`SHOW_LOGOS` via `google.com/s2/favicons`** — keep it off by default (it already is, for privacy) but reconsider whether a third-party favicon fetch belongs in a privacy-branded product at all, even opt-in. It quietly contradicts the brand. Lean toward removing it or self-hosting a domain-icon set.

## What WEB should be best at

Web is the **system of record and the cockpit**. Anything heavy, infrequent, legally significant, or requiring focus lives here.

| Capability | Why web owns it |
|---|---|
| **First-run OAuth & mailbox connect** | Incremental consent for the restricted `gmail.readonly` / `Mail.Read` scope (Decision #8) is a careful, trust-critical flow with a real consent screen. It belongs on the largest surface with the most explanatory room — never a cramped mobile sheet. |
| **Deep triage** | Bulk re-labeling, correcting a run of mis-classified ATS senders, merging duplicate companies — keyboard-and-mouse work. |
| **Analytics** | Funnel %, time-in-stage, response-rate, the weekly digest's full view. Charts need screen real estate. |
| **Settings** | Sync cadence, notification rules, multi-mailbox management, classifier preferences. |
| **Billing** | Merchant-of-Record checkout (Lemon Squeezy / Paddle), plan changes, invoices. PCI/tax surface stays on web. |
| **Account & data management** | Export (GDPR/CCPA), disconnect mailbox, **delete account / delete all data**. Destructive and legally-loaded actions get the confirmation room of a full screen. |

## What MOBILE should be best at

Mobile is **glance-and-act**, per Decision #2. It reads server-derived application records over the hosted API and **never scans a mailbox on-device** — that would re-fork the classifier and duplicate restricted-scope risk per platform.

| Capability | Shape |
|---|---|
| **Glance** | "3 live, 1 needs follow-up, 1 new rejection" — the board at a thumb's distance. |
| **Push notifications** | "Acme moved to Interview," "10 days silent on Beta Corp — nudge?" This is mobile's reason to exist; it's where reminders *land*. |
| **Quick status override** | One tap to fix a mislabel from the notification or the card. The trust valve, pocket-sized. |
| **Add off-email position** | Applied on a portal with no email? Add the card in three taps while it's fresh in mind. |

## Hard boundaries: what users must NEVER be forced to do where

**Never forced on mobile:**
- **A full inbox scan / on-device mail processing.** Architecturally prohibited (Decision #2). Mobile consumes derived records; it does not classify.
- **Billing as a *requirement*.** Surface upgrade prompts, but checkout completes on web. (Apple/Google IAP economics and MoR tax handling both argue against forcing in-app purchase here.)
- **Account deletion or bulk settings.** Destructive, legally-loaded, and detail-heavy actions belong on web. A user must never be able to nuke their account from a fat-fingered mobile sheet, and must never be *required* to use mobile to do something they can't.
- **First-run OAuth as the only path.** Connecting a mailbox can be *initiated* anywhere, but the restricted-scope consent flow is designed for web.

**Never forced on web/desktop:**
- **An account / cloud login to use the free local product.** The free local build (Decision #1) is the privacy proof and the funnel. It must run 100% locally, single-user, no backend, no sign-up — exactly as `server.py` does today (binds `127.0.0.1`, allowlisted static serving, no telemetry). Forcing a hosted account to open the local app would destroy the brand.
- **Giving up the keyword classifier to get a board.** AI is the Pro upsell; the free keyword classifier (`@pipeline/classify`) must produce a usable board on its own. Don't paywall the core inversion.
- **Persisting raw email to get features.** Per Decision #11, derived records + the ≤600-char snippet only. No feature may require storing raw bodies.

## What the finished product should FEEL like

It should feel like **a calm, trustworthy instrument** — closer to a well-made native finance app than to a SaaS dashboard. Specifically:

- **Quiet confidence about privacy.** The user should *feel* that nothing is being hoarded: "we read your mail read-only, we keep a company/role/status and a 600-character snippet, never the raw email, and you can delete all of it in one click." The brand is privacy; the UI must constantly, wordlessly reinforce it.
- **The board does the work.** Open it and the answer is *already there* — populated, correctly labeled, sorted by what needs attention. The user reacts, they don't enter data.
- **Honest about uncertainty.** When the classifier is unsure, the card *says so* (a subtle "unconfirmed status" affordance) and the one-tap fix is right there. A product that's transparent about a wrong guess feels more trustworthy than one that hides it.
- **Fast and local-feeling.** Local desktop is instant. Hosted feels instant via incremental sync + cached derived records, not a spinner re-reading a year of mail.
- **One product across three runtimes.** The single unified contract (`{ threadId, domain, subject, messages[] }`) and single classifier mean web, desktop, and mobile show the *same* board with the *same* labels. No "it says something different on my phone."

---

## What would make this feel AMATEUR (current-state risks)

- **Lettered avatar squares** (the current "A" / "G" colored-initial placeholders) standing in for company identity on every card. It reads like a prototype. Real logos (privacy-safely sourced or self-hosted) or a designed monogram system is table stakes.
- **Draft legal documents shipped live.** `PRIVACY.md` / `TERMS.md` carry "review with legal counsel before publishing" and **placeholder contact info**. For a product whose entire brand is privacy, draft policies with a fake contact email are disqualifying.
- **The committed leak.** `business/OPEN-CORE-SPLIT.md` is literally headed "do NOT commit to the public repo" and *is git-tracked and public* — pricing, moat, and monetization strategy all readable by anyone. This is the single most amateur artifact in the repo and a release gate (Decision #15).
- **14 MB of marketing media in the MIT app repo** (`pipeline-demo.mp4` 8 MB, `explainer.html` 2.5 MB, GIF, screenshots, `vo.mp3`). Cloning the *app* drags down 14 MB of video. It signals nobody thought about repo hygiene.
- **No empty / loading / error-state discipline.** A blank board on first sync with no "connecting…" / "no applications yet" / "sync failed, retry" states reads as broken, not new.
- **Demo data bleeding into a real account.** The `MockProvider` fallback is correct as a static-demo mode, but if a real connected user ever sees fabricated "Acme" cards, trust is gone instantly.
- **A spinner that re-reads a year of mail on every refresh.** Full-rescan sync isn't just a scaling problem; it *feels* slow and amateurish every single time.
- **Inconsistent labels across surfaces** if the classifier ever forks — the exact failure the single `@pipeline/classify` package exists to prevent.

## What would make this feel PROFESSIONAL

- **A clean, designed company-identity system** — self-hosted domain icons or a consistent monogram, never a raw initial-in-a-box.
- **Finalized, counsel-reviewed legal docs** with a real, monitored contact address, and a verified Google OAuth consent screen (restricted-scope verification + CASA Tier 2 done, Decision #16) — so the consent screen says "Pipeline" with a real publisher, not "unverified app."
- **A scrubbed public repo**: code + MIT license + finalized legal docs only; strategy docs purged from history; marketing media moved to a separate asset repo / CDN.
- **Disciplined states everywhere** — every screen has a deliberate empty, loading, partial-sync, error, and offline state. The product never shows a blank rectangle.
- **Transparent classification confidence** — visible "unconfirmed" affordance + frictionless one-tap correction, so the product is *honest* rather than falsely certain.
- **Instant-feeling sync** — incremental, push-driven (Gmail `history` + `watch` → Pub/Sub, Graph `delta` + subscriptions, Decision #10), with cached derived records. Refresh is sub-second, not a re-scan.
- **Visible, one-click data control** — export, disconnect, delete-all, with honest copy about exactly what is stored (derived records + 600-char snippet, never raw mail). The privacy brand made tangible.
- **One coherent product across web / desktop / mobile** — same board, same labels, same contract, with mobile clearly scoped as a companion rather than a half-broken port.

---

# 4. Web App Plan

The hosted web app is the commercial center of gravity. Per the Canonical Decisions Brief (#1, #3), it is a **ground-up rebuild**, not a migration of the existing 1,394-line `index.html`. That monolith is small enough to reimplement faster than to untangle, and it carries assumptions — `localStorage`-only state, a single-user `127.0.0.1` backend, in-memory OAuth state, full-rescan sync — that are actively wrong for a multi-user hosted product. The local/desktop build keeps `index.html` + `server.py` frozen as the MIT funnel artifact (#3). Everything below describes the *new* hosted surface only.

One correction up front, because it propagates into asset-loading and bundle-budget decisions: the brief's "2.6 MB HTML" claim is wrong. `index.html` is ~76 KB (1,394 lines). The 2.5 MB file is `business/explainer.html`, a marketing page, and it — along with ~14 MB of demo media — must leave the app repo per #15 before any hosted work is treated as "shippable."

---

## 4.1 Stack and platform decisions

These restate the brief at implementation altitude. They are not re-litigated here; later subsections build on them.

| Layer | Choice | Source | Why (1 line) |
|---|---|---|---|
| Frontend | React + TypeScript + Vite | #3, #4 | Component app; one TS toolchain shares `@pipeline/classify` + `@pipeline/contracts` |
| Backend | Node/TS on Fastify | #6 | Lighter than Nest; imports the same classifier/contracts as the client |
| DB | Neon Postgres | #7 | Serverless-priced system of record; near-zero idle cost |
| Cache/queue | Upstash Redis | #7 | Sync job queue + rate-limit buckets |
| Auth/identity | Clerk | #8 | Offloads MFA/recovery/org-seat primitives; decoupled from mail scope |
| Hosting (API+workers) | Fly.io containers | #12 | Always-on listeners + long backfills don't fit pure serverless |
| Hosting (frontend) | Vercel | #12 | Static SPA + edge CDN |
| Token KMS | Cloud KMS (envelope) | #9 | Master key wraps per-row data keys |
| Billing | Lemon Squeezy / Paddle (MoR) | #13 | Global tax/VAT handled for a solo founder |
| LLM | Claude Haiku-class, server-side, Pro-only | #14 | Marginal-cost second pass only on low-confidence threads |

### Monorepo placement

The web app is `apps/web` in the pnpm + Turborepo monorepo (#4). It imports:

- `@pipeline/contracts` — zod schemas for `{ threadId, domain, subject, messages:[{date, from, body}] }` (`BODY_CHARS=600`) plus the API DTOs (account, application-record, sync-status, billing-claim).
- `@pipeline/classify` — the extracted TS classifier. **Critically, the web client imports the same classifier the API imports.** This lets the UI re-derive or preview a status client-side without a round-trip when a user manually edits something, while the server remains authoritative. There is exactly one classifier on the hosted side (#5).
- `packages/ui-web` — shared design-token-driven React primitives (web only; native does not share rendering, only tokens — #4).

`apps/web` does **not** import `providers.py` or any Python. The raw→unified mapping that `providers.py` does on the local build is reimplemented as TS mappers under `@pipeline/contracts`, validated by the ported `mappers.test.js` corpus (#5). Python survives only inside the frozen local build and as the second lane of the golden-corpus parity gate.

---

## 4.2 Frontend architecture

### Rendering model: SPA, not SSR

This is a logged-in, data-dense, behind-auth application — a board, not a content site. There is no SEO surface inside the app (the marketing site is separate, post-#15). So: **client-rendered SPA on Vite**, served as static assets from Vercel's CDN, talking to the Fastify API over HTTPS. We reject Next.js SSR/RSC here: it adds a server runtime, a second rendering model, and Vercel-function cost for zero benefit on an authed dashboard, and it complicates importing `@pipeline/classify` cleanly into a pure client bundle. The public landing/login page is the one exception (4.10.1) and can be a tiny statically-pre-rendered route.

### Bundle budget

The old UI was one 76 KB HTML file with no framework. The rebuild adds React, a router, a data-fetching layer, and a chart library. That is a real regression in raw bytes, and it must be controlled deliberately:

- Route-level code splitting. The analytics screen (charts) and the LLM/interview-prep Pro surfaces load as lazy chunks — a free user never downloads the charting library.
- Charts: a small library (e.g. a Recharts-class or lighter visx-style dependency) loaded only on `/analytics`.
- Target initial JS for the dashboard route: **< 200 KB gzipped**. The old monolith proves the *product* doesn't need much; the framework tax is the only addition, and it stays lazy-loaded past the board.

### State management

Two distinct kinds of state, deliberately separated:

| Kind | Tool | What lives here |
|---|---|---|
| Server state | TanStack Query | Application records, accounts, sync status, billing claim, analytics. Cache + background refetch + optimistic updates. |
| UI/local state | Zustand (small) + URL | Board sort/timeframe/filter, selected card, modal open-state, manual drag positions in-flight |

This replaces the old `localStorage`-only model. The critical change: **state that was browser-local on the single-user build becomes server-persisted on the hosted build.** The old keys — `pipeline.manualPositions`, `pipeline.timeframe`, `pipeline.sort`, `pipeline.cardOrder`, pin/ignore sets, manual status-override maps — map to:

- **Server-persisted (Postgres):** manual status overrides, pin/ignore, manual board positions, notes. These are user data and must survive device changes and power a multi-device + mobile-companion experience (#2). A pin set in mobile must show on web.
- **URL-encoded:** timeframe, sort, active filter — so a view is shareable/bookmarkable and survives reload without a write.
- **Truly ephemeral (Zustand):** drag-in-progress, transient modal state.

View-preference keys (timeframe/sort) may *also* be mirrored to a lightweight server `preferences` row so a returning user lands on their last view, but the URL remains the source of truth within a session.

### UI architecture and component layers

```
apps/web/src/
  app/            # router, providers (Query, Clerk, theme), error boundary root
  routes/         # one folder per screen (4.10), lazy-loaded
  features/
    board/        # company board: columns, cards, drag, status pills
    triage/       # thread/triage workflow
    analytics/    # charts (lazy)
    accounts/     # mailbox connect/disconnect + sync status
    billing/      # subscription state, upgrade
  data/           # TanStack Query hooks, API client (typed via @pipeline/contracts DTOs)
  lib/            # client-side @pipeline/classify usage, formatting, guards
  components/     # from packages/ui-web (tokens, primitives)
```

The four statuses from `classify.js` — applied (gray) / interview (yellow) / offer (green) / rejected (red) — become a single `StatusPill` primitive and the column model of the board. The color semantics are locked design tokens shared with native (#4), so a status looks identical across surfaces.

### Routing structure

Client-side router (React Router or TanStack Router). Auth-gated layout wraps everything except the public landing/login and legal pages.

| Path | Screen | Gate |
|---|---|---|
| `/` | Landing / login | public |
| `/onboarding` | First-run + incremental mail-scope consent | auth |
| `/board` | Main dashboard (company board) | auth |
| `/triage` | Thread / triage workflow | auth |
| `/app/:id` | Application detail | auth |
| `/analytics` | Analytics (lazy) | auth + Pro |
| `/settings/accounts` | Connected mailboxes | auth |
| `/settings/privacy` | Privacy + data controls | auth |
| `/settings/data` | Export / delete | auth |
| `/billing` | Subscription | auth |
| `/admin` | Internal ops tools | auth + role=admin |
| `/help` | Help / support | public-ish (auth-aware) |
| `/legal/privacy`, `/legal/terms` | Legal | public |

`/analytics` is Pro-gated at the **router level (UX) and again server-side (enforcement)** — the router gate is a convenience, never a security boundary (4.8).

---

## 4.3 Backend architecture and API design

### Shape

Fastify (Node/TS) on Fly.io, split conceptually into:

1. **API process** — request/response for the web + mobile clients. Stateless-ish (sessions live in Clerk + cookies), horizontally scalable.
2. **Sync/worker process** — always-on. Holds Gmail `watch`→Pub/Sub push listeners and Graph change-notification subscriptions, renews subscriptions before expiry, and drains the Upstash sync queue (backfills + delta runs). This is *why* Fly.io and not Lambda (#12): subscription renewal and long first-connect backfills fight the serverless execution model.

Both processes import `@pipeline/classify` and `@pipeline/contracts`. The classifier runs **server-side** during sync (4.4), which is the single source of truth for stored status.

### API design principles

- **DTOs are zod schemas from `@pipeline/contracts`.** Every request body and response is parsed/validated against the shared schema. The unified contract `{ threadId, domain, subject, messages[] }` is enforced by type, not convention, and the same types compile into the web client — so a contract change is a compile error in three places at once (#4, #5).
- **REST-ish + a thin RPC feel.** No GraphQL — unjustified weight for a solo founder; TanStack Query + typed REST covers it.
- **Cursor pagination** on list endpoints. The board can hold hundreds of applications; never return unbounded arrays.
- **Idempotency keys** on mutating endpoints that can be retried (manual add, status override) so an optimistic-update retry can't double-write.

### Endpoint map (hosted — supersedes `server.py`'s 6 local endpoints)

| Method + path | Purpose | Notes vs. old `server.py` |
|---|---|---|
| `GET /api/applications` | Derived application records (the board) | Replaces `GET /api/threads`; returns **derived records**, not live-scanned threads (#11) |
| `GET /api/applications/:id` | One application + status history + snippet | New; powers detail page |
| `PATCH /api/applications/:id` | Manual status override / pin / ignore / notes | Server-persisted (was `localStorage`) |
| `POST /api/applications` | Manual add | New persisted entity |
| `GET /api/accounts` | Connected mailboxes + per-account sync state | Was `GET /api/accounts`; now multi-user, multi-account |
| `POST /api/accounts/connect/:provider` | Start incremental mail-scope OAuth | Was `/auth/<provider>/start`; **state in Redis/Postgres, not in-memory `_pending`** |
| `GET /api/oauth/:provider/callback` | OAuth callback → store envelope-encrypted token, kick first backfill | Was `/auth/<provider>/callback` |
| `POST /api/accounts/:id/disconnect` | Disconnect + delete tokens + stop subscription | Was `POST /api/disconnect`; now also tears down `watch`/delta sub |
| `POST /api/webhooks/gmail` | Pub/Sub push → enqueue history sync | New (#10) |
| `POST /api/webhooks/graph` | Graph change notification → enqueue delta sync | New (#10) |
| `POST /api/webhooks/billing` | MoR webhook → set subscription claim | New (#13) |
| `GET /api/analytics` | Funnel %, time-in-stage, response rate | New, **Pro-gated server-side** |
| `POST /api/export` | CSV/PDF export job | New, Pro |
| `POST /api/account/delete` | GDPR/CCPA full delete | New, hard requirement |
| `GET /api/me` | Session user + tier claim + flags | New |

The single most important architectural change in this table: `GET /api/applications` returns **stored derived records**, not a live mailbox scan. The old `/api/threads` triggered a full re-read on every call. Here, scanning is decoupled from reading (4.4).

### State that must move off in-memory

The old OAuth `_pending = {}` dict is in-process and dies on restart or any second worker (the brief flags this). Hosted, OAuth `state`/PKCE-verifier lives in **Redis with a short TTL** keyed by a CSRF-safe nonce, so any API replica can complete a callback. Same for rate-limit buckets.

---

## 4.4 Sync, classification, and the data model

This is the heart of the rebuild and the thing the old design gets most wrong.

### Old behavior (to be killed)

`server.py` / `providers.py` re-read mail **on every sync**: Gmail pages ~800 thread ids and fetches the first 200 threads (`format=metadata`); Graph pulls up to 1000 via `$search` + junk; the IMAP path runs ~12 `SEARCH` terms ANDed with `SINCE`, capped at `MAX_MESSAGES=300`, re-searching up to a year of mail every time. No History API, no delta, no cursor. It burns quota, doesn't scale, and — important for launch — **fails CASA's data-minimization review** because it repeatedly reads far more than it needs.

### New behavior (#10, #11)

```
first connect ──► bounded backfill ──► classify ──► persist DERIVED record ──► store cursor
                                                          │
push notification ─► enqueue ─► history/delta from cursor ─► classify changed only ─► upsert
```

- **Gmail:** `users.watch` → Pub/Sub push → `users.history.list` from the stored per-account `historyId`. Only changed messages are fetched and classified.
- **Microsoft Graph:** `delta` query with stored deltaLink + change-notification subscription, renewed before expiry by the worker.
- **Cursor + subscription expiry** stored per account in Postgres.
- **Full backfill only on first connect**, and bounded — not "re-scan a year forever."

### Classification path

1. Sync fetches raw text for changed messages **in-flight only**.
2. `@pipeline/classify` runs the keyword/regex pass server-side: `detectStatus` (scored, precedence offer > rejected > interview > applied, negated-offer handling), `resolveCompany` (ATS_DOMAINS recovery from display-name/subject/body, `cleanCompanyName`, `rootName` multi-TLD), `extractRole`.
3. For **Pro users only**, low-confidence/ambiguous threads escalate to the Claude Haiku-class second pass (#14), server-side. The keyword classifier returning `null` or a thin score margin is exactly the escalation signal — the brief notes the LLM pass "is NOT built," so this is net-new and Pro-gated to cover marginal cost.
4. The result is reduced to a **derived application record** and the raw text is discarded. Raw email bodies are **never** written to durable storage (#11).

### What persists

| Stored (Postgres) | Never stored |
|---|---|
| company, role, status | raw email bodies |
| status history (date per transition) | full thread content |
| `<= 600`-char snippet (`BODY_CHARS`) | attachments |
| `threadId`, `domain`, account ref | message-by-message archive |
| manual overrides / pin / ignore / notes | |
| sync cursor, subscription expiry | |
| envelope-encrypted OAuth tokens | plaintext/base64 tokens |

This is the literal expression of the privacy brand and the strongest CASA/GDPR posture (#11). It is also why "store derived records, not raw mail" is a schema-level constraint, not a policy promise: there is no column for a raw body.

---

## 4.5 Database design (Neon Postgres)

Core tables (abbreviated):

- `users` — mirrors Clerk user id; tier/subscription claim cached for fast gating; created/deleted timestamps.
- `accounts` — one row per connected mailbox: provider, external account id, `historyId`/`deltaLink` cursor, subscription id + expiry, status. **`token_ciphertext`, `token_data_key_wrapped`, `key_id`** (envelope encryption — 4.6). No plaintext token column exists.
- `applications` — derived record: user, account, `thread_id`, `domain`, company, role, current status, snippet (`<=600`), pinned, ignored, manual_override flag. Unique on `(user, thread_id)`.
- `status_events` — append-only status-history (application id, status, occurred_at, source = keyword|llm|manual).
- `notes` — Pro; attached to application.
- `preferences` — last view (timeframe/sort) per user.
- `sync_jobs` / queue metadata lives in Upstash, not Postgres.

Indexes: `applications (user_id, status)`, `applications (user_id, updated_at)` for the board and timeframe filters; `status_events (application_id, occurred_at)` for time-in-stage analytics.

---

## 4.6 Security requirements

The privacy brand is the product (#hard-constraints), so security is feature work, not hygiene.

| Requirement | Implementation |
|---|---|
| **Token-at-rest encryption** | Envelope encryption (#9): per-row data key via libsodium `crypto_secretbox` wrapping the OAuth token; master key in cloud KMS. **Never** the desktop base64 fallback — that is local-only and out of scope. Enables key rotation without re-reading every row. |
| **Identity ≠ mail scope** | Clerk session (httpOnly, Secure, SameSite cookies). The `gmail.readonly` / `Mail.Read` grant is separate incremental consent at connect time (#8), so sign-in is never blocked by Google CASA/verification status. |
| **No raw mail at rest** | Schema-enforced (4.4). Reduces breach blast radius and is the core CASA/GDPR argument. |
| **OAuth state integrity** | Redis-stored `state` + PKCE verifier with TTL; CSRF-safe nonce; not in-memory (fixes `_pending`). |
| **CSRF / cookies** | httpOnly Secure cookies + CSRF token on state-changing requests; CORS locked to the app origin. |
| **Authorization** | Every endpoint checks the authenticated user owns the resource; Pro/Teams features checked against the server-side subscription claim, never a client flag (4.8). |
| **Secret hygiene** | Google client **secret** (Web-application client) and Microsoft config in KMS/secrets manager, never in the repo. |
| **Webhook auth** | Pub/Sub + Graph + billing webhooks verify signatures/tokens before enqueueing. |
| **Leak remediation (gate)** | Per #15, history-scrub `business/OPEN-CORE-SPLIT.md` and the strategy docs from the public repo, move ~14 MB of media out. This is a **release gate** — a live monetization/pricing/moat leak sitting in a public MIT repo with a header that literally says "do NOT commit." |
| **Static-file allowlist** | The old `server.py` allowlist instinct (serving only `index.html`/`classify.js`, never `config.json`/`.pipeline-accounts.json`/`.git`) carries forward: the hosted frontend ships only built assets; no app config is reachable over HTTP. |

---

## 4.7 Performance, error handling, observability

### Performance

| Concern | Target / approach |
|---|---|
| Board load | Served from derived records, not live scan; cursor-paginated; initial board < 200 KB JS, data in one query |
| Sync cost | Delta/history only; **no full re-read** — directly fixes the quota burn |
| LLM cost | Escalate only low-confidence threads; Haiku-class model; Pro-only (#14) |
| Backfill | Bounded on first connect; runs in worker, streamed progress to UI |
| DB | Indexed for board/timeframe/analytics; Neon serverless autoscale |

### Error handling

- **Typed errors end-to-end:** API returns structured error DTOs (code, message, retryable); the client maps codes to specific failure states (4.10), never a raw 500.
- **Sync failures are per-account and non-fatal:** one mailbox's expired token or revoked grant degrades that account to a "reconnect needed" state without breaking the board. The old single-process design had no such isolation.
- **Token refresh:** the refresh + on-persist-rotated-token logic from `valid_access_token()` is reimplemented server-side; a failed refresh flips the account to `needs_reauth` and surfaces a reconnect CTA (4.10.7).
- **Optimistic updates roll back** on mutation failure (TanStack Query) with a toast.

### Logging / monitoring

- **Structured JSON logs** (Fastify + pino) with request id; **never log raw email content, tokens, or snippets** — log derived metadata only.
- **Error tracking:** Sentry (web + API) with PII scrubbing configured to drop email bodies/addresses.
- **Sync health:** per-account last-sync time, cursor age, subscription-expiry countdown — surfaced internally (4.10.8) and to the user as a sync-status badge.
- **Uptime + queue depth** alerts on the worker (subscription renewal must not silently lapse, or pushes stop and the board goes stale).

---

## 4.8 Open-core gating in the web app

Hosted Pro/Teams features gate **server-side by subscription claim** (#13). The web router's Pro checks (e.g. on `/analytics`) are UX only — they hide the screen and show an upgrade CTA, but the `GET /api/analytics`, `POST /api/export`, and LLM-classification endpoints independently verify the claim and 403 otherwise. There is no client-trusted entitlement. The billing webhook (4.10.7) is the sole writer of the subscription claim, set from the Merchant-of-Record (Lemon Squeezy / Paddle), which also handles global tax/VAT. The Ed25519 offline license token (#13) is the **desktop** gate; the hosted build does not use it — it has a live server and uses the claim directly.

---

# Key Screens

For each: Purpose / Main components / Required data / User actions / Edge cases / Failure states.

## 4.10.1 Landing / Login

**Purpose.** Convert and authenticate. The only public, pre-auth surface inside the app shell. Privacy is the pitch: read-only mail, derived records not raw email, local option exists.

**Main components.** Hero with the one-line value prop; "privacy-first" proof points (read-only, no raw email stored, open-source local build); Clerk sign-in/sign-up widget (Google/Microsoft/email); link to the MIT local build and the live demo; footer with legal links.

**Required data.** None authenticated. Clerk publishable key; feature flags for which sign-in methods are live.

**User actions.** Sign up / sign in; "try the demo" (MockProvider static build — the funnel-preserving local option, #1); download local build; read privacy/terms.

**Edge cases.** Already-authenticated visitor → redirect to `/board`. Returning user mid-onboarding (no mailbox connected) → route to `/onboarding`. Deep link to a gated route while logged out → preserve `returnTo` through login.

**Failure states.** Clerk widget fails to load → fallback "sign in" link to hosted Clerk page. Auth provider outage → inline message, retry; never a blank page.

**Note.** Sign-in here requests **identity only** — no mail scope. Mail consent is deliberately deferred to onboarding (#8). This is what keeps sign-in working even while the Google app is still in CASA/verification limbo.

## 4.10.2 Onboarding (incl. incremental mail-scope consent)

**Purpose.** Take a freshly-authenticated user to a populated board, and obtain the **separate, incremental** mail-scope grant at the moment it's justified — not at sign-in.

**Main components.** Short stepper: (1) welcome + privacy restatement ("we request read-only access; we store derived application records, not your email"); (2) **connect a mailbox** — Google / Microsoft buttons that launch the incremental `gmail.readonly` / `Mail.Read` consent; (3) first-sync progress (backfill running in the worker, streamed); (4) "here's your board."

**Required data.** `GET /api/me` (tier, whether any account connected); provider availability flags; during step 3, live sync-progress (job status from the worker).

**User actions.** Choose provider → OAuth incremental-consent flow (`POST /api/accounts/connect/:provider` → provider consent → `GET /api/oauth/:provider/callback`); skip and explore demo data first; finish → `/board`.

**Edge cases.**
- **Google test-user allowlist (pre-GA):** until verification + CASA pass, only allowlisted accounts (≤100) can grant; a non-allowlisted user hits Google's "unverified app" wall. Onboarding must detect this and show an honest "private beta — request access" path, not a broken loop (#16).
- **Microsoft personal accounts:** basic-auth/app-password IMAP was killed in 2024, so OAuth is the only path for Outlook.com — there is no fallback to offer.
- User grants identity but declines mail scope → land on an empty board with a persistent "connect a mailbox" CTA, demo data available.
- User closes the popup mid-consent → return to step 2, no partial account row.

**Failure states.** OAuth denied/cancelled → step 2 with a clear reason. Callback state expired (Redis TTL) → restart connect. Refresh-token not issued (Google needs `access_type=offline` + `prompt=consent`) → detect missing refresh token and force re-consent rather than silently storing an unrefreshable account. Backfill errors → account shows "sync issue, retrying," board still loads with whatever was classified.

## 4.10.3 Main dashboard — the company board

**Purpose.** The product. One board across all connected mailboxes (multi-mailbox merge is Pro — #tier-map), showing every application as a card in a status column.

**Main components.** Four status columns — **applied (gray) / interview (yellow) / offer (green) / rejected (red)** from `classify.js`; application cards (company, role, last-update, account badge, pin indicator); top bar with search, timeframe filter, sort, and a global sync-status badge; drag-to-reposition; pin/ignore affordances; per-card status-override menu; "add manually" button.

**Required data.** `GET /api/applications` (cursor-paginated derived records), `GET /api/accounts` (for account badges + sync state), `GET /api/me` (tier — single vs multi-mailbox). Manual positions, pins, ignores, overrides come **from the server** now, not `localStorage`.

**User actions.** Search / filter by timeframe / sort (URL-encoded); drag a card; pin/ignore (`PATCH`); manually override status (`PATCH`, marks `source=manual`, locks against re-classification — mirrors the old "caller keeps prior status when `detectStatus` returns null" intent); open a card → detail; add manual application.

**Edge cases.** Hundreds of cards → virtualized columns + pagination. Same employer via multiple ATS platforms (Greenhouse + Lever) → `resolveCompany` should already collapse to the real employer; board groups by resolved company. Manual override must win over later automated sync. Multi-mailbox dedupe when the same role hits two inboxes.

**Failure states.** Empty (no account) → onboarding CTA + demo toggle. Empty (account but nothing classified yet) → "syncing…" skeleton. Stale board (subscription lapsed, pushes stopped) → sync badge warns "last synced X ago," manual "sync now" available. Partial-account failure → board renders; the failed account's badge shows "reconnect."

## 4.10.4 Thread / triage workflow

**Purpose.** Resolve the classifier's ambiguous calls fast — the human-in-the-loop for a keyword/regex engine that is, per the brief, "brittle on unusual/multilingual/mixed-signal phrasing."

**Main components.** A queue of low-confidence / null-status / conflicting-signal items (e.g. an email matching both reject and interview regexes); for each: the `<=600`-char snippet, the classifier's guess + score, the four-status quick-action buttons, and (Pro) a "what the LLM thinks" suggestion from the second pass.

**Required data.** `GET /api/applications?filter=low_confidence` (records flagged at classify time via thin score margin or `null`); tier (LLM suggestion is Pro).

**User actions.** Confirm or correct status (one click → `PATCH`, `source=manual`); skip; bulk-confirm a batch; for Pro, accept the LLM suggestion.

**Edge cases.** Negated offers ("unable to offer you" → rejection via `NEG_OFFER_RE`) should already be handled — triage is for what the regex genuinely can't call. Multilingual/mixed signal is the expected long tail. An item resolved here must not re-surface on the next sync unless content materially changes.

**Failure states.** LLM pass unavailable (rate limit / outage) → fall back to keyword guess + manual buttons; never block triage on the LLM. Empty queue → "nothing to triage" (the good state).

## 4.10.5 Analytics (Pro)

**Purpose.** The clearest paid value: funnel %, time-in-stage, response rate, weekly digest. Built from `status_events`, never from raw mail.

**Main components.** Funnel chart (applied→interview→offer); time-in-stage; response-rate; trend over the selected timeframe; weekly-digest preview/opt-in. Lazy-loaded chunk (charts library not in the base bundle).

**Required data.** `GET /api/analytics` (server-computed from `status_events`); **Pro-gated server-side** — free users get a blurred preview + upgrade CTA, and the endpoint 403s regardless of the client.

**User actions.** Change timeframe; toggle weekly digest; drill into a stage → filtered board; export (Pro, CSV/PDF).

**Edge cases.** Sparse data (few applications) → show "needs more data" rather than misleading 0%/100%. Manual overrides count in the funnel. Timezone correctness for time-in-stage.

**Failure states.** Free user hitting the route → upgrade screen, not an error. Computation error → "couldn't load analytics, retry," board unaffected.

## 4.10.6 Application detail

**Purpose.** Everything known about one application, from the **derived record** — no raw email re-fetch.

**Main components.** Header (resolved company, role, current status pill, source account); status-history timeline from `status_events`; the `<=600`-char snippet; notes (Pro); manual controls (override status, pin, ignore); contact (Pro).

**Required data.** `GET /api/applications/:id` (record + status history + snippet).

**User actions.** Override status; add/edit notes (Pro); pin/ignore; delete this application; "open in mailbox" deep link (provider webmail — we don't host the raw thread).

**Edge cases.** Snippet truncated at 600 chars by design — UI must signal it's a snippet, not the full email. Company mis-resolved from an ATS sender → allow manual company correction, persisted as an override. Status history with a manual entry interleaved among automated ones (show `source`).

**Failure states.** Record deleted/not owned → 404 screen. "Open in mailbox" when the account was disconnected → explain the link is unavailable.

## 4.10.7 Settings, Billing, and data controls

These share a settings shell; grouped for brevity but each is its own route.

### Settings — Accounts (`/settings/accounts`)

**Purpose.** Manage connected mailboxes and see real sync health.
**Components.** Per-account row: provider, address, last-sync time, cursor/subscription health, "reconnect" / "disconnect."
**Data.** `GET /api/accounts`.
**Actions.** Connect another mailbox (multi-mailbox merge = Pro); disconnect (`POST /api/accounts/:id/disconnect` → deletes envelope-encrypted tokens **and** tears down the `watch`/delta subscription); reconnect on `needs_reauth`.
**Edge cases.** Free tier capped at one mailbox — second connect prompts upgrade. Subscription about to expire → proactive "reconnect" before sync silently stops.
**Failure states.** Disconnect partially fails (token deleted, subscription teardown errored) → mark account `disconnecting`, retry teardown in worker; never leave a live subscription pushing to a deleted account.

### Settings — Privacy (`/settings/privacy`)

**Purpose.** Make the privacy brand legible and controllable.
**Components.** Plain-language statement (read-only, derived records only, encrypted tokens); logo-display toggle (`SHOW_LOGOS` off by default; favicons via `google.com/s2/favicons` with `referrerpolicy=no-referrer` when on); LLM-processing consent toggle (Pro — controls whether ambiguous threads are sent to the model, #14).
**Data.** Current preferences.
**Edge cases.** LLM toggle off → triage falls back to keyword-only for that user even on Pro.

### Settings — Data export / delete (`/settings/data`)

**Purpose.** GDPR/CCPA user control — a hard constraint, not a nicety.
**Components.** Export (CSV/PDF of derived records — Pro for PDF/CSV beyond a basic JSON); **delete account** (full erase: applications, status events, notes, tokens, Clerk identity).
**Actions.** Request export (`POST /api/export`, async job); delete (`POST /api/account/delete`, hard confirm, irreversible).
**Edge cases.** Delete must also revoke provider grants and stop subscriptions, not just drop DB rows. Export of a large board → async + download link.
**Failure states.** Partial delete → the operation is a saga; until every step (DB, tokens, subscriptions, identity) confirms, the account is `pending_deletion` and retried. We do not report "deleted" until it is.

### Billing / subscription (`/billing`)

**Purpose.** Upgrade/downgrade; show current tier.
**Components.** Current plan + claim; upgrade to Pro/Teams; manage via Merchant-of-Record portal.
**Data.** `GET /api/me` (subscription claim); MoR portal link.
**Actions.** Upgrade → MoR checkout (Lemon Squeezy / Paddle, handles VAT/tax); manage/cancel via MoR portal.
**Edge cases.** Webhook lag — checkout completes but the claim isn't set yet → show "activating," poll, reconcile when `POST /api/webhooks/billing` lands. The webhook is the **only** writer of the claim. Downgrade Pro→Free with multiple mailboxes connected → keep data, disable multi-mailbox merge gracefully (don't delete the user's second account).
**Failure states.** Webhook never arrives → reconciliation job queries MoR; support can re-trigger. Never grant Pro client-side as a workaround.

## 4.10.8 Admin tools (`/admin`, role=admin)

**Purpose.** Operate the system as a solo founder — without ever reading user mail.
**Components.** Sync health (per-account cursor age, subscription-expiry countdown, queue depth); webhook delivery log; user/tier lookup (no inbox content); feature-flag toggles; CASA/verification status tracker (which provider apps are verified vs. test-user-allowlist).
**Data.** Internal metrics, queue state, billing-reconciliation status.
**Actions.** Re-trigger a stuck sync; replay a failed billing webhook; flip a feature flag; force subscription-renewal.
**Edge cases.** Admin must be **structurally unable** to view snippets or raw mail — there is no such endpoint, and there is no raw mail to view (#11). This is both a privacy guarantee and a CASA argument.
**Failure states.** Metrics source down → admin degrades to read-only; operational actions queue.

## 4.10.9 Help / support (`/help`)

**Purpose.** Self-serve answers + a real contact — required because `PRIVACY.md`/`TERMS.md` currently ship with **placeholder contact info** (#16), which cannot stand at public launch.
**Components.** FAQ (privacy model, "why read-only," reconnect steps, Google "unverified app" explanation during beta); links to finalized legal docs; contact/support channel; status indicator.
**Data.** Static content + auth-aware context (tier, connected accounts) to tailor answers.
**Actions.** Search help; contact support; link out to legal.
**Edge cases.** During the Google test-user phase, the "why can't I connect?" article must explain the allowlist honestly. Legal links must point to **finalized** docs with a **real** contact before GA — this is a launch gate, not copy polish.
**Failure states.** Contact channel down → fallback email shown; never a dead "contact us" button.

---

**Cross-cutting closing constraint (restating the locked invariants, not other sections):** every screen above reads and writes through `@pipeline/contracts` DTOs and renders status via the one shared classifier's four-status model; nothing here re-implements classification or company/role resolution — that lives only in `@pipeline/classify` (#5). No screen trusts a client-side entitlement; Pro/Teams gating is always the server-side subscription claim (#8, #13). And no screen, anywhere, exposes raw email — there is none at rest to expose (#11).

---

# 5. Mobile App Plan

## 5.1 Approach: Expo / React Native, companion-only

The mobile app is a **glance-and-act companion to the hosted web app**, not a second product. It renders server-derived application records over the hosted Fastify API, lets the user triage on the go (confirm a status change, snooze a reminder, pin/ignore, add a manual position), and pushes back to web for anything heavy. It **never scans a mailbox on-device**. There is no Gmail/Graph client, no IMAP, no `imapflow`, no `mailparser`, no classifier-on-phone. The phone holds a Clerk session and talks to `apps/api`; that is the entire data plane.

Stack, per the Canonical Decisions Brief (#2, #4):

| Layer | Choice | Why |
|---|---|---|
| Framework | Expo (managed) + React Native | One TS toolchain shared with web/API; OTA updates for a solo founder; native deps stay shallow because we scan nothing |
| Language | TypeScript | Lets the app import `@pipeline/contracts` and (theoretically) `@pipeline/classify` — same source of truth as web |
| Navigation | Expo Router (file-based) | Deep-link routing for free (push notification → application detail) without hand-rolling a linking config |
| Data layer | TanStack Query over `@pipeline/contracts` zod-validated DTOs | Same fetching/cache/retry semantics as web; DTOs validated at the boundary so the phone fails loud on contract drift |
| UI | `packages/ui-native` + shared design tokens | Per brief #4: native does NOT share rendering primitives with web — only logic + tokens. RN primitives, web primitives, one palette |
| Auth | Clerk Expo SDK (session) + system-browser OAuth for mail grant | #8: identity is separate from the restricted mail scope |
| Push | Expo Notifications + APNs/FCM via the API's existing event pipeline | Status changes and reminders are the only legitimate push triggers |

### Why not native (Swift/Kotlin), and why not full parity

Both rejected, and the reasons are the same reason: a mobile app that reads a whole mailbox is the single worst architectural path available.

1. **It re-forks the classifier.** The brief's non-negotiable is *one place classifies* (`@pipeline/classify`, #5). The moment the phone scans an inbox, it needs the classifier, the company/role resolver in `classify.js` (the `ATS_DOMAINS` set, `resolveCompany`, `cleanCompanyName`, `extractRole`), and the raw→unified mappers from `providers.py`. Native Swift/Kotlin can't import the TS package, so you reimplement detection in two more languages and add two more lanes to the parity gate. Even RN-but-on-device duplicates the *sync* logic (Gmail `history`, Graph `delta`, cursor management from #10) that we deliberately centralized on the server. You'd be rebuilding `server.py`'s worst property — full client-side fetch — on a battery-constrained device.

2. **It multiplies the OAuth-verification and data-liability surface per platform.** `gmail.readonly` is a Google *restricted* scope; public use needs app verification and likely a CASA Tier 2 assessment (Compliance section). A native iOS/Android app that touches that scope is **its own OAuth client, its own verification, its own CASA-relevant data flow**, and — fatally for CASA's data-minimization review — it means raw mail bodies land on thousands of end-user devices we don't control. That is the opposite of brief #11 ("persist derived records, not raw mail") and the privacy brand (#16). Keeping mail access server-only means there is exactly one verified Google client and one Microsoft publisher-verified app to defend, and raw text never leaves the in-flight sync→classify pass on our infrastructure.

3. **It doubles the maintenance for a solo founder.** Native = two more codebases (Swift + Kotlin) with zero logic reuse against the TS monorepo. Full-parity RN (on-device scan + analytics + billing + LLM) bloats the bundle, drags in `imapflow`-equivalents and OAuth-broker complexity, and forces App Store review to confront a mail-reading app — a slow, scrutiny-heavy lane. Companion-only keeps the binary thin, the review story boring ("it's a dashboard client for a web service"), and the native dependency tree shallow enough that Expo managed workflow + OTA covers ~95% of releases.

The cost of companion-only is honest: **the phone cannot onboard a brand-new user end-to-end** (mail OAuth + restricted-scope consent is a worse experience in a mobile system-browser handoff than on desktop web). We accept that. First-run lives on web; mobile is for the returning user who already connected a mailbox.

## 5.2 Shared logic, and where the line is

| Shared artifact | Mobile uses it? | Notes |
|---|---|---|
| `@pipeline/contracts` (zod DTOs for `{ threadId, domain, subject, messages[] }` + API responses) | **Yes, fully** | Validates every API payload at the boundary. The 600-char snippet cap is part of the contract the phone trusts |
| `@pipeline/classify` | **Imported but effectively dormant** | The phone *can* import it (it's pure TS), but it has nothing to classify because it never sees raw mail. It may use exported helpers like `cleanCompanyName`/`rootName` for display normalization of a manually-added position, nothing more. Classification authority stays server-side |
| Data layer (TanStack Query hooks) | **Shared patterns, separate instances** | Same query keys / invalidation strategy as web, but a thin mobile-specific client (auth header injection, retry/backoff tuned for flaky mobile networks) |
| `packages/ui-web` | **No** | Web-only rendering primitives |
| Design tokens | **Yes** | Color/spacing/typography tokens shared; components reimplemented in RN |

The critical line: **mobile shares the *data shape* and the *display helpers*, not the *ingestion pipeline*.** Anything that touches a mailbox — OAuth token custody, envelope encryption (#9), Gmail `watch`/Graph subscriptions (#10), the sync→classify reduction (#11), the Pro LLM second pass (#14) — is server-only and the phone is a pure consumer of its output.

## 5.3 Feature placement

| Capability | On mobile? | Read/Write | Push | Offline | Lives where |
|---|---|---|---|---|---|
| View board (applied/interview/offer/rejected columns) | Yes | Read | — | Cached read | Mobile-first-class |
| Application detail (status history, snippet, role, company) | Yes | Read | — | Cached read | Mobile-first-class |
| Confirm/approve a status change suggested by sync | **Yes — mobile-first** | Write | **Yes** | Queued write | Mobile is the *better* surface for this |
| Manual status override | Yes | Write | — | Queued write | Both |
| Pin / ignore | Yes | Write | — | Queued write | Both |
| Add a manual position | Yes | Write | — | Queued write | Both |
| Notes / contacts (Pro) | Yes (view + quick add) | Write | — | Queued write | Both; heavy editing is web |
| Follow-up reminders (Pro) | **Yes — mobile-first** | Read + act (snooze/done) | **Yes** | Read cached | Phone is where reminders *fire*; creation/config on web |
| Search / timeframe / sort | Yes (basic) | Read | — | Cached | Both; advanced filtering is web |
| **First-run mailbox OAuth + restricted-scope consent** | **No** | — | — | — | **Web only** |
| **Billing / upgrade / manage subscription** | **No (view status only)** | — | — | — | **Web only** (also dodges App Store IAP cut for an external SaaS) |
| **Analytics deep-dives** (funnel %, time-in-stage, response rate, weekly digest, Pro) | **No** | — | — | — | **Web only**; phone may show a single glance stat, not the dashboard |
| **CSV / PDF export** (Pro) | No (trigger link → email/web) | — | — | — | Web only |
| **AI/LLM classification** (Pro, #14) | No — it's server-side regardless | — | — | — | Server only; phone only *sees the result* |
| **Interview-prep generator** (Pro, LLM) | No (read generated output if web-created) | Read | — | — | Web only to generate |
| **Account deletion / data export (GDPR/CCPA)** | **No** (link out to web) | — | — | — | **Web only** — destructive + legal flows demand the full-context surface |
| Teams seat/license admin | No | — | — | — | Web only |

**Mobile-first features** (the phone is genuinely the *best* place for these, not a degraded copy):
- **Status-change approvals.** Sync runs server-side; when it detects a likely transition (e.g. `applied → interview`) the natural moment to confirm is a push notification you tap and approve in two seconds. This is the app's reason to exist.
- **Follow-up reminders.** A reminder that fires as a phone notification with snooze/done is strictly better than an email or a web badge.

**Read-only on mobile:** the board, application detail, snippet/history, analytics glance stats, generated LLM output, billing status.

**Push-driven:** status-change suggestions and follow-up reminders — and *nothing else*. No marketing pushes, no "you haven't opened the app" nags. The brand is privacy and restraint; notification spam contradicts it.

**Offline:** **read is cached** (TanStack Query persisted cache → last-synced board is viewable on a plane). **Writes are queued** with optimistic UI and a clearly-shown pending state, flushed on reconnect with conflict reconciliation against the server (server is authority; #1 contract). We do **not** attempt offline *creation of new derived data that requires server knowledge* — e.g. you can queue "mark this offer," but you cannot run a sync.

## 5.4 Auth

Two distinct grants, never conflated (#8):

1. **Identity / session — Clerk Expo SDK.** Sign-in (email + OAuth social providers Clerk manages) yields a session. The mobile app stores the Clerk session token in **`expo-secure-store` (Keychain / Keystore)**, never `AsyncStorage`. All API calls carry the session as a bearer/`httpOnly`-equivalent token. Because identity is decoupled from the mail scope, **sign-in is never blocked by Google restricted-scope/CASA status** — a user can log in and view their board even while the Google app is mid-verification.

2. **Mail grant — system browser, PKCE, no embedded webview.** If a user has *no connected mailbox*, mobile does **not** run the mail OAuth flow itself — it deep-links to the web onboarding (`https://app.pipeline.../connect`) opened via `expo-web-browser` (`ASWebAuthenticationSession` / Chrome Custom Tab). Rationale: Google **forbids OAuth in embedded webviews** (`disallowed_useragent`), restricted-scope consent UX is better on full web, and we keep exactly one mail-OAuth client lane to verify. If we *ever* permit in-app mailbox connect later, it MUST be the system-browser Authorization-Code-+-PKCE flow with a redirect back to the app's deep-link scheme — **never** a `WebView`. The token from that flow goes straight to the server and is envelope-encrypted at rest (#9); the phone never holds a mail OAuth token.

**Session handoff web↔mobile:** Clerk supports this natively — a user authenticated on web can be handed to the app via Clerk's deep-link/ticket flow, so the "I set this up on my laptop, now open the app" path doesn't force a re-login.

```
Phone: Clerk session (secure-store)  ──►  apps/api (Fastify)  ──►  derived records (Neon)
Mail OAuth: system browser ─► web ─► server ─► envelope-encrypted token (KMS). Phone NEVER sees it.
```

## 5.5 Navigation

Expo Router, file-based, three concerns:

- **Auth stack** (unauthenticated): Login → optional "connect a mailbox on web" interstitial.
- **Tab navigator** (authenticated, the spine): **Home (board)**, **Notifications/Reminders**, **Profile/Settings**. Three tabs — resist adding more; a fourth tab is the first symptom of bloat.
- **Modal/stack routes** off the tabs: Application Detail (push from Home or from a notification deep-link), Add Position (modal), Review/Approval (modal, also reachable from a push), Support/Help (pushed from Settings).

Deep links are load-bearing: a status-change push opens **directly** to the Review/Approval modal for that `threadId`; a reminder push opens the relevant Application Detail. Expo Router's file-based linking makes this declarative rather than a hand-maintained switch.

## 5.6 Data sync

The phone has **no sync engine**. It does not page message IDs, does not hold a `historyId`, does not run SEARCH terms. Server-side incremental sync (#10) produces derived records; the phone:

- **Reads** the board via `GET /api/applications` (the canonical derived-records read, same unified contract), validated through `@pipeline/contracts` zod schemas on arrival. A failed validation is a hard, logged error — the contract is the law.
- **Receives** a push when the server's sync detects a change, then refetches the affected record (push carries the `threadId`, not the payload — keeps notification content minimal and privacy-safe; the body never rides in a push).
- **Writes** user actions (override/pin/ignore/add/snooze) as small idempotent mutations; TanStack Query optimistic update + server reconciliation.

No on-device scan means: no battery drain from background fetch, no per-device OAuth token, no raw mail on the phone, and a trivially small native footprint.

## 5.7 Error handling (cross-cutting)

| Condition | Behavior |
|---|---|
| Network offline | Serve persisted cache, banner "Offline — showing last sync," queue writes |
| Contract/zod validation failure | Fail loud, log to error pipeline, show "Couldn't load — the app may need an update"; do NOT render partial garbage |
| Session expired (Clerk) | Silent refresh; if refresh fails, route to Login preserving deep-link intent |
| Mail grant revoked / sync error server-side | Surface a server-provided "Reconnect mailbox" state → deep-link to web; the phone cannot fix this itself |
| Write conflict (server moved the record) | Server wins; show "This changed since you last synced," re-present current state |
| Push token registration fails | Degrade gracefully — app still works pull-only; retry registration on next launch |
| Pro feature tapped on Free | Show upgrade interstitial → deep-link to web billing (no in-app purchase) |

---

## 5.8 Screens

### Login

| | |
|---|---|
| **Purpose** | Establish a Clerk identity session. Nothing more — no mail access here |
| **Main components** | Clerk `<SignIn>` (email + managed social providers), app logo, "New here? Set up on the web" link |
| **User actions** | Sign in; trigger Clerk-managed password reset / MFA; open web onboarding |
| **Data needed** | None pre-auth; Clerk session post-auth |
| **Edge cases** | Already-authenticated session handoff from web (skip screen); MFA challenge; user with account but no connected mailbox (→ post-login interstitial, not an error) |
| **Failure states** | Auth provider unreachable → "Can't sign in right now, retry"; rate-limited → Clerk message; preserve any deep-link target through the login detour |

### Onboarding

| | |
|---|---|
| **Purpose** | Bridge a logged-in user to a usable board. Honest framing: **mobile does not connect mailboxes** |
| **Main components** | 2-3 lightweight slides (what the app does, privacy promise: read-only, derived-records-only), a single primary CTA |
| **User actions** | If no mailbox connected → "Connect a mailbox on the web" (`expo-web-browser` → web `/connect`); if already connected → "Go to board"; "Try demo data" (MockProvider parity) |
| **Data needed** | Account state: does this user have ≥1 connected mailbox? (one cheap API call) |
| **Edge cases** | User connects on web mid-session → on return, poll/refresh shows the board; Free-tier single-mailbox limit messaging |
| **Failure states** | Web handoff fails to return → "Finish setup on the web, then pull to refresh"; never dead-ends the user on the phone |

### Home (Board)

| | |
|---|---|
| **Purpose** | The default returning-user view: their pipeline at a glance |
| **Main components** | Status columns/sections (applied gray / interview yellow / offer green / rejected red — same four statuses, same colors as the web/classifier), cards (company, role, last-update), timeframe chip, search, sort, pull-to-refresh, "+" to add position. `SHOW_LOGOS=false` default honored (favicons off unless user opts in) |
| **User actions** | Tap card → detail; pull-to-refresh; basic search/timeframe/sort; pin/ignore via swipe; add position |
| **Data needed** | Derived records list (unified contract), user's pin/ignore/manual-override sets, timeframe/sort prefs (server-persisted for hosted users; mirrors web localStorage keys like `pipeline.timeframe`, `pipeline.sort`) |
| **Edge cases** | Empty state (no applications yet → "Connect a mailbox on web" or "Add manually"); large board virtualized list; offline → cached board + banner |
| **Failure states** | Load fails → cached data + retry banner; contract mismatch → "Update the app" |

### Core workflow — Application Detail / Status Override / Add Position

| | |
|---|---|
| **Purpose** | Inspect one application; correct its status; create a manual one |
| **Main components** | **Detail:** company/role header, status badge, status-history timeline (date per transition), the ≤600-char snippet (read-only, never the full body — there is no full body to show), pin/ignore, notes (Pro view/quick-add). **Override:** four-status picker. **Add Position:** company + role + status form (may use `cleanCompanyName`/`rootName` from `@pipeline/classify` for display normalization only) |
| **User actions** | Override status; pin/ignore; quick-add note (Pro); add manual position; deep-link out to web for heavy notes/contacts editing |
| **Data needed** | Single record + history; manual-override map; (Pro) notes/contacts |
| **Edge cases** | Manually-added record has no email thread (snippet section hidden); offline override → queued optimistic; classifier returned `null` server-side so status is whatever the user/prior state set |
| **Failure states** | Save fails → optimistic rollback + "Couldn't save, retry"; concurrent server change → "This changed, here's the current state" |

### Notifications / Reminders

| | |
|---|---|
| **Purpose** | The phone's reason to exist: surface fired reminders and pending approvals |
| **Main components** | List of pending status-change approvals + active follow-up reminders; each row deep-links to its action; quiet-hours / mute control |
| **User actions** | Tap → Review/Approval or Detail; snooze/done a reminder; mute categories |
| **Data needed** | Pending-approvals list, active reminders (Pro), notification preferences |
| **Edge cases** | Reminders are Pro — Free users see an upgrade-framed empty state, not a broken tab; push permission denied at OS level → in-app list still works, explain how to enable |
| **Failure states** | Push delivery failure is invisible to the user but the in-app list is the source of truth (pull model backstops push); registration failure → silent retry |

### Review / Approval (status-change confirmation)

| | |
|---|---|
| **Purpose** | Two-tap confirmation of a server-suggested status transition — the mobile-first interaction |
| **Main components** | "We think *Acme — Senior Engineer* moved **applied → interview**," the triggering snippet (≤600 chars), Confirm / Reject / "Set different status" |
| **User actions** | Confirm (commit transition), reject (keep prior — mirrors classifier's `null`/prior-status behavior), or override to a specific status |
| **Data needed** | The suggested transition, source `threadId`, snippet, current vs proposed status |
| **Edge cases** | Suggestion already resolved on web (show "already handled"); negated-offer cases (server's `NEG_OFFER_RE` already mapped "unable to offer" → rejected — phone just presents the result); LLM second-pass (Pro) suggestions look identical to keyword ones to the user |
| **Failure states** | Commit fails → re-queue, keep pending; stale suggestion → refresh to current truth |

### Profile / Settings

| | |
|---|---|
| **Purpose** | Identity, preferences, subscription status, privacy controls — *links out* for the heavy ones |
| **Main components** | Account (Clerk profile), connected-mailbox status (read-only list; "manage on web"), notification prefs, logo-display toggle (`SHOW_LOGOS`), subscription tier badge, links: Manage billing (web), Export data (web), **Delete account (web)** |
| **User actions** | Edit notification prefs + display toggles in-app; everything mailbox/billing/legal/destructive → deep-link to web |
| **Data needed** | User profile, tier/subscription claim, connected-account summary, prefs |
| **Edge cases** | Subscription expired → tier reflects Free, Pro toggles show upgrade; mailbox revoked → "Reconnect on web" |
| **Failure states** | Billing/deletion never executed on-device — if the web handoff fails, instruct to complete on web. **Account deletion and data export are deliberately web-only**: they are legal/destructive (GDPR/CCPA) and demand full context and confirmation, not a thumb-swipe |

### Support / Help

| | |
|---|---|
| **Purpose** | Self-serve help + contact, with honest legal-doc framing |
| **Main components** | FAQ (privacy model, "why can't I connect mail on the phone," Free vs Pro), links to PRIVACY.md / TERMS.md, contact (must be the *real* finalized address — **not** the current placeholder; see Compliance section), app/version + diagnostics |
| **User actions** | Read FAQ; open legal docs; contact support; copy diagnostic info |
| **Data needed** | Static help content (OTA-updatable), app version/build |
| **Edge cases** | Legal docs are still drafts pre-launch — Support must not link to drafts in a public release; gate behind the same launch sequencing as web |
| **Failure states** | Contact channel unreachable → show the email address as fallback so the user is never stranded |

---

## 5.9 What would make this app bloated, useless, or expensive — stated plainly

- **On-device mailbox scanning** is the disqualifying mistake. It re-forks the classifier, puts raw mail on every device, creates a per-platform restricted-scope OAuth client to verify, and turns CASA from "one server data flow" into "thousands of uncontrolled endpoints." If you ever feel tempted, re-read brief #11.
- **A full analytics dashboard on a 390pt-wide screen** is wasted engineering. Funnel %, time-in-stage, and response-rate charts are a web experience; cramming them onto mobile produces an unreadable, expensive-to-maintain screen nobody uses. Ship *one* glance stat at most.
- **In-app billing / IAP** is a double trap: it forces Apple's 15-30% cut on what is an external SaaS subscription, and it duplicates the Merchant-of-Record flow (#13) the web already owns. Keep billing on web; the app shows status and links out.
- **The LLM second pass on-device** is impossible *and* wrong — key custody and marginal-cost control are why it's server- and Pro-only (#14). The phone shows the result; it does not call the model.
- **A fourth and fifth tab.** Three tabs (Home, Notifications, Settings) is the whole information architecture. Every feature that wants a tab is a feature that probably belongs on web.
- **Notification spam.** Two legitimate triggers exist (status approvals, reminders). Anything beyond that erodes the privacy/restraint brand and trains users to mute the app — killing the one mechanic that justifies its existence.
- **Premature native modules.** Companion-only means Expo managed workflow + OTA covers nearly all releases. Reaching for bare-workflow native code (custom mail clients, background sync engines) re-introduces exactly the maintenance load this architecture exists to avoid.

The mobile app is worth building **only** as the approval-and-reminder surface for an already-onboarded user. The moment it tries to be a standalone job-tracker that reads your inbox, it becomes the most expensive, most liability-heavy, least defensible part of the whole product.

---

# 6. Architecture Recommendation

This section specifies the ideal end-to-end architecture for the hosted web app and the companion mobile app, then gives explicit build-vs-buy and shared-vs-separate recommendations with tradeoffs. It closes with the load-bearing decision the rest of the plan depends on: collapsing the duplicated classifier (`classify.js` + `providers.py`) into one TypeScript package. Everything here obeys the Canonical Decisions Brief — Fastify/Node API, Neon Postgres, Upstash Redis, Clerk identity, Fly.io workers, push-driven incremental sync, derived-records-only persistence.

## 6.1 Component diagram

```
                            ┌──────────────────────────────────────┐
                            │  apps/web (React+TS+Vite) → Vercel    │
                            │  apps/mobile (Expo RN) → companion    │
                            └───────────────┬──────────────────────┘
                                            │ httpOnly session cookie (web)
                                            │ bearer session token (mobile)
                                            ▼
                            ┌──────────────────────────────────────┐
                            │  Clerk (identity, MFA, org/seats)     │
                            └───────────────┬──────────────────────┘
                                            │ verified session claims
                                            ▼
   Gmail / Graph ──push──►  ┌──────────────────────────────────────┐
   (Pub/Sub, change-notif)  │  apps/api  (Fastify, Node/TS) Fly.io  │
                            │  - REST + webhook ingest              │
                            │  - imports @pipeline/classify          │
                            │  - imports @pipeline/contracts (zod)   │
                            └───┬──────────────┬──────────────┬─────┘
                                │              │              │
                   enqueue ─────┤              │ KMS unwrap   │ read/write
                                ▼              ▼              ▼
                  ┌──────────────────┐  ┌────────────┐  ┌──────────────────┐
                  │ Upstash Redis    │  │ Cloud KMS  │  │ Neon Postgres    │
                  │ (queue, rate     │  │ (master    │  │ (users, accounts,│
                  │  limits, cache)  │  │  key)      │  │  enc tokens,     │
                  └────────┬─────────┘  └────────────┘  │  cursors, derived│
                           │                            │  app records)    │
                  ┌────────▼─────────┐                  └──────────────────┘
                  │ workers (Fly.io) │  ── backfill, history/delta sync,
                  │ same TS codebase │     subscription renewal, LLM 2nd-pass
                  │ @pipeline/classify│
                  └──────────────────┘

  Raw mail bodies exist ONLY in-flight inside api/workers during classify
  or LLM pass. Never written to Neon. Only derived records + ≤600-char
  snippet persist.
```

The single most important property of this diagram: `@pipeline/classify` and `@pipeline/contracts` are imported by web, mobile, the API, and the workers from the same TypeScript source. There is no second classification implementation anywhere on the hosted side.

## 6.2 Frontend architecture

| Concern | Decision |
|---|---|
| Web | React + TypeScript + Vite, component app, deployed on Vercel. Do NOT migrate the 1,394-line `index.html` monolith — reimplement. It is small enough that a clean component rebuild is faster than untangling vanilla DOM string-building. |
| Mobile | Expo / React Native, companion-only. Glance-and-act board, status changes, follow-up nudges. NEVER scans a mailbox on-device — it reads server-derived records over the hosted API. |
| State | Server state via TanStack Query (cache, revalidation, optimistic status overrides). Client-only UI state (timeframe, sort, manual card order, pin/ignore) mirrors the existing `localStorage` keys — but on hosted these become server-persisted per-user settings, with `localStorage` as the offline/optimistic cache, not the source of truth. |
| Provider abstraction | Preserve the existing `LiveProvider` / `MockProvider` swap concept from `index.html`. On hosted web, `LiveProvider` points at the API; `MockProvider` remains for the demo/funnel. The desktop `window.pipelineAPI.fetchThreads` path is a third Provider that lives only in the frozen local build. |
| Rendering primitives | Web and native do NOT share rendering. They share `@pipeline/classify`, `@pipeline/contracts`, and design tokens (`packages/ui-web`, `packages/ui-native` are separate). React-DOM and React-Native primitives do not interchange cleanly; forcing a shared component layer (react-native-web) would couple two release cadences for marginal reuse. |

The status colors (applied/gray, interview/yellow, offer/green, rejected/red) and the four-status model come from `classify.js` and must be design tokens shared across web and native, not re-hardcoded per app.

## 6.3 Backend architecture

Single Fastify (Node/TS) service for the synchronous API surface (`/api/applications`, `/api/accounts`, OAuth connect/callback, billing webhooks, settings) plus a separate worker process from the same codebase for everything asynchronous. Fastify over NestJS: the workload is plain REST + webhook + queue handlers; NestJS's DI/module ceremony is unjustified for a solo founder at this scale. FastAPI reuse of `providers.py` is rejected — it re-forks the classifier into Python and locks mobile out of importing it.

The current `server.py` design has two instincts worth carrying forward and two that must die:

- **Carry forward:** the static-file allowlist (it deliberately refuses to serve `config.json`, `.pipeline-accounts.json`, `.git` — a correct security instinct); and the strict unified contract.
- **Must die:** in-memory `_pending = {}` OAuth state (single-process only; will not survive multiple Fly machines — move to Redis with a TTL); and full-re-read-every-sync (replaced by push-driven incremental sync, §6.7).

## 6.4 Database architecture

Neon Postgres is the system of record. Core tables:

| Table | Purpose | Privacy note |
|---|---|---|
| `users` | Clerk user id mirror, plan/subscription claim | no mail content |
| `mail_accounts` | provider, email, scopes granted, sync cursor (`historyId` / Graph `deltaLink`), subscription/watch expiry | one row per connected mailbox |
| `oauth_tokens` | envelope-encrypted access+refresh tokens, per-row data key | crown jewels; never plaintext |
| `applications` | derived record: company, role, current status, threadId, domain | NO raw body |
| `status_history` | (application_id, status, observed_at) | timeline for analytics/time-in-stage |
| `snippets` | ≤600-char snippet per message (`BODY_CHARS=600`) | the only mail-derived text persisted |
| `settings` | per-user timeframe/sort/order/pin/ignore | replaces `localStorage` source-of-truth |

Raw email bodies are never columns anywhere. `status_history` is what makes Pro analytics (funnel %, time-in-stage, response rate) possible without storing inboxes.

## 6.5 API architecture

REST over HTTPS, JSON DTOs validated at the boundary by zod schemas from `@pipeline/contracts` — the same schemas the unified contract is defined in, so the wire shape and the internal shape cannot drift. The unified `{ threadId, domain, subject, messages:[{date, from, body}] }` is the canonical read DTO; `body` stays capped at 600 chars over the wire.

Endpoint families: identity-gated `/api/applications` and `/api/accounts` (read), `/api/applications/:id` (status override, notes), `/auth/<provider>/start|callback` (incremental mail consent), `/webhooks/gmail` + `/webhooks/graph` (push ingest), `/webhooks/billing` (MoR license issuance). Versioned under `/api/v1` from day one so the frozen local build and mobile can pin a contract version.

## 6.6 Auth architecture

Two decoupled grants, which is the single most important auth decision:

1. **Identity** = Clerk. httpOnly secure session cookie for web; session token for mobile. Handles MFA, recovery, and the org/seat primitives Teams needs.
2. **Mail scope** = a SEPARATE incremental OAuth grant (`gmail.readonly` / `Mail.Read`), requested only when the user clicks "connect a mailbox."

Decoupling means sign-in is never blocked by Google restricted-scope/CASA verification state — a user can have an account and pay before their mailbox is connectable. It also means the blast radius of the restricted scope is exactly the set of users who connected mail, not every signup. Token refresh logic from `providers.py valid_access_token()` (refresh + `on_refresh` persist of rotated tokens) is reimplemented in TS, writing rotated tokens back through the envelope-encryption path.

## 6.7 Background jobs and push-driven sync

This replaces the current full-rescan entirely. `providers._fetch_gmail` caps ~800 ids / 200 threads, `_fetch_graph` pulls up to 1000 via `$search`, and the `server.py` IMAP path ANDs ~12 SEARCH terms with `SINCE` capped at `MAX_MESSAGES=300` — re-searching up to a year of mail on every sync, burning quota and failing CASA's data-minimization expectation.

| Job | Trigger | Mechanism |
|---|---|---|
| First backfill | on mailbox connect | bounded historical pull, once, then store cursor |
| Incremental sync | Gmail `watch`→Pub/Sub push; Graph change-notification | `users.history` from `historyId` / Graph `delta` from `deltaLink` |
| Subscription renewal | scheduled, pre-expiry | renew watch/subscription before it lapses (this is why workers are always-on, not Lambda) |
| LLM 2nd pass | low-confidence classify result, Pro only | enqueue ambiguous thread to Haiku-class model server-side |

Queue + cursors: Upstash Redis for the job queue and rate-limit buckets; per-account cursor and subscription expiry in Postgres. Workers run on Fly.io (always-on) because subscription renewal and long backfills fight the serverless execution model.

## 6.8 Cross-cutting concerns

| Concern | Decision |
|---|---|
| File/media storage | Effectively none in the app data path — we persist derived records, not attachments. The 14 MB marketing media (`pipeline-demo.mp4`, `explainer.html`, gif, screenshots, `vo.mp3`) moves OUT of the repo to a CDN/asset repo (§ leak remediation). App needs no blob store at launch. |
| Notifications | Email (follow-up reminders, weekly digest) via a transactional provider; mobile push via Expo push for glance nudges. Both fire from workers off `status_history` transitions. |
| Analytics (product) | Privacy-respecting product analytics, no inbox content ever leaves as an event property. Pro user-facing analytics (funnel %, time-in-stage) computed server-side from `status_history`. |
| Logging | Structured JSON logs; NEVER log raw bodies, tokens, or full email addresses at info level. Redact at the logger, not by convention. |
| Monitoring | Uptime + queue-depth + sync-lag (cursor age) + subscription-expiry alarms. Sync lag and near-expiry subscriptions are the two failure modes that silently break the product. |
| Error reporting | Sentry on web/mobile/api with PII scrubbing configured before first deploy, not after. |
| Security | Envelope encryption for tokens (per-row libsodium `crypto_secretbox` data key wrapped by cloud KMS master key); allowlist-style exposure; no generic file serving; webhook signature verification on Pub/Sub/Graph/billing. |
| Permissions | Server-side subscription claim gates Pro features on hosted; Ed25519 license token gates desktop. One enforcement point per surface. |
| Data privacy | Derived-records-only; raw bodies in-flight only; user-controllable disconnect/delete/export (GDPR/CCPA) implemented as first-class API operations, not manual ops. |
| Rate limits | Per-user and per-provider buckets in Redis, plus respect for Gmail/Graph quota; backoff on the worker side, not the request side. |
| Caching | TanStack Query on clients; Redis for hot reads (account lists, settings) and idempotency keys on webhook ingest. |
| Web↔mobile sync | Both read the same server-derived records over the same versioned API. Mobile holds no authoritative state; a status override on mobile is a write to the API that the web client revalidates. No peer-to-peer or device-merge logic exists, by design. |

## 6.9 Recommendations with tradeoffs

| Question | Recommendation | Tradeoff accepted |
|---|---|---|
| Monorepo vs separate repos | **Monorepo** (pnpm + Turborepo): `@pipeline/classify`, `@pipeline/contracts`, `apps/web`, `apps/mobile`, `apps/api`, `ui-web`, `ui-native`. | One toolchain to keep green; coarser CI. Worth it: it is the only way `classify`/`contracts` stay truly singular across three runtimes. |
| Shared vs separate backends | **One backend** serving web + mobile (companion reads the same records). | A future heavy mobile-specific endpoint shares the same service. Acceptable — mobile is companion-only and adds little surface. |
| Shared vs separate UI library | **Separate** (`ui-web` React-DOM, `ui-native` RN); share only design tokens + logic. | Some duplicated component shells. Avoids coupling react-native-web and two release cadences for marginal reuse. |
| Shared vs duplicated business logic | **Shared** `@pipeline/classify` + `@pipeline/contracts`, zero duplication on the hosted side. | None worth keeping — duplication here is the existing bug, not a feature. |
| Serverless vs traditional vs hybrid | **Hybrid**: Vercel (web), Fly.io always-on api + workers, Neon, Upstash. | Two deploy targets. Required: subscription renewal + long backfills cannot live in a Lambda execution model. |

## 6.10 The classifier decision: collapse to one TypeScript package

**Yes — collapse on the hosted side. One TypeScript package, `@pipeline/classify`, is the single source of truth for classification (`detectStatus`, the scored OFFER/REJECT/INTERVIEW/APPLIED logic, negated-offer handling, the four-status precedence) and company/role resolution (`ATS_DOMAINS`, `resolveCompany`, `cleanCompanyName`, `rootName`, `extractRole`). It is imported by `apps/web`, `apps/mobile`, `apps/api`, and the workers.**

Two clarifications that the brief is precise about and most readers get wrong:

1. **`classify.js` and `providers.py` are NOT a true twin.** `classify.js` classifies and resolves company/role. `providers.py` is a raw→unified **mapper** (Gmail/Graph fetch + map to the unified shape). So "collapse the duplicated classifier" actually means two distinct moves: (a) port `classify.js` logic into `@pipeline/classify` verbatim in behavior (it is already pure, dependency-free, and dual-runtime via `module.exports` + browser globals — it ports cleanly), and (b) reimplement `providers.py`'s mapping into TS mappers under `@pipeline/contracts`, validated against the existing `mappers.test.js` corpus.

2. **The free local Python build keeps its own frozen copy — and that is acceptable**, because it is a separate artifact (frozen, not evolving). The risk this introduces is drift between the TS hosted classifier and the Python local one. We control that risk with a **shared golden corpus**, not by trying to make Python import TS.

### Mechanics of the parity gate

- A single language-neutral fixtures file (`golden/*.json`): each case is an input thread in the unified shape plus the expected `{ status, company, role }`.
- Two CI lanes run the SAME fixtures:
  - **Node lane** — feeds fixtures through `@pipeline/classify` (extends the existing `test/classify.test.js`, 131 lines).
  - **Python lane** — feeds the same fixtures through the frozen local classifier (extends `test/providers_test.py`, 130 lines).
- Both lanes assert against the identical expected outputs. Any divergence fails CI. New classification behavior must land a fixture first; both implementations must satisfy it before merge.

```
golden/cases.json ──► Node CI: @pipeline/classify  ──► assert == expected
                 └──► Python CI: frozen local       ──► assert == expected
                       (drift ⇒ red build)
```

This gives single-source-of-truth ergonomics on the hosted side (where mobile, web, and the API genuinely must share one implementation, in one language, with no FastAPI re-fork) while letting the MIT local funnel build stay a self-contained Python artifact — without the two silently diverging. Keeping two free-floating implementations with no shared corpus is the status quo and is explicitly rejected: it is exactly the dual-runtime drift this architecture exists to kill.

---

# 7. Data Model Plan

The data model is where the privacy brand either survives contact with reality or quietly dies. The hard rule that shapes everything below: **we persist derived application records, never raw email.** The unified contract `{ threadId, domain, subject, messages:[{date, from, body}] }` with `BODY_CHARS=600` is what flows through the sync→classify pipeline in memory; what lands in Postgres is the *reduction* of that — status, company, role, dates, and at most the same `<=600`-char snippet. Everything in this section enforces that boundary.

This is a hosted-side model (Neon Postgres per Canonical Decision #7). The free local build (`server.py` + `.pipeline-accounts.json` + browser `localStorage`) has no relational DB and is explicitly out of scope here — it stays frozen with its file-based store.

## 7.1 Entity overview

| Entity | Owner | Origin | Holds mail-derived data? | Encrypted at rest? |
|---|---|---|---|---|
| `User` | self | identity (Clerk) | no | standard column |
| `MailConnection` | user | OAuth connect flow | tokens only | **envelope-encrypted tokens** |
| `SyncState` | system | sync worker | cursors only | no |
| `Application` | system→user | classifier + user edits | **yes (derived)** | no (derived, non-raw) |
| `ApplicationEvent` | system→user | classifier transitions | **yes (derived)** | no |
| `Company` | system | `resolveCompany()` | no (public-ish metadata) | no |
| `Note` | user | user input | indirectly | no |
| `Contact` | user/system | sender parse + user | derived (name/email) | no |
| `Reminder` | user/system | follow-up engine | references Application | no |
| `Device` | user | mobile push registration | no | push token (sensitive) |
| `Notification` | system | reminder/sync events | references Application | no |
| `Subscription` | system | MoR webhook | no | no |
| `License` | system | MoR webhook (desktop) | no | signed token (public-verifiable) |
| `AuditLog` | system | all mutating actions | metadata only | append-only |
| `TeamsOrg` | org owner | Teams signup | no | no |
| `Seat` | org | seat admin | no | no |
| `CohortAggregate` | org | nightly rollup (opt-in) | **aggregate only, k-anonymized** | no |

**Ownership semantics.** "self / user" = user-owned, user-editable, deletable on request (GDPR/CCPA erasure). "system" = system-generated, immutable or system-managed. The hybrid `system→user` entities (`Application`, `ApplicationEvent`) are *generated* by the classifier but *overridable* by the user — this mirrors the existing local behavior where `pipeline.manualPositions` and manual status-override maps in `localStorage` let the user correct the classifier. On hosted, those overrides become first-class columns, not client-only state.

## 7.2 Core entities

### User

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid (pk) | ✓ | internal |
| `clerk_user_id` | text (unique) | ✓ | identity is Clerk (Decision #8); we do NOT store passwords |
| `email` | citext | ✓ | from Clerk; for billing/contact, not mail scope |
| `display_name` | text | ✗ | |
| `created_at` / `updated_at` | timestamptz | ✓ | |
| `deleted_at` | timestamptz | ✗ | soft-delete tombstone; hard-purge job clears children |
| `tier` | enum(free,pro,teams) | ✓ | denormalized from `Subscription` for fast gating |
| `org_id` | uuid (fk → TeamsOrg) | ✗ | null unless Teams seat |

Sign-in identity (`User`) is deliberately decoupled from the mail grant (`MailConnection`). A user exists and can sign in, pay, and use demo data with zero mailboxes connected — which is exactly what keeps account creation from being blocked by Google restricted-scope / CASA verification status (Decision #8).

### MailConnection (the Account/mailbox entity — crown jewels)

This is the entity that replaces today's `.pipeline-accounts.json`. Where the local build writes `chmod 0600` plaintext JSON (acceptable local, unacceptable hosted per the brief), the hosted store uses **envelope encryption** (Decision #9).

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid (pk) | ✓ | |
| `user_id` | uuid (fk → User) | ✓ | RLS isolation key |
| `provider` | enum(google,microsoft,imap) | ✓ | mirrors `providers.py` provider set |
| `email_address` | citext | ✓ | the connected mailbox |
| `scopes` | text[] | ✓ | e.g. `gmail.readonly`, `Mail.Read offline_access` |
| `enc_access_token` | bytea | ✓ | `crypto_secretbox` ciphertext |
| `enc_refresh_token` | bytea | ✓ | the long-lived secret; the real crown jewel |
| `enc_token_nonce` | bytea | ✓ | per-row nonce |
| `wrapped_dek` | bytea | ✓ | per-row data key, wrapped by KMS master key |
| `kms_key_id` | text | ✓ | which master key version wrapped the DEK (rotation) |
| `token_expires_at` | timestamptz | ✓ | drives `valid_access_token()`-equivalent refresh |
| `status` | enum(active,reauth_required,revoked,disconnected) | ✓ | `reauth_required` when refresh fails |
| `connected_at` / `last_synced_at` | timestamptz | ✓/✗ | |

**Envelope scheme.** Each connection gets a per-row data-encryption key (DEK). The DEK encrypts the access/refresh tokens via libsodium `crypto_secretbox`; the DEK itself is wrapped by a master key in cloud KMS and stored as `wrapped_dek`. Decryption is two hops: KMS unwraps the DEK, the DEK decrypts the token. This limits blast radius (a DB dump leaks ciphertext, not tokens) and lets us rotate the master key without re-reading every row — we re-wrap DEKs, not re-encrypt tokens. The desktop `safeStorage`/base64 path is local-only and is NOT this; it never touches the hosted DB.

### SyncState (per-connection cursor)

This entity *is* the fix for the brief's biggest scaling defect — the current "FULL RE-READ EVERY TIME" (Gmail caps ~800 ids / 200 threads, Graph up to 1000, IMAP `MAX_MESSAGES=300`, re-searching ~1 year on every sync). The model carries a durable cursor so sync becomes incremental (Decision #10).

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid (pk) | ✓ | |
| `connection_id` | uuid (fk → MailConnection, unique) | ✓ | 1:1 with connection |
| `gmail_history_id` | text | ✗ | Gmail `users.history` cursor |
| `graph_delta_link` | text | ✗ | Microsoft Graph `delta` continuation token |
| `imap_uidvalidity` / `imap_last_uid` | text/bigint | ✗ | IMAP incremental anchor |
| `watch_subscription_id` | text | ✗ | Gmail `watch` / Graph subscription id |
| `subscription_expires_at` | timestamptz | ✗ | renewed before expiry by the worker |
| `backfill_complete` | bool | ✓ | full backfill runs ONCE on first connect |
| `last_sync_started_at` / `last_sync_error` | timestamptz/text | ✗ | observability |

The unique 1:1 with `MailConnection` is deliberate: a cursor is meaningless detached from its mailbox, and the previous in-memory `_pending = {}` OAuth state in `server.py` (which "won't survive multi-worker/hosted") teaches the lesson — anything sync needs to survive a process restart lives in Postgres, not process memory.

### Application (the derived record — the privacy line in the sand)

One row per detected job application. This is the durable reduction of a mail thread. **It does not store the raw email body.** The only free text it carries is `snippet`, the same `<=600`-char capped string already defined as `BODY_CHARS=600` in the unified contract.

| Field | Type | Req | Source | Notes |
|---|---|---|---|---|
| `id` | uuid (pk) | ✓ | system | |
| `user_id` | uuid (fk) | ✓ | system | RLS key |
| `connection_id` | uuid (fk) | ✓ | system | which mailbox |
| `thread_id` | text | ✓ | provider | from unified contract `threadId`; unique per (connection, thread) |
| `domain` | text | ✓ | provider | sender domain |
| `company_id` | uuid (fk → Company) | ✗ | `resolveCompany()` | resolved employer (ATS-aware) |
| `role` | text | ✗ | `extractRole()` | job title from subject |
| `status` | enum(applied,interview,offer,rejected) | ✓ | `detectStatus()` | the four canonical statuses |
| `status_confidence` | numeric | ✗ | classifier score | drives LLM second-pass escalation (Pro, #14) |
| `status_source` | enum(keyword,llm,manual) | ✓ | pipeline | provenance: which pass set it |
| `manual_status_override` | enum(...)\|null | ✗ | user | replaces local `localStorage` override map |
| `subject` | text | ✗ | provider | last subject seen |
| `snippet` | varchar(600) | ✗ | provider | **the ONLY mail text persisted; `<=600` chars** |
| `applied_at` / `last_event_at` | timestamptz | ✗/✓ | events | for timeframe filtering |
| `is_pinned` / `is_ignored` | bool | ✓ | user | replaces local pin/ignore sets |
| `manual_position` | jsonb | ✗ | user | replaces `pipeline.manualPositions` |
| `created_at` / `updated_at` | timestamptz | ✓ | system | |

Note how the client-only `localStorage` keys from the brief (`pipeline.manualPositions`, pin/ignore sets, manual status-override maps) all become real columns here. On the local build they stay in `localStorage`; on hosted they must persist server-side so the board is identical on web and the companion mobile app — mobile reads these records, it never re-derives them (Decision #2).

### ApplicationEvent (status timeline / history)

Append-only history of status transitions. This is what powers Pro analytics (time-in-stage, funnel %, response rate) without ever needing raw mail.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid (pk) | ✓ | |
| `application_id` | uuid (fk) | ✓ | |
| `user_id` | uuid (fk) | ✓ | RLS key (denormalized for query isolation) |
| `from_status` / `to_status` | enum\|null | ✓ | transition; `from` null on first detection |
| `source` | enum(keyword,llm,manual) | ✓ | provenance |
| `message_date` | timestamptz | ✗ | the mail message's date (from contract) |
| `detected_at` | timestamptz | ✓ | when our pipeline recorded it |
| `snippet` | varchar(600) | ✗ | the snippet that triggered the transition |

Immutable: no updates, no deletes except on account erasure. Time-in-stage = diff between consecutive events; response rate = fraction of `applied` rows that ever reached a non-`applied` event. All computed from this table — zero raw-mail dependency.

### Company

Derived from `resolveCompany()` / `cleanCompanyName()` / `rootName()` logic in `classify.js`. Shared/deduplicated across users — a company is not user-private data (it's the employer, recovered from public ATS sender patterns like "Acme via Greenhouse").

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid (pk) | ✓ | |
| `canonical_name` | text (unique) | ✓ | output of `cleanCompanyName` |
| `root_domain` | text | ✗ | `rootName()` multi-TLD-aware |
| `is_ats` | bool | ✓ | from `ATS_DOMAINS` set (~40 platforms) |
| `logo_fetch_allowed` | bool | ✓ | gates the `s2/favicons` fetch; `SHOW_LOGOS=false` default (privacy) |

Logos are NEVER stored as blobs. The brief's privacy posture (favicons via `google.com/s2/favicons` with `referrerpolicy=no-referrer`, off by default) is preserved: we store a flag and the client fetches on demand only when the user opts in.

### Note / Contact (user-owned, Pro)

| Note field | Type | Req | | Contact field | Type | Req |
|---|---|---|---|---|---|---|
| `id` | uuid | ✓ | | `id` | uuid | ✓ |
| `user_id` | uuid (fk) | ✓ | | `user_id` | uuid (fk) | ✓ |
| `application_id` | uuid (fk) | ✗ | | `application_id` | uuid (fk) | ✗ |
| `body` | text | ✓ | | `name` | text | ✗ |
| `created_at` | timestamptz | ✓ | | `email` | citext | ✗ |
| | | | | `source` | enum(parsed,manual) | ✓ |

`Contact.email`/`name` may be derived from the `from` field of the contract (recruiter sender) — this is the one place a real human's contact data is persisted, and it must be erasable. `Note.body` is the user's own words, not mail content.

### Reminder / Notification / Device

| Reminder | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid | ✓ | |
| `user_id`/`application_id` | uuid fk | ✓ | |
| `due_at` | timestamptz | ✓ | follow-up engine |
| `kind` | enum(followup,interview_prep,stale) | ✓ | |
| `status` | enum(pending,sent,dismissed) | ✓ | |

| Device | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid | ✓ | |
| `user_id` | uuid fk | ✓ | |
| `platform` | enum(ios,android,web) | ✓ | |
| `push_token` | text | ✓ | Expo/APNs/FCM token — sensitive, rotate on logout |
| `last_seen_at` | timestamptz | ✓ | |

`Notification` is a thin join (`user_id`, `reminder_id`/`application_id`, `channel`, `sent_at`, `read_at`) — it carries references, never mail content. Mobile is companion-only (Decision #2): a push says "3 stale applications" or "follow up with Acme," derived from records, never from re-reading a mailbox.

### Subscription / License (billing + open-core gate)

| Subscription | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid | ✓ | |
| `user_id` | uuid fk | ✓ | |
| `mor_provider` | enum(lemonsqueezy,paddle) | ✓ | Merchant-of-Record (handles VAT) |
| `mor_subscription_id` | text | ✓ | external id |
| `tier` | enum(pro,teams) | ✓ | |
| `status` | enum(active,past_due,canceled) | ✓ | hosted gating reads this claim server-side |
| `current_period_end` | timestamptz | ✓ | |

| License | Type | Req | Notes |
|---|---|---|---|
| `id` | uuid | ✓ | |
| `user_id` | uuid fk | ✓ | |
| `ed25519_token` | text | ✓ | signed, offline-verifiable; public key embedded in desktop app |
| `issued_at`/`revoked_at` | timestamptz | ✓/✗ | |

Hosted Pro gates on the live `Subscription.status` claim; desktop Pro gates on the `License.ed25519_token` (Decision #13). We store the issued token for re-issue/audit, but verification is offline against the embedded public key — no phone-home DRM.

### AuditLog / Teams entities

`AuditLog` (append-only): `id`, `user_id`, `actor`, `action` (connect/disconnect/export/delete/reauth), `target_type`, `target_id`, `metadata jsonb`, `created_at`. Metadata only — never mail content. This is the GDPR/CCPA evidence trail for "user-controllable disconnect/delete."

`TeamsOrg` (`id`, `name`, `owner_user_id`, `white_label_config jsonb`), `Seat` (`id`, `org_id`, `user_id?`, `invited_email`, `status`), and `CohortAggregate` (`id`, `org_id`, `period`, `metric`, `value`, `cohort_size`) implement Teams. The non-negotiable: `CohortAggregate` is **opt-in, aggregate-only, k-anonymized** — it stores counts and percentages (`120 applied → 18 offers`), with a minimum `cohort_size` suppression threshold, and has **no foreign key to `Application`, no thread_id, no snippet, no path back to inbox content.** The schema is physically incapable of leaking an individual's mail because the join doesn't exist.

## 7.3 Storage tiering — what lives where

| Store | Holds | Never holds |
|---|---|---|
| **Postgres (Neon)** | Users, connections, encrypted tokens, sync cursors, derived `Application`/`Event` records, companies, notes, contacts, reminders, subscriptions, licenses, audit log, Teams entities | raw email bodies, full message text, attachments |
| **Object storage (S3/R2)** | user-generated **exports only** (CSV/PDF) — ephemeral, signed-URL, TTL'd and auto-deleted | anything persistent; no raw mail |
| **Redis (Upstash)** | sync job queue, rate-limit buckets, short-lived OAuth `state`/PKCE verifier (replacing the in-memory `_pending = {}`), ephemeral session/derived caches | tokens, raw mail, durable records |
| **In-flight memory only** | raw `messages[].body` during sync→classify; raw text during optional Pro LLM second-pass | — discarded after reduction to a record; never written to any durable store |
| **Client (localStorage)** | *local build only* — `pipeline.*` UI prefs; on hosted these are DB columns | — |

## 7.4 What is NEVER stored

This is the load-bearing privacy claim, stated explicitly so it can be audited (and survives CASA Tier 2 / data-minimization review):

- **Raw email bodies** beyond the `<=600`-char `snippet`. The full body exists only in flight, in two narrow windows: (a) during the `sync → @pipeline/classify` pass before reduction to an `Application` row, and (b) during the optional Pro LLM second-pass (Decision #14), where text is sent to the model but the sent body is never persisted. After each window the raw text is dropped.
- **Email attachments** — never fetched, never stored.
- **Plaintext OAuth tokens** — only envelope-encrypted ciphertext touches the DB.
- **Logo image blobs** — flag only; client fetches favicons on demand when opted in.
- **Individual inbox content in Teams aggregates** — physically impossible by schema (no FK to `Application`).

## 7.5 Access control & isolation

- **Row-level isolation per user.** Every user-scoped table carries `user_id` and is protected by Postgres **row-level security** policies keyed to the authenticated principal (the Clerk session → request context). `user_id` is denormalized onto child tables (`ApplicationEvent`, `Note`) specifically so RLS can isolate without multi-hop joins. This is the hosted equivalent of `server.py` binding `127.0.0.1` and serving a strict file allowlist — the local build got isolation for free by being single-user; hosted must enforce it per row.
- **Token decryption is privileged.** Only the sync/refresh worker path can unwrap DEKs via KMS; the web/API request path never has a code path that returns a decrypted token to a client.
- **Erasure / export (GDPR/CCPA).** Account deletion cascades: revoke OAuth grants, hard-delete all `user_id`-scoped rows, purge exports from object storage, write a final `AuditLog` tombstone. Export produces a CSV/PDF of derived records (the only data we hold) to a TTL'd signed URL. Because we never persisted raw mail, "delete my data" is honest and complete — there is no shadow copy of an inbox to forget.

The whole model is designed so that the strongest sentence in the privacy policy — *"we store what we concluded about your job search, not your email"* — is true at the schema level, not just in marketing copy. The `snippet` cap, the absence of a raw-body column, and the missing Teams→Application join are the three structural facts that make it enforceable.

---

# 8. Backend and API Plan

This section specifies the hosted Node/TypeScript API (Fastify) per Canonical Decisions #6, #7, #10, #12. The existing `server.py` (566 lines, stdlib `http.server`, in-memory `_pending`, full-re-read sync) is the **frozen local build** and is not evolved here — it is the funnel artifact, not the commercial backend. Everything below replaces it for hosted multi-user. The hosted API imports `@pipeline/classify` and `@pipeline/contracts` so classification and the unified `{ threadId, domain, subject, messages:[{date, from, body}] }` shape (`BODY_CHARS=600`) are literally the same code path as web and mobile.

## 8.1 Service module layout

Fastify with a plugin-per-domain structure. Each module is a route plugin + a service layer; no NestJS-style DI container (decision #6). Shared concerns (auth, db, queue, kms) are Fastify decorators registered once.

```
apps/api/src/
  plugins/        auth.ts  db.ts  redis.ts  queue.ts  kms.ts  ratelimit.ts  audit.ts
  modules/
    accounts/     OAuth connect/disconnect, list connections, token lifecycle
    sync/         enqueue sync, cursor mgmt, NOT user-callable for full scans
    applications/ CRUD, manual override, add-position, search/filter/sort/paginate
    analytics/    funnel %, time-in-stage, response rate, digest (Pro, server-gated)
    reminders/    follow-up rules + scheduling (Pro)
    notifications/ device registration, push tokens (mobile companion)
    billing/      MoR webhook ingest, subscription claim resolution
    export/       CSV/PDF job creation + signed download (Pro)
    privacy/      account export (GDPR), account delete (right-to-erasure)
    teams/        seat admin, roles, opt-in cohort aggregates (Teams)
    webhooks/     gmail-pubsub, graph-notifications  (unauthenticated, signature/JWT verified)
  workers/        sync.worker.ts  reminder.worker.ts  export.worker.ts  renewal.worker.ts  llm.worker.ts
```

Identity itself (sign-up, login, MFA, recovery, org primitives) lives in **Clerk** (decision #8), not in this API. The API only consumes Clerk-issued session JWTs. This is deliberate: sign-in must never be blocked by Google restricted-scope/CASA verification state, because the mail grant is a *separate* incremental consent (8.2).

## 8.2 Endpoint surface

`/api/v1` prefix; versioned from day one because mobile is a separately-shipped client that cannot be force-upgraded. All bodies validated by zod schemas exported from `@pipeline/contracts` (8.4).

| Module | Method + path | Auth | Notes |
|---|---|---|---|
| Accounts | `POST /accounts/:provider/connect/start` | session | Begins incremental mail consent (gmail.readonly / Mail.Read). Returns provider auth URL + persisted PKCE state. |
| Accounts | `GET /accounts/:provider/callback` | state | OAuth code→token exchange; envelope-encrypts tokens (#9); enqueues first-connect backfill. |
| Accounts | `GET /accounts` | session | List connected mailboxes, status, last-sync cursor age. No token material returned. |
| Accounts | `POST /accounts/:id/disconnect` | session | Revoke at provider, delete encrypted token row, tear down watch/subscription. |
| Sync | `POST /accounts/:id/resync` | session | Enqueues *incremental* job (debounced). NOT a full re-read; full backfill is first-connect only. |
| Applications | `GET /applications` | session | Search/filter/sort/paginate (8.10). Per-user isolation enforced (8.3). |
| Applications | `GET /applications/:id` | session | Single record incl. status-history. |
| Applications | `POST /applications` | session | Manual add-position (the Free manual-add feature). |
| Applications | `PATCH /applications/:id` | session | Manual status override, notes, pin/ignore. Override is sticky vs auto-classification. |
| Applications | `DELETE /applications/:id` | session | Soft-delete (ignore) or hard-delete. |
| Analytics | `GET /analytics/funnel` etc. | session + Pro | Server-side subscription-claim gate (#13). 403 with upgrade code if Free. |
| Reminders | `GET/POST/PATCH/DELETE /reminders` | session + Pro | Follow-up rules. |
| Notifications | `POST /devices` / `DELETE /devices/:id` | session | Register Expo push token (mobile). |
| Billing | `POST /webhooks/billing` | MoR signature | Lemon Squeezy / Paddle. Idempotent (8.6). |
| Export | `POST /export` → `GET /export/:id` | session + Pro | Async job; returns short-lived signed URL. |
| Privacy | `POST /privacy/export` | session | GDPR data export job (derived records + account metadata). |
| Privacy | `POST /privacy/delete` | session | Right-to-erasure: revoke grants, purge rows, tear down subscriptions, audit. |
| Teams | `GET/POST /teams/:id/seats`, `PATCH .../members/:id/role` | session + Teams admin | Seat/license admin, role assignment. |
| Teams | `GET /teams/:id/cohort` | session + Teams admin | Opt-in **aggregate-only** cohort metrics; never returns inbox content or per-individual rows. |
| Webhooks | `POST /webhooks/gmail` | Pub/Sub OIDC JWT | Push notification → enqueue incremental sync. |
| Webhooks | `POST /webhooks/graph` | clientState + validationToken | Change notification → enqueue delta. Handles subscription validation handshake. |

## 8.3 Auth middleware and authorization

- **Authentication.** A Fastify `preHandler` verifies the Clerk session JWT (JWKS-cached, rotating keys) and attaches `req.user = { userId, orgId?, plan }`. `plan` (free/pro/teams) is resolved from the billing subscription claim, cached in Redis with a short TTL and busted on billing webhook. Public webhook routes skip this handler and use their own signature verification.
- **Per-user row isolation (non-negotiable).** Every `applications`, `accounts`, `reminders` row carries `user_id`. There is no endpoint that takes a raw row id without an implicit `WHERE user_id = $current`. Enforce in the data-access layer, not ad hoc per route — a single `scopedRepo(userId)` wrapper so a forgotten predicate is impossible by construction. Belt-and-suspenders: enable Postgres **row-level security** with a `SET app.user_id` per transaction so even a leaked query can't cross tenants.
- **Teams roles.** `org_member` carries `role ∈ {owner, admin, member}`. Seat admin and cohort endpoints require `admin|owner`. Cohort queries run through a view that enforces a **minimum-cohort-size k** (e.g. k≥5) and returns only aggregates — there is no code path from a Teams admin to an individual member's applications or inbox content. This is a compliance boundary, not just a UI choice.
- **Pro/Teams gating** is server-side (#13): the subscription claim is checked in the `preHandler`, never trusted from the client. Desktop's Ed25519 license token is irrelevant on the hosted side.

## 8.4 Validation and error responses

- All inputs validated against zod schemas from `@pipeline/contracts` (Fastify type-provider). The unified contract and every API DTO live there as the single source of truth, shared with web/mobile so a contract change is a compile error across all clients.
- Error envelope is uniform: `{ error: { code, message, details? } }` with stable machine `code`s (`UNAUTHENTICATED`, `FORBIDDEN_PLAN`, `NOT_FOUND`, `VALIDATION`, `RATE_LIMITED`, `PROVIDER_REAUTH_REQUIRED`, `CONFLICT`). `PROVIDER_REAUTH_REQUIRED` is first-class: clients must distinguish "your Google grant was revoked, reconnect" from a generic 500.
- 401 vs 403 is meaningful: 401 = no/invalid session; 403 = valid session, insufficient plan (carries `upgrade` hint) or wrong tenant.

## 8.5 Incremental sync (the core rewrite)

This replaces the current full-year re-read. Today `providers._fetch_gmail` pages ~800 ids and refetches 200 threads (`format=metadata`), `_fetch_graph` pulls up to 1000 via `$search` + junk folder, and the IMAP path ANDs ~12 SEARCH terms with `SINCE` capped at `MAX_MESSAGES=300` — every sync, up to a year of mail. That is unscalable, burns quota linearly with every poll, and **will fail CASA's data-minimization review**. Hosted sync is cursor-based and push-driven (#10).

**Steady-state quota budget (the target envelope we engineer toward).** After the one-time first-connect backfill, a connected account should cost ~1 `users.history.list` per Gmail change notification plus a bounded fetch of only the changed message IDs — target **well under ~50 Gmail API quota units/account/day** in steady state (versus hundreds-to-thousands per full rescan today), comfortably inside Gmail's default per-user and per-project ceilings. For Graph: one `delta` round per change notification, with **subscriptions renewed before their ~3-day maximum lifetime**, and `429 Retry-After` treated as the authoritative budget signal. Hold **≥50% headroom** under each provider's documented per-user rate ceiling so a notification storm can't tip an account into throttling/suspension, and alert when any account exceeds ~2× its rolling-median daily call count (the signature of a sync loop). The whole point of the rewrite is to make per-user cost **O(changes), not O(mailbox)**.

### Per-account sync state (Postgres)

```
account(id, user_id, provider, email,
        gmail_history_id,            -- Gmail cursor
        graph_delta_link,            -- Graph delta cursor (opaque URL)
        watch_expiration,            -- Gmail watch expiry (~7d max)
        subscription_id, subscription_expiration,  -- Graph (~3d max for mail)
        last_full_backfill_at, sync_status, last_error)
```

### Gmail: `watch` + `users.history`

1. **First connect** → bounded backfill (recent window, e.g. 90–180d, *not* "all mail"), classify in-flight, persist derived records, store the latest `historyId` as the cursor. Then call `users.watch` targeting a Pub/Sub topic.
2. **Steady state** → Gmail posts to our Pub/Sub topic on mailbox change → Pub/Sub push → `POST /webhooks/gmail` (OIDC-JWT verified) → enqueue a sync job keyed by account. The worker calls `users.history.list(startHistoryId=cursor)`, walks `messagesAdded`, fetches only those message ids (`format=metadata`, batched), classifies, upserts records, advances the cursor. **No re-search of old mail, ever.**
3. **Watch renewal.** `watch` expires in ≤7 days; a renewal worker (8.7) re-arms watches well before `watch_expiration`. Missing this = silent sync death, so it is monitored and alerted.
4. **historyId expiration / 404.** Gmail expires very old `historyId`s; `history.list` then returns 404. The worker catches this, marks `sync_status='reconciling'`, and runs a **bounded reconciliation backfill** over the recent window to re-derive records and capture a fresh `historyId`. Reconciliation is idempotent because records upsert on `(account_id, thread_id)` — re-running never duplicates.

### Microsoft Graph: `delta` + change-notification subscriptions

1. **First connect** → bounded delta-seed over the recent window; persist `@odata.deltaLink` as `graph_delta_link`. Create a `/me/messages` change-notification subscription (clientState secret stored) → notifications hit `POST /webhooks/graph`.
2. **Steady state** → notification → enqueue → worker GETs the stored `deltaLink`, processes changes, classifies, upserts, stores the new `deltaLink`. Graph mail subscriptions expire fast (~3 days) so the renewal worker re-subscribes before `subscription_expiration`.
3. **Validation handshake.** `/webhooks/graph` answers the `validationToken` echo on subscription creation and verifies `clientState` on every notification (else drop).
4. **deltaLink invalidation (410 Gone / resync).** Graph can invalidate a delta token; the worker catches it, re-seeds delta over the recent window, same idempotent upsert.

### Poll fallback

Notifications are best-effort, not guaranteed delivery. A low-frequency **safety poll** (e.g. every few hours per account) runs the same history/delta path from the stored cursor to catch dropped notifications. This is cheap because it starts from the cursor — it is *not* the old full re-read. IMAP accounts (which have no push) rely on this poll, scoped by stored UID/cursor rather than a 1-year `SINCE`.

## 8.6 Workers, queue, webhooks

- **Queue: BullMQ on Upstash Redis** (#7). Queues: `sync`, `renewal`, `reminders`, `export`, `llm`. Jobs are **keyed by account id** so a given mailbox never syncs concurrently with itself (BullMQ job-id dedupe / per-account lock) — this prevents cursor races where two workers advance `historyId` past each other.
- **Webhook handlers are thin.** Gmail/Graph push handlers do *only*: verify signature/JWT, enqueue a job, return 200 fast. No syncing inside the request — providers retry/withdraw subscriptions if you're slow or flaky. Billing webhooks likewise enqueue then 200.
- **Idempotency.** Billing webhooks dedupe on the MoR event id (unique table). Sync upserts on `(account_id, thread_id)` and only advance the cursor after a successful transaction, so a redelivered notification is a no-op.
- **Retry/backoff.** BullMQ exponential backoff with jitter. Provider 429 / `rateLimitExceeded` / Graph 429 with `Retry-After` are honored explicitly (respect the header over the default curve). Permanent errors (revoked grant → `invalid_grant`) do **not** retry; they flip the account to `reauth_required`, surface `PROVIDER_REAUTH_REQUIRED` to clients, and stop syncing.

## 8.7 OAuth token refresh and revocation

- **Refresh** happens in the worker before any provider call via a `validAccessToken(accountId)` helper (the hosted analogue of `providers.valid_access_token`'s `on_refresh`). It decrypts the refresh token (envelope, #9), refreshes if the access token is near expiry, and **persists the rotated token re-encrypted** in the same transaction. Microsoft rotates refresh tokens on every use — failing to persist the new one bricks the account, so this write is mandatory, not best-effort.
- **Concurrency.** Refresh is guarded by the per-account lock so two workers don't both refresh and invalidate each other's rotated token.
- **Revocation (both directions).** User disconnect → call the provider revoke endpoint, delete the encrypted row, tear down watch/subscription. Provider-side revocation (user pulled access in their Google/MS account) surfaces as `invalid_grant` on refresh → flip to `reauth_required`, stop the subscription, notify the user to reconnect. Account delete (8.2 privacy) does both plus purges derived records.

## 8.8 Quota and rate limits as a first-class concern

The current design's failure mode is quota exhaustion; the hosted design is built around avoiding it.

| Lever | Approach |
|---|---|
| **Watch over poll** | Push-driven sync means we touch the API on *change*, not on a timer. This is the single biggest quota win vs the current per-sync full re-read. |
| **Bounded backfill** | First connect reads a recent window, not "all mail." No endpoint re-reads a year. |
| **Batching** | Gmail message fetches batched (HTTP batch / concurrent with a cap); `format=metadata` only — we never need full bodies for the derived record beyond the 600-char snippet. |
| **Per-user fairness** | Sync queue concurrency is bounded *per account and globally*, so one user's giant mailbox can't starve others or blow the project-wide Gmail quota. Token-bucket rate-limit (Redis) per provider project. |
| **Backoff** | Exponential + jitter; honor `Retry-After` / Graph 429; circuit-break a provider project if it returns sustained 429/5xx. |
| **API rate limiting (our own)** | Fastify rate-limit plugin backed by Upstash Redis, keyed by userId, distinct buckets for cheap reads vs expensive ops (export, resync, LLM). |

## 8.9 LLM second pass (Pro)

`@pipeline/classify` (keyword/regex) runs first in the sync worker. Only **low-confidence/ambiguous** threads (the brittle multilingual/mixed-signal cases the regex classifier is known to miss) are escalated to the `llm` queue, server-side, Pro-only (#14), default Haiku-class Claude for cost-per-classification. Raw text sent to the LLM is held in-flight only and **never persisted** (#11) — only the resulting `{status, company, role}` and the existing 600-char snippet land in the record. This caps marginal cost (most threads never hit the LLM) and keeps the price gate honest.

## 8.10 Search, filter, sort, pagination, export

- **Reads come from derived records in Postgres**, never by re-querying the mailbox. So search/filter/sort are normal SQL: filter by status/timeframe/company, full-text on company/role/snippet (`tsvector` or trigram), sort by last-activity. The board's pin/ignore/manual-position state persists server-side per user (the local build keeps these in `localStorage`; hosted promotes them to rows).
- **Pagination** is keyset (cursor on `last_activity, id`), not offset — stable under concurrent inserts from background sync.
- **Export** (CSV/PDF) is an async `export` job → object storage → short-lived signed URL; never a synchronous request that could time out on a large board. CSV from derived rows; PDF rendered server-side. Pro-gated server-side.

## 8.11 Audit logging and privacy operations

- **Audit log** (append-only table) for security/compliance-relevant events: mailbox connect/disconnect, token refresh failures, revocations, data export, account delete, Teams role changes, cohort access. Stores actor, action, target, timestamp — **never inbox content**. This is needed for CASA and for answering "who accessed what" in a B2B Teams deal.
- **Privacy ops are real endpoints, not manual scripts.** `privacy/export` and `privacy/delete` are the GDPR/CCPA expression of the brand: delete revokes provider grants, tears down watches/subscriptions, hard-deletes derived rows and tokens, and writes an audit entry. Because we persist derived records and never raw bodies (#11), the deletable surface is small — which is the point.

## 8.12 Where the backend gets fragile, and the guard

| Fragility | Failure | Guard |
|---|---|---|
| **Watch/subscription expiry** | Silent sync death; users see a stale board with no error | Renewal worker re-arms before expiry; alert if `watch_expiration`/`subscription_expiration` passes without renewal; safety poll catches gaps |
| **historyId / deltaLink invalidation** | `history.list` 404 / Graph 410 | Catch → bounded reconciliation backfill → fresh cursor; idempotent upsert means no dupes |
| **Refresh-token rotation (MS)** | Account bricks if rotated token isn't persisted | Persist rotated token in the same txn; per-account lock; `invalid_grant` → `reauth_required` not infinite retry |
| **Cursor races** | Two workers skip events past each other | Per-account job key + lock; advance cursor only post-commit |
| **Webhook in request path** | Slow handler → provider drops subscription | Handlers enqueue-and-200; all work in workers |
| **Quota exhaustion** | Project-wide Gmail/Graph throttling kills *all* users | Push-not-poll, bounded backfill, per-project token bucket, circuit breaker, honor `Retry-After` |
| **In-memory OAuth state** (today's `_pending = {}`) | Breaks the moment you run >1 process | PKCE state persisted in Postgres/Redis with TTL, not process memory — required before any horizontal scale |
| **Notification loss** | Missed change → permanently stale account | Cursor-based safety poll reconciles from last cursor; cheap because incremental |

The throughline: the hosted backend is correct only if **every sync path is cursor-based and idempotent**, **every cursor/subscription has a renewal + reconciliation path**, and **no work happens in a webhook request**. Those three invariants are what turn the current single-user full-re-read prototype into something that survives multi-user load and a CASA review.

---

# 9. UX/UI Plan

The current UI is one 76 KB `index.html` (1,394 lines, vanilla JS, dark theme, no framework, no tokens, localStorage-only state). It is genuinely good for what it is — a single-screen kanban board that works in three run modes off one `LiveProvider`/`MockProvider` swap. But "works" and "feels like a product someone pays for" are different bars. Per the Canonical Brief (#3), the hosted UI is a **rebuild** in React+TS+Vite consuming `@pipeline/contracts`; the local `index.html` is **frozen**. This section specifies the hosted UX. Where a principle should be retrofitted into the frozen local build cheaply, it is called out. Mobile (#2) is companion-only: glance-and-act over server-derived records, never an on-device scanner.

## 9.1 Design principles

These are constraints, not vibes. Each maps to a brand or architecture fact.

| Principle | What it means concretely | Grounded in |
|---|---|---|
| **Privacy is visible, not claimed** | The UI must surface *what we stored* (derived record + ≤600-char snippet) and *what we never stored* (raw body). A per-thread "what we keep" affordance. Disconnect/delete are first-class, not buried. | Brief #11 (derived records only), privacy-as-brand constraint |
| **Glance-first** | The primary job is "where do my applications stand" answered in <2 seconds without scrolling. Status is encoded redundantly (color + label + column), never color alone. | The four-status model in `classify.js`; WCAG (color-not-sole-channel) |
| **Trust the machine, but show your work** | Auto-classification is fallible (keyword/regex; brittle on multilingual/mixed-signal). Every status shows provenance: auto vs. manual-override, and for Pro LLM, a confidence signal. One-click correct. | `classify.js` returns `null` on no-match; manual override maps already in localStorage |
| **Calm, dense, professional** | This is a tool people open daily under stress (job hunting). No celebratory confetti, no growth-hack nags. Dark, low-chroma, high-signal. Density over whitespace-luxury. | Dark theme is the existing identity; audience |
| **One model, three surfaces** | Web, desktop, mobile render the same `{ threadId, domain, subject, messages[] }`. Shared *logic + tokens*, not shared *rendering primitives* (web and native diverge). | Brief #4 (ui-web vs ui-native split) |
| **Reversible by default** | Manual overrides, pins, ignores are non-destructive and undoable. Only disconnect/delete are destructive and they get a hard confirm. | Existing pin/ignore/override sets |

## 9.2 Layout strategy

Single-purpose product → resist the SaaS reflex to build a sidebar full of pages. The core is **one screen**: the board. Everything else is a panel, a modal, or a settings route.

**Three-region app shell (web):**

```
┌──────────────────────────────────────────────────────┐
│  Top bar: logo · account switcher · search · sync ·   │  ← global, ~56px
│           timeframe · sort · settings/avatar          │
├──────────────────────────────────────────────────────┤
│  Board region (4 status columns, horizontally         │
│  scrollable on narrow):                               │  ← the product
│  [Applied] [Interview] [Offer] [Rejected]             │
│                                                        │
│  Right detail drawer slides over board on card open → │  ← contextual
└──────────────────────────────────────────────────────┘
```

- **No left nav for the core experience.** A left rail appears only for Pro/Teams surfaces that are genuinely separate destinations: **Analytics**, **Reminders**, **Settings/Billing**, **Team admin**. Free users never see a rail — the board is the whole app, matching the current single-screen mental model.
- **Detail is a right drawer, not a route change.** Clicking a card opens a drawer over the board (keeps context, supports keyboard close). This mirrors the current model where there is no navigation — just the board — and avoids a router for the highest-frequency action.
- **Max content width** on the board is "as wide as it gets" (columns fill); reading surfaces (settings, legal, analytics text) cap at ~720px.

## 9.3 Navigation strategy

| Surface | Pattern | Why |
|---|---|---|
| Web — core | Board is `/`. Detail = drawer (URL-addressable `?thread=<id>` for shareable/back-button support). | Highest-frequency action shouldn't unmount the board |
| Web — secondary | Left rail routes: `/analytics`, `/reminders`, `/settings`, `/team`. Lazy-loaded (Pro/Teams bundles split). | Keeps free bundle lean; gates align to route boundaries |
| Web — account switcher | Top-bar dropdown listing connected mailboxes + "All" (merged board). Reflects multi-mailbox merge (Pro). | Multi-account merge already exists in desktop `main.js` |
| Desktop | Same shell, no router needed — it's the frozen-ish board; reuses the web component app if/when it adopts it, otherwise stays as `index.html`. | Brief freezes local build |
| Mobile | Bottom tab bar (see 9.4) | Thumb-reachable, native convention |

Back-button and deep-linking matter: `?thread=` and `/analytics` must be real URLs so browser history, "open in new tab," and share work. The current `index.html` has **zero** URL state — everything is localStorage; that's a regression to fix on the hosted side.

## 9.4 Dashboard structure (the board)

The board is four columns matching `detectStatus`'s four statuses, in funnel order:

| Column | Color (existing) | Notes |
|---|---|---|
| Applied | gray | Default landing for matched threads with no stronger signal |
| Interview | yellow | |
| Offer | green | Visually celebrated but *calmly* (no animation spam) |
| Rejected | red | Collapsible/de-emphasized — users want it out of the way but not deleted |

**Card anatomy** (one application = one card):

- Company name (resolved via `resolveCompany`, ATS-domain aware), bold, primary line.
- Role (via `extractRole`), secondary line, truncated.
- Last-activity date (most recent `messages[].date`).
- Status provenance chip: `auto` / `manual` / `AI` (Pro), so users know whether to trust or correct it.
- Avatar: lettered fallback by default; favicon only when `SHOW_LOGOS` is explicitly enabled (off by default, `referrerpolicy=no-referrer`). Keep this default — it's a privacy signal, not a missing feature.
- Pin indicator, ignore is a hidden state (filtered out, restorable from a "Hidden" filter).

**Card affordances:** click → detail drawer; drag → manual status override (writes the override map, marks provenance `manual`); right-click/`⋯` menu → pin, ignore, correct status, add note (Pro). Drag-to-reorder within a column persists to `manualPositions`/`cardOrder` (existing keys), but on hosted these become server-persisted, not localStorage.

**Detail drawer** shows: full status history with dates (the derived status-history we persist), the ≤600-char snippet per message (never raw body — and say so: "Snippet only — Pipeline never stores the full email"), resolved company/role with an "edit" affordance, and Pro blocks (reminders, notes, interview-prep CTA).

**Controls (top bar):** search (client-side filter over company/role/subject), timeframe (the `pipeline.timeframe` concept — last 30/90/365 days), sort (`pipeline.sort`), and a manual **sync** button with last-synced timestamp. On hosted, sync is push-driven (#10), so the button becomes "Refresh view" + a passive "synced 2m ago" — not a quota-burning full re-read.

## 9.5 Mobile navigation structure

Companion-only (#2). Bottom tab bar, three tabs max:

| Tab | Content | Notes |
|---|---|---|
| **Board** | Read-mostly column view of server-derived records; swipe between status columns (columns don't fit side-by-side on phone). | No on-device scan — pulls from hosted API |
| **Activity** | Chronological feed: new offers/interviews/rejections since last open. The "glance" surface. | Drives push notifications (reminders, status changes) |
| **Account** | Connected mailboxes (read-only status), link to web for billing/connect/delete. | First-run OAuth, billing, deletion live on web (#2) |

Mobile **cannot** connect a mailbox, change billing, or delete the account — those deep, consequential, restricted-scope flows live on web. Mobile can: view, correct a status (writes back via API), pin, snooze a reminder. Keep it glance-and-act.

## 9.6 Empty / loading / error states

These are where "hobby project" leaks. Specify all three explicitly.

**Empty states (distinct, not one generic blank):**

| Condition | State |
|---|---|
| No mailbox connected yet | Hero + single "Connect a mailbox" CTA + "or explore demo data" (MockProvider). Explain the read-only/derived-records promise *here*, before the OAuth grant. |
| Connected, first sync running | Skeleton columns + "Scanning your mailbox once — this is the only full read" copy (truthful: backfill is first-connect only, #10). |
| Connected, sync done, genuinely zero applications | "No job-related mail found in the last 365 days" + adjust-timeframe hint + manual-add CTA. NOT the same as "not connected." |
| A column empty but others have cards | Quiet inline placeholder in the column, no full-screen takeover. |
| Filter/search returns nothing | "No matches for '<q>'" with a clear-filter button. |

**Loading states:**

- **Skeletons, not spinners**, for the board (column-shaped placeholders). Spinners only for discrete actions (connecting, exporting).
- **Optimistic UI** for manual override/pin/ignore — apply instantly, reconcile on server ack, roll back visibly on failure.
- First-connect backfill can be long (#12) — show **progress with a real signal** (e.g., "320 messages processed") streamed from the worker, not an indeterminate bar that lies.

**Error states (typed, actionable, never a raw stack):**

| Error class | UX |
|---|---|
| OAuth grant declined / restricted-scope not yet verified (test-user allowlist, ≤100) | Explicit: "This account isn't on the early-access list yet" — not a generic failure. Maps to the real Google verification state (#16). |
| Token refresh failed / mailbox revoked | Per-account banner: "Reconnect <account>" — board still shows last-derived records (we persisted them; we don't lose the board because a token died). |
| Sync subscription expired (Graph/Pub-Sub) | Silent self-heal (worker renews, #10); only surface if backfill needed. |
| API/network down | Non-blocking toast + "showing last loaded data"; never a white screen. |
| LLM second-pass unavailable (Pro) | Degrade gracefully to keyword result with a quiet "AI classification unavailable" note. Never block the board on the optional pass. |

## 9.7 Confirmation, destructive, and review flows

**Confirmation philosophy:** Reversible actions get **no** modal (override, pin, ignore, reorder) — just an undo toast. Irreversible/consequential actions get a real confirm. Modal fatigue is a real product failure; don't confirm what you can undo.

**Destructive flows — disconnect and delete (the privacy-critical ones):**

| Action | Flow | Backing |
|---|---|---|
| **Disconnect mailbox** | Modal: states exactly what happens — "We revoke our token and stop syncing. Derived records for this mailbox are deleted. Your email is untouched." Single typed/explicit confirm. | `POST /api/disconnect` exists; hosted must also revoke token + purge that account's derived rows |
| **Delete account (GDPR/CCPA)** | Two-step: (1) **Export first** offer (CSV/JSON of derived records — your data, leave with it), then (2) hard confirm requiring typing the email or "DELETE". Wipes users, accounts, encrypted tokens, derived records, history. Irreversible, and say so. | GDPR/CCPA delete is a hard constraint; tokens are envelope-encrypted (#9), deletion must drop the row + data key |
| **Revoke at provider** | Both flows must actually call Google/Microsoft token revocation, not just forget locally. Surface "also revoked at Google" so the user sees the loop closed. | Privacy posture; CASA review will look for this |

**Review / approval flows (status correction — the trust loop):**

The classifier is brittle by design. The correction flow *is* the product's trust mechanism, so it must be excellent:

- **Inline correct:** card `⋯` → "Change status" → pick one of four → instant, optimistic, provenance flips to `manual`. Drag-between-columns does the same.
- **Confidence surfacing (Pro LLM):** low-confidence threads (the ones the LLM escalates, #14) get a subtle "Review?" marker. A lightweight **review queue** ("3 threads need a look") lets users batch-confirm/correct. This is opt-in attention, not a nag.
- **Company/role edit:** `resolveCompany`/`extractRole` get it wrong on edge cases (multilingual, weird ATS display names). Both are user-editable in the drawer; the edit persists as an override and is respected over future auto-resolution for that thread/domain.
- **Never silently overwrite a manual decision.** Once a user sets status/company manually, sync must not clobber it — provenance gates this. (The current model already keeps prior status when `detectStatus` returns `null`; extend that to "manual always wins.")

## 9.8 Accessibility (WCAG 2.1 AA, dark theme)

Dark theme makes contrast *harder*, not easier — this is where the current app most likely fails and where a "serious product" is judged.

| Area | Requirement |
|---|---|
| **Contrast** | All text ≥ 4.5:1 (normal), ≥ 3:1 (large/UI components & graphics) against the dark surface. **Audit every status color** (gray/yellow/green/red) against the dark background — yellow and green on dark commonly fail. Use accessible token variants for text/borders distinct from the fill chroma. |
| **Color is never the only channel** | Status is column + text label + icon + color, four-way redundant. Critical for red/green (deuteranopia). |
| **Keyboard** | Full operability: Tab to cards, Enter opens drawer, arrow keys move between columns/cards, a documented shortcut to change status, Esc closes drawer/modal. Drag-to-override must have a keyboard equivalent (move-to-column via menu). Visible focus ring on the dark theme (≥3:1). |
| **Focus management** | Drawer/modal open traps focus and restores it to the triggering card on close. |
| **Screen readers** | Board is a labeled landmark; columns are labeled regions with live counts; cards announce "Company, role, status, last activity." Status changes announce via `aria-live="polite"`. |
| **Motion** | Honor `prefers-reduced-motion` — disable drawer slide / drag animations. |
| **Target size** | Interactive targets ≥ 24×24px (44px on mobile). |
| **Text scaling** | Layout survives 200% zoom and OS font scaling without clipping cards. |

## 9.9 Responsive behavior

| Breakpoint | Behavior |
|---|---|
| Wide (≥1200px) | All four columns visible side-by-side; detail drawer overlays right ~420px. |
| Medium (768–1199px) | Four columns with horizontal scroll OR a 2×2 wrap; drawer becomes full-height overlay. |
| Narrow / mobile web | Single column with status switcher (swipe/segmented control); detail becomes a full-screen sheet. Matches the native app's swipe-between-columns model. |
| Native (Expo) | Not responsive web — separate `ui-native` primitives, shared tokens/logic only (#4). |

## 9.10 Component system, tokens, type, spacing, hierarchy

**Component system (`packages/ui-web`):** Headless-primitive base (Radix UI or React Aria) + custom styling — gets accessible focus/keyboard/ARIA *for free*, which is most of 9.8. Tailwind for styling driven by the token layer below. Native (`ui-native`) reimplements the same components on RN primitives; only **tokens + logic are shared**, never DOM/RN rendering (#4).

Core components: `Board`, `Column`, `ApplicationCard`, `StatusChip`, `ProvenanceBadge`, `DetailDrawer`, `Avatar` (lettered fallback / favicon), `Toolbar`, `AccountSwitcher`, `ConfirmDialog`, `EmptyState`, `Skeleton`, `Toast`, `ReviewQueueItem`.

**Design tokens** (single source, exported to web Tailwind config *and* native theme — the only legitimate web↔native sharing):

```
color.bg.{0,1,2}          // layered dark surfaces (elevation by lightness, not shadow)
color.text.{primary,secondary,muted}
color.status.{applied,interview,offer,rejected}.{fill,text,border}  // AA-audited per pair
color.accent / .focus / .danger
space.{1..8}              // 4px base scale: 4,8,12,16,24,32,48,64
radius.{sm,md,lg}
font.size.{xs..2xl} / font.weight.{regular,medium,semibold}
shadow.{1,2}              // sparingly; dark UIs lean on surface lightness for depth
duration.{fast,base} / easing.standard
```

The current app has **no tokens** — colors and spacing are inline/ad hoc. Tokenizing is the single highest-leverage change for "feels designed."

**Typography:** One UI typeface (system stack or Inter) for density and zero web-font cost. Tight, deliberate scale (~6 sizes). Tabular numerals for dates/counts/analytics so columns align. Company name is the type anchor (semibold, primary); role/date step down in weight and color, not just size.

**Spacing:** 4px base grid. Consistent card padding, consistent column gutters. The current monolith's spacing is hand-placed and inconsistent — a grid alone reads as "professional."

**Visual hierarchy:** Elevation via **surface lightness**, not heavy shadows (dark-UI idiom). One accent color, used sparingly (primary CTA, focus). Status chroma is reserved for status — don't spend green/red elsewhere or you dilute the signal that carries the whole board.

**Microinteractions (restrained):** card drag lift, drawer slide (≤200ms, reduced-motion aware), optimistic state flips with a settle, undo toasts with countdown, sync "synced just now" pulse, skeleton shimmer. No confetti, no bounce, no celebratory spam — this is a stress tool, calm wins.

## 9.11 What the current app must improve to feel like a serious product

Grounded in the verified state of `index.html` (76 KB, 1,394 lines, vanilla JS, dark, no framework). These are the concrete gaps. (Note: most are fixed by the hosted rebuild per #3; a few are cheap retrofits worth doing in the frozen local build too.)

| # | Current state | Required improvement | Where |
|---|---|---|---|
| 1 | **No design tokens** — colors/spacing inline & ad hoc | Extract a token layer; AA-audit every status color on dark; 4px spacing grid | Rebuild (cheap retrofit possible in local) |
| 2 | **No component system** — one HTML file, hand-rolled DOM | Headless-primitive component library (`ui-web`) for free a11y/keyboard/ARIA | Rebuild |
| 3 | **Contrast unverified on dark** — yellow/green status likely fail AA | Token variants per status with audited text/fill/border contrast | Rebuild + retrofit |
| 4 | **No keyboard/focus model** — mouse-only board | Full keyboard nav, focus rings, focus trapping in drawer/modal, SR landmarks | Rebuild |
| 5 | **No URL/deep-link state** — everything localStorage | Route the board + `?thread=`; real browser history/share | Hosted only |
| 6 | **Generic/absent empty & loading states** | Distinct empty states (not-connected vs zero-results vs filtered); skeletons not spinners | Rebuild + retrofit |
| 7 | **No typed error UX** — failures likely silent or raw | Typed, actionable errors (test-user allowlist, reconnect, degrade) | Rebuild |
| 8 | **Destructive actions under-specified** — `disconnect` is a bare POST | Real confirm flows; export-before-delete; provider-side token revocation; "what we delete" copy | Rebuild + harden local |
| 9 | **No provenance on status** — can't tell auto vs manual | Provenance chip (`auto`/`manual`/`AI`); manual-always-wins on sync | Rebuild + retrofit |
| 10 | **Privacy claimed, not shown** — derived-records promise invisible in UI | Per-thread "snippet only, raw never stored" affordance; visible disconnect/delete | Rebuild + retrofit |
| 11 | **Sync = quota-burning full re-read**, no UI signal | "Synced 2m ago," first-connect-only backfill copy, push-driven refresh (#10) | Hosted (needs backend) |
| 12 | **No reduced-motion / scaling / target-size discipline** | Honor `prefers-reduced-motion`; survive 200% zoom; ≥24/44px targets | Rebuild + retrofit |
| 13 | **No mobile model** | Companion app: bottom tabs, swipe columns, glance Activity feed (#2) | New (Expo) |
| 14 | **No review/correction loop as a feature** | Inline correct + Pro review queue + confidence surfacing — the trust mechanism | Rebuild (Pro for LLM bits) |

The throughline: the current app is a *competent prototype* — small, fast, privacy-instinctive — but it shows none of its own quality. It doesn't show provenance, doesn't show what it stores, doesn't survive a keyboard or a contrast audit, and lies to no one only because it says nothing. Making it feel serious is less about visual polish and more about **making its existing good instincts legible**: surface the privacy posture, surface classification provenance, and pass the accessibility bar that a dark theme makes unforgiving.

---

# 10. Security and Privacy Plan

Privacy is the brand, so security is not a hardening pass bolted on before launch — it is the product's load-bearing wall. This section specifies the concrete controls for the **hosted** surface (the new `apps/api` on Fastify + Neon + Upstash + Clerk per the Canonical Brief), the residual posture of the **frozen local** build (`server.py` + `index.html`), and the **mobile companion**. It ends with the two things that actually gate a public launch: token-at-rest replacement and provider verification.

The blunt framing: today's codebase is correctly secured **for what it is** — a `127.0.0.1`-bound single-user local tool. Every "good instinct" in the ground truth (allowlist static serving, `chmod 0600`, git-ignored token file, `SHOW_LOGOS=false`, `referrerpolicy=no-referrer`) is a local-single-user control that does **not** survive the move to a multi-tenant hosted service. None of it constitutes hosted security. We are not patching `server.py`; we are building a new trust boundary.

## 10.1 Authentication and sessions

| Concern | Decision |
|---|---|
| Identity provider | Clerk (managed), per Brief #8. No homegrown auth. |
| Password handling | **None we own.** Passwordless / social + email OTP via Clerk. We never store, hash, or transmit a user password. This removes the entire credential-database attack surface (no bcrypt/argon2 to misconfigure, no password-reset flow to leak, no credential-stuffing target). |
| Session token | Clerk-issued, delivered as an **httpOnly, `Secure`, `SameSite=Lax`** cookie. Never readable by JS, so XSS cannot exfiltrate the session. Short-lived access token (~minutes) + rotating refresh handled by Clerk. |
| Session → API | `apps/api` (Fastify) verifies the Clerk JWT on every request against Clerk's JWKS (cached, rotated). No session state in our process — which also kills the in-memory `_pending = {}` problem in `server.py` that breaks under multiple workers. |
| MFA / recovery | Delegated to Clerk (TOTP, account recovery, device management). A solo founder must not build these. |
| CSRF | `SameSite=Lax` cookie + required custom header (`Authorization: Bearer` from Clerk's frontend SDK, or an anti-CSRF token on cookie-auth mutations). State-changing routes are POST/DELETE only; no mutation on GET. |

**Critical decoupling (Brief #8):** the Clerk session is **identity only**. It carries *who the user is*, never a mail grant. This is the single most important architectural choice in this section: because sign-in is divorced from the `gmail.readonly` grant, our login flow is **never blocked by Google's restricted-scope verification status**. Users can sign up, pay, browse demo data, and manage their account while the app is still under the test-user allowlist. Mail connection is a separate, later, incremental consent (10.4).

## 10.2 OAuth specifics (mail grant)

The mail OAuth flow is reused from the verified `providers.py` logic but re-homed in TS on the server. Real, current facts that constrain it:

- **Google**: `Authorization Code + PKCE`, "Web application" client → **client secret required**, scope `https://www.googleapis.com/auth/gmail.readonly` (RESTRICTED), `access_type=offline` + `prompt=consent` to obtain a refresh token. Requested **only** when the user clicks "Connect Gmail" — incremental consent, separate screen from sign-in.
- **Microsoft**: public client (PKCE, no secret), `consumers` tenant, scopes `https://graph.microsoft.com/Mail.Read` + `offline_access`. Note from ground truth: Microsoft **killed basic-auth/app-password IMAP for personal Outlook.com accounts in 2024**, so OAuth is mandatory there — there is no IMAP fallback to lean on for Outlook.com.
- **OAuth state**: the in-memory `_pending` dict in `server.py` does not survive a hosted multi-process deploy. Replace with a **signed, short-TTL state value stored in Upstash Redis** (or a signed stateless `state` param), keyed to the user's session, single-use, expiring in minutes. This also closes the CSRF-on-callback hole.
- **Token rotation**: keep the `valid_access_token()` / `on_refresh` pattern (refresh-and-persist), but the persistence target is the envelope-encrypted store (10.6), and the rotated refresh token re-encrypts in place.
- **Redirect URI**: hosted uses a fixed HTTPS callback on the verified domain; the desktop loopback-random-port flow stays in the frozen Electron build only.

## 10.3 RBAC and per-user data isolation

The current model is single-user — there is **no** authorization layer because there is exactly one user. Hosted multi-tenancy makes data isolation the highest-severity risk class (one cross-tenant leak of derived application records is a brand-ending privacy incident).

**Roles** are deliberately minimal:

| Role | Scope |
|---|---|
| `user` | Owns their own accounts + derived records only. The default. |
| `org_admin` (Teams) | Seat/license admin for their org; **cannot read member inbox-derived content** — only opt-in aggregate cohort stats (Brief Teams tier). This boundary is enforced in the API, not the UI. |
| `support` (internal) | See 10.10 — no default access to user data. |

**Per-user row-level isolation — defense in depth, two layers:**

1. **Application layer (primary):** every query in `apps/api` is scoped by `user_id` (or `org_id` for Teams aggregates) taken from the verified Clerk JWT — never from a client-supplied id. No endpoint accepts a `userId` parameter that overrides the session subject. This is the load-bearing control.
2. **Database layer (backstop):** Postgres **Row-Level Security** on every tenant table (`accounts`, `application_records`, `oauth_tokens`, `sync_cursors`). The API connects as a role that sets a per-request `app.current_user_id` GUC; RLS policies (`USING user_id = current_setting('app.current_user_id')::uuid`) make a missing application-layer `WHERE` fail closed instead of leaking. Neon supports this. The cost is one `SET LOCAL` per transaction — cheap insurance against the one bug that ends the company.

Teams cohort dashboards are computed from **pre-aggregated, derived-only** rollups (counts, funnel %, time-in-stage averages) with a minimum cohort size (e.g. ≥5) to prevent re-identification. Raw or per-individual inbox-derived content is never exposed to `org_admin`, ever.

## 10.4 Data minimization — persist derived, not raw

This is the literal expression of the privacy brand (Brief #11) and the strongest CASA/GDPR posture, so it is a security control, not just a data-model choice.

- **Durable storage holds only**: `company`, `role`, `status`, status-history dates, and the **≤600-char snippet** (`BODY_CHARS=600`). No raw email bodies, no full headers, no attachments.
- **Raw text exists only in-flight**, in two narrow windows: (a) during the sync→classify pass before reduction to a record, and (b) during an optional Pro LLM second pass (10.8). It is held in process memory / a transient job payload and **never written to durable storage**, never logged, never cached to Redis beyond the job's lifetime.
- Consequence for incident response: a full database compromise leaks derived job-status records and snippets — bad, but **not the user's mailbox**. The blast radius is bounded by design. This is exactly the story Google CASA and a GDPR DPA want to hear, and it is true rather than aspirational.

## 10.5 Encryption in transit and file security

- **In transit:** HTTPS/TLS everywhere on the hosted surface — Vercel (web), Fly.io (API/workers), Neon, Upstash all terminate TLS; no plaintext hop. HSTS on the web origin. The local build stays `127.0.0.1`-only HTTP (acceptable; never exposed).
- **File serving:** the hosted web app is a static React/Vite bundle on Vercel — there is **no generic file server** in `apps/api` at all. We keep the *spirit* of `server.py`'s allowlist (which deliberately refused to serve `config.json` / `.pipeline-accounts.json` / `.git`) by simply not having a file-serving endpoint: the API returns JSON DTOs only. Any user-facing export (CSV/PDF, 10.9) is generated to a signed, short-TTL URL scoped to the requesting user, never a path-addressable static file.
- **Headers:** strict CSP (no inline-eval; the React app has a known asset origin), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (carrying forward the existing favicon privacy instinct), `Permissions-Policy` locking down unused APIs.

## 10.6 Encryption at rest — token-at-rest replacement (concrete)

This is the must-fix. Three current token stores, ranked by hosted-acceptability:

| Store | Today | Hosted verdict |
|---|---|---|
| `.pipeline-accounts.json` (`server.py`) | `chmod 0600`, git-ignored, **NOT encrypted** | **Unacceptable hosted.** Fine for local-single-user only. |
| Electron `safeStorage` (OS keychain) | Encrypted via OS keychain | Fine — but **desktop-local, out of hosted scope**. |
| Electron **base64 fallback** | base64 is **not encryption** (correctly `console.warn`-ed) | **Never** ships hosted; local-only stopgap. |

**Hosted replacement — envelope encryption (Brief #9), concretely:**

```
master key (in cloud KMS, never leaves KMS)
        │  wraps / unwraps
        ▼
per-row data key (DEK)         ← unique per oauth_tokens row
        │  libsodium crypto_secretbox (XSalsa20-Poly1305)
        ▼
ciphertext( refresh_token, access_token )  stored in Postgres
```

Mechanics:

1. On mailbox connect, generate a random **per-row DEK**. Encrypt the OAuth tokens with libsodium `crypto_secretbox` (authenticated; nonce stored alongside ciphertext).
2. Wrap the DEK with the **master key held in a managed KMS** (cloud KMS / secrets manager — the master key never leaves KMS, the app only calls `Encrypt`/`Decrypt` on the DEK).
3. The Postgres `oauth_tokens` row stores: `wrapped_dek`, `nonce`, `ciphertext`, `key_version`. **No plaintext token, ever. No base64-as-encryption, ever.**
4. **Decrypt is just-in-time**: tokens are unwrapped only at sync/refresh time, used in memory, never logged, never returned over the API.
5. **Rotation** is cheap: rotating the master key re-wraps DEKs (KMS `ReEncrypt`), not the whole token corpus — `key_version` tracks which master wrapped each row. This is the operational reason for envelope encryption over a single app-wide key.

Why this and not "just encrypt the column with one key": a single static app key in an env var has no rotation story and a total-blast-radius failure mode. Envelope encryption bounds the blast radius (steal the DB → useless without KMS) and makes rotation a routine operation rather than a migration.

## 10.7 API security, rate limiting, secrets

- **API surface:** Fastify, JSON-only, schema-validated. Every DTO validated against the **`@pipeline/contracts` zod schemas** at the boundary — inbound and outbound — so malformed or oversized payloads are rejected before they touch business logic, and we never accidentally serialize an internal field outward.
- **Authz on every route:** session-derived `user_id`; no IDOR-able identifiers (10.3). Object references are opaque ids checked for ownership.
- **Rate limiting (Upstash Redis token buckets, Brief #7):** tiered — per-IP on auth/OAuth-start endpoints (anti-abuse), per-user on sync-trigger and LLM-classify endpoints (cost control — the LLM second pass has real marginal cost, 10.8). Sync is push-driven (10 / Brief #10), so user-initiated full re-reads are not a quota foot-gun the way the current full-rescan-every-time path is.
- **Secrets management:** no secrets in code or repo. Google client secret, Microsoft app config, Clerk keys, KMS access, Neon/Upstash/Anthropic keys all live in the platform secret stores (Fly.io secrets, Vercel env, GitHub Actions encrypted secrets) injected at runtime. **GitHub secret scanning + push protection enabled** on the repo. This directly ties to 10.12 — the `business/` leak proves secrets/strategy hygiene is currently not enforced.

## 10.8 LLM second pass (Pro) — data handling

Per Brief #14, the LLM escalation is the one place raw-ish text leaves our trust boundary, so it gets explicit controls:

- **Server-side only**, key in KMS/secrets — never on web or mobile.
- Runs **only on low-confidence threads** from `@pipeline/classify`, capping volume and cost; default model is a small/fast **Claude (Haiku-class)** for cost-per-classification.
- Only text the user **consented to processing** is sent; the in-flight raw body sent to the model is **never persisted** and never logged. Anthropic API calls run over TLS; we retain only the returned `{status, company, role}` derived fields.
- Zero-data-retention posture on the LLM vendor side should be confirmed and documented for the CASA assessor.

## 10.9 GDPR / CCPA — deletion, export, logging

- **Right to delete:** a single "Disconnect & delete" action that (a) revokes the OAuth grant at Google/Microsoft, (b) deletes the `oauth_tokens` row (and its DEK), (c) deletes derived `application_records`, (d) tombstones the user in Clerk. Cascade-on-delete in Postgres so no orphaned rows survive. This extends the existing `POST /api/disconnect` intent to a true erasure.
- **Right to export:** user-scoped export of their derived records (CSV/JSON) via a signed short-TTL URL (10.5). Because we store derived-only, the export is inherently minimal — there is no raw mailbox to hand back.
- **Logging without leaking (non-negotiable):** structured logs **never contain** OAuth tokens, email bodies/snippets, subjects, sender addresses, or full names. Log identifiers (`user_id`, `account_id`, opaque `thread_id` hashes), event types, status codes, timings. A redaction layer + a CI check (regex denylist on log call sites for token/body/`from`/subject patterns) prevents drift. PII goes in the database under RLS, never in logs, never in error trackers (scrub Sentry/equivalent payloads).
- **DPA / sub-processors:** maintain a sub-processor list (Clerk, Neon, Upstash, Fly.io, Vercel, Anthropic, MoR) and DPAs with each — required for B2B Teams deals and for the privacy policy to be truthful.

## 10.10 Admin and internal access

- **No standing access to user data.** `support` role has zero default read on derived records or tokens. Any access is **break-glass**: explicit, time-boxed, audit-logged, and ideally user-consented for a support session. Tokens are never human-readable even to an admin (decrypt path is service-only, JIT, in-memory).
- Admin actions (seat changes, refunds, deletions) are audit-logged with actor + target + timestamp.

## 10.11 Mobile security (companion-only)

The companion design (Brief #2) is itself the strongest mobile security control: **the phone never scans a mailbox and never holds a mail OAuth token.** It reads server-derived records over the hosted API.

- **No mail token on device** — ever. Only a **session credential** lives on the phone.
- **Secure storage:** session token in **iOS Keychain / Android Keystore** (Expo SecureStore), not `AsyncStorage`/plaintext.
- **First-run OAuth, billing, deletion, analytics deep-dives** happen on **web** (Brief #2), keeping the restricted-scope grant and the riskiest flows off the mobile attack surface and out of per-platform verification scope.
- **Certificate pinning:** consider pinning the API origin in the mobile client to blunt MITM on hostile networks. Caveat honestly — pinning complicates cert rotation and can brick clients if mishandled; if adopted, pin to a CA/intermediate with a backup pin and a remote-config kill switch. Given the phone holds only a session (not a mail token), pinning is a *defense-in-depth* nice-to-have, not a launch blocker.

## 10.12 Leak remediation — a release gate (correcting the brief)

Per Brief #15, and stated plainly because it is a live incident: `business/OPEN-CORE-SPLIT.md` is headed *"Internal planning doc. Local only — do NOT commit to the public repo,"* and it **is committed and git-tracked in the public MIT repo.** Monetization strategy, pricing, and moat reasoning are public right now. This is a security/operational failure that must be closed **before** any further public work:

1. **Purge** `business/` strategy docs from the public repo, including a **git history scrub** (BFG / `git filter-repo`) — deleting the file in a new commit does not remove it from history.
2. **Move the ~14 MB of marketing media** (`pipeline-demo.mp4` 8 MB, `explainer.html` 2.5 MB, `pipeline-demo.gif` 1.4 MB, screenshots, `vo.mp3`) out of the MIT app repo to a separate asset/marketing repo or CDN. (Note the corrected fact: the bloat is `business/`, **not** `index.html` — `index.html` is ~76 KB.)
3. **Enable GitHub secret scanning + push protection** so the next "local only" doc or key cannot be pushed silently.
4. The public funnel repo ships **code + MIT license + draft legal docs only.**

## 10.13 Provider verification — the hard launch gate

This is the gate. Until it is cleared, the hosted app is **legally and technically capped at ≤100 test users** via Google's test-user allowlist (unverified app). The Clerk decoupling (10.1) lets us build, charge, and run a closed beta under that cap — but **no public multi-user launch ships ahead of this.**

### Google — restricted-scope verification + CASA

`gmail.readonly` is a **Google RESTRICTED scope** (not merely "sensitive"). That triggers the heaviest tier of OAuth review.

**A. OAuth app verification (required for any verified public app):**

| Requirement | Specifics |
|---|---|
| Verified domain ownership | Production domain verified in Google Search Console; OAuth consent screen branded to it. |
| Privacy policy at a verified domain | `PRIVACY.md` content **published as a real page** on that domain. Today it is a **draft with placeholder contact info** — that must be finalized with counsel and given a real contact (ties to legal sequencing). |
| Branding | App name, logo, support email, authorized domains, homepage — all consistent and on-domain. |
| Scopes justification | Written justification for **why** `gmail.readonly` is needed and that the use is **minimal** — our derived-only / no-raw-storage design (10.4) is the core of this argument. |
| **Demo video** | A YouTube video showing the full OAuth grant flow and how the restricted data is used — Google requires this for restricted scopes. |
| Limited Use compliance | Affirm adherence to Google API Services User Data Policy **Limited Use** requirements (no selling data, no ads, no human reading except narrow exceptions). |

**B. CASA (Cloud Application Security Assessment), the annual one:**

| Aspect | Reality |
|---|---|
| What | A **security assessment Google requires for restricted-scope apps**, verifying the app meets OWASP ASVS-based controls. Restricted scope generally lands at **Tier 2** (the deeper tier, beyond a self-scan). |
| Who runs it | A **Google-authorized third-party assessor** (e.g. an approved lab); not Google itself, not a self-certification at Tier 2. |
| Rough cost | Commonly **~$1k–$15k+** depending on assessor and scope — a real, recurring line item for a solo founder; budget for it. |
| Rough time | **Weeks to a few months** end-to-end (remediation included). It is **annual** — recurring, not one-and-done. |
| What it inspects | Token storage (our **envelope encryption**, 10.6, is the headline answer), data minimization (derived-only, 10.4), encryption in transit, deletion/export (10.9), logging hygiene (10.9), access control (10.3). |

The architecture in this section is deliberately built to pass CASA on the merits: envelope-encrypted tokens, no raw-mail at rest, RLS isolation, redacted logging, real deletion. We are not retrofitting for the assessor; the assessor is checking what the design already does.

### Microsoft — publisher verification

| Requirement | Specifics |
|---|---|
| Publisher verification | Complete **Microsoft publisher verification** (verified Partner/MPN account associated with the Entra app registration). |
| Effect | Removes the "unverified app" warning on the consent screen and is required to raise consent/usage limits for `Mail.Read` on `consumers` (personal Outlook.com) accounts. |
| Relative burden | Lighter than Google's restricted-scope + CASA path, but still a **hard prerequisite** for a trustworthy public Outlook.com connect flow — and the only path, since Microsoft removed IMAP basic-auth for personal accounts in 2024. |

### Launch sequencing (security view)

```
NOW (cap ≤100 test users, allowlist) ──> closed beta on hosted, Clerk login live,
   mail connect under test-user allowlist
        │
        ├─ finalize PRIVACY.md / TERMS.md with counsel, real contact, on verified domain
        ├─ purge business/ leak + history scrub (10.12)
        ├─ ship envelope encryption + RLS + redacted logging (10.6 / 10.3 / 10.9)
        │
        ├─ Google OAuth app verification (branding, scope justification, demo video)
        ├─ Google CASA Tier 2 (authorized assessor; weeks–months; recurring annual)
        ├─ Microsoft publisher verification
        ▼
PUBLIC MULTI-USER GA
```

No box in the bottom row ships before the boxes above it are green. The security architecture (10.1–10.11) is the prerequisite work that makes the verification gate (10.13) passable rather than a wall.

---

# 11. Development Roadmap

This roadmap is sequenced for **one person using AI coding tools**, not a team. The durations assume the founder is the only engineer, product owner, and ops person, working with AI assistance that accelerates code generation but does *not* accelerate the things that actually gate this product: Google's verification queue, CASA assessor turnaround, legal review of `PRIVACY.md`/`TERMS.md`, and your own learning curve on Fastify/Neon/Graph delta subscriptions. The single most important non-engineering fact: **Google restricted-scope verification + CASA Tier 2 has a multi-month external lead time and you do not control it**, so it starts in Phase 0 and runs in the background across every other phase. Everything else is paced around that clock.

A note on the parallelism: phases are listed in dependency order, but the long-lead compliance and legal items (Phase 0 / Phase 5 work) run *concurrently* with engineering. You are not idle while Google reviews you — you build. The phase numbers are about engineering dependency, not calendar exclusivity.

| Phase | Theme | Rough duration (solo + AI) | Hard gate it clears |
|---|---|---|---|
| 0 | Discovery & Audit | 1–2 weeks | Leak scrubbed, secrets rotated, verification *started* |
| 1 | Architecture Foundation | 2–4 weeks | Monorepo + classifier extracted + parity gate green |
| 2 | Web MVP | 6–10 weeks | One mailbox → live board, hosted, ≤100 test users |
| 3 | Backend Hardening | 4–7 weeks | Incremental sync + envelope encryption + derived-only storage |
| 4 | Mobile MVP | 3–5 weeks | Read-only companion shipped to TestFlight/Play internal |
| 5 | Polish, QA & Launch | 4–8 weeks (gated by Google) | Verification + CASA *passed*, legal final, public GA |
| 6 | Post-launch | Continuous | Pro/Teams revenue features, retention |

Total realistic wall-clock to public multi-user GA: **~6–9 months**, and the back half is dominated by waiting on Google, not coding.

---

## Phase 0 — Discovery and Audit

**Duration: 1–2 weeks.** Do not skip this and do not let it sprawl. It exists to stop active bleeding and start the long clocks.

**Goal:** Stop the live data leak, rotate anything that may be compromised, and fire the starting gun on the external compliance processes you can't speed up later.

**Tasks:**
- **Scrub the committed leak.** `business/OPEN-CORE-SPLIT.md` is headed *"Internal planning doc. Local only — do NOT commit to the public repo"* and is git-tracked and public. Purge it — and the rest of `business/` strategy docs — from the public repo **including git history** (`git filter-repo`, not just `git rm`; a plain delete leaves it in every clone and the GitHub commit view). Force-push the rewritten history. Assume the monetization strategy, pricing, and moat reasoning are already public and act accordingly (it may be in someone's clone or the GitHub cache).
- **Move the ~14 MB of marketing media out of the MIT app repo.** `pipeline-demo.mp4` (8 MB), `explainer.html` (2.5 MB — this is the *real* 2.5 MB file; the app's `index.html` is 76 KB, correcting the common misconception that the UI is bloated), `pipeline-demo.gif` (1.4 MB), screenshots (1.1 MB), `vo.mp3`. These belong in a separate marketing/asset repo or a CDN, not bloating every clone of the funnel repo.
- **Rotate every secret that could plausibly have touched the repo.** Even though `config.json`/`.pipeline-accounts.json` are git-ignored and `server.py` serves a deliberate allowlist (good instinct), audit the full history for any leaked Google client secret (Google is a *Web application* client and *requires* a client secret), Microsoft app IDs, or test tokens. Regenerate the Google client secret in Cloud Console regardless — it's free and removes all doubt.
- **Start Google OAuth verification and the CASA process NOW.** `gmail.readonly` is a Google *restricted* scope; public multi-user launch requires app verification and a likely annual CASA Tier 2 assessment by a Google-approved third-party assessor. This has a **long, founder-uncontrollable lead time**. Submit the verification request, line up a CASA assessor, and get on their schedule in week one. You cannot do this "near launch" — it *is* the launch gate.
- **Engage legal early.** `PRIVACY.md`/`TERMS.md` exist but are explicitly drafts ("review with legal counsel before publishing") with placeholder contact info. Find counsel now; legal turnaround is also not something AI tooling fixes.
- **Inventory ground truth.** Confirm the ~3,600-line reality: `index.html` (1,394), `server.py` (566), `providers.py` (343), `classify.js` (236), `main.js` (203), the provider files, and the existing test corpora (`classify.test.js`, `mappers.test.js`, `providers_test.py`). This inventory becomes the extraction map for Phase 1.

**Deliverables:** Clean public repo (history scrubbed, media externalized); rotated Google client secret; submitted Google verification request and booked CASA assessor; engaged legal contact; a written extraction inventory.

**Risks:**
- History rewrite breaks open forks/clones (acceptable — coordinate if any external contributors exist; there likely aren't).
- The leak is *already* harvested. You cannot un-leak; the mitigation is rotating secrets and accepting the strategy is semi-public.
- Google/CASA scheduling slips. This is *the* schedule risk for the whole project — start it first precisely because it's the longest pole.

**Exit criteria:** No "do NOT commit" doc tracked in the public repo; no secrets recoverable from history; Google verification submitted and CASA assessor engaged with a date; legal counsel engaged. **You do not proceed past here without the verification clock running.**

---

## Phase 1 — Architecture Foundation

**Duration: 2–4 weeks.** Pure scaffolding. No user-facing value yet — resist the urge to skip it, because every later phase imports from it.

**Goal:** Stand up the pnpm + Turborepo monorepo and extract the classifier into a single shared TypeScript package with a parity gate, so classification lives in exactly one place forever.

**Tasks:**
- **Scaffold the monorepo** (per Canonical Decision #4): `@pipeline/classify`, `@pipeline/contracts`, `apps/web`, `apps/api`, `apps/mobile`, `packages/ui-web`, `packages/ui-native`.
- **Port `classify.js` → `@pipeline/classify` (TS).** This is the highest-value, highest-care task in the phase. The 236-line classifier is pure, dependency-free, and already dual-runtime (browser globals + `module.exports`) — that purity is exactly why it ports cleanly. Preserve the *scored* `detectStatus` (OFFER_RE/REJECT_RE/INTERVIEW_RE/APPLIED_RE, highest score wins, offer>rejected>interview>applied precedence, `NEG_OFFER_RE` "unable to offer" → rejection, `null` when nothing matches), the `ATS_DOMAINS` set (~40 platforms), `resolveCompany`/`cleanCompanyName`/`rootName` (multi-level TLDs like `co.uk`), and `extractRole`/`ROLE_PATS`. This is the product's brain; do not "improve" it during the port — port it *byte-faithful* so the golden corpus still passes.
- **Build `@pipeline/contracts` (zod).** Encode the unified shape `{ threadId, domain, subject, messages:[{date, from, body}] }` with `BODY_CHARS=600`. Reimplement `providers.py`'s raw→unified mapping logic as TS mappers here (it is a *mapper*, not a classifier twin — correcting the loose "duplicated classifier" framing), validated against the existing `mappers.test.js` corpus.
- **Build the parity gate.** A shared golden-corpus (fixtures + expected `{status, company, role}`) that runs in **both** CI lanes: Node against `@pipeline/classify`, and Python against the frozen local `classify.js` copy. The free local Python build keeps its own frozen classifier (acceptable, separate artifact) — the corpus is what prevents the two from drifting. Wire it into the existing `test.yml`/`build.yml` Actions.
- **Freeze the local build.** Tag the current `server.py` + `index.html` as the frozen free/local artifact. Do **not** migrate the 1,394-line monolith; it's small enough to leave alone and reimplement on the hosted side faster than to untangle.

**Deliverables:** Working monorepo; `@pipeline/classify` passing the ported `classify.test.js`; `@pipeline/contracts` passing the `mappers.test.js` corpus; green parity gate across Node + Python CI lanes; tagged frozen local build.

**Risks:**
- Subtle classifier regression during the port (negated-offer handling and multi-level-TLD root extraction are the brittle spots). Mitigation: the golden corpus *is* the safety net — expand it before porting, not after.
- Monorepo tooling yak-shave (Turborepo/pnpm/TS path config) eating days. Cap it; AI tooling is good at this scaffolding.

**Exit criteria:** One classifier, in TypeScript, imported cleanly by a stub web and stub API; parity gate green in CI; local build frozen and tagged. **Classification now lives in exactly one place on the hosted side.**

---

## Phase 2 — Web MVP

**Duration: 6–10 weeks.** The longest build phase and the heart of the commercial product. This is where most of your hands-on-keyboard time goes.

**Goal:** A hosted, multi-user web app where a signed-in user connects **one** mailbox via incremental consent and sees a live board — the rebuilt React+TS+Vite app on the new Fastify backend, talking the shared contract.

**Tasks:**
- **Rebuild the frontend** as a React+TS+Vite component app (Canonical Decision #3) consuming `@pipeline/classify` + `@pipeline/contracts`. Reimplement the board, search, timeframe, sort, pin/ignore, and manual status-override — the four-status model (applied/gray, interview/yellow, offer/green, rejected/red). Do **not** port the monolith; reimplement against the contract.
- **Stand up the Fastify API** (`apps/api`), sharing the classifier + contracts. This replaces `server.py` for the hosted surface (it stays as the frozen local build). Implement the contract-faithful equivalents — the board read becomes `/api/applications` (derived records) in place of the local `/api/threads`, plus `/api/accounts`, `/api/disconnect`, and the `/auth/<provider>/start|callback` flow.
- **Wire identity (Clerk) separately from mail scope** (Decision #8). Clerk issues httpOnly secure session cookies; the restricted `gmail.readonly`/`Mail.Read` grant is a *separate* incremental consent requested only when the user connects a mailbox. This decoupling is what lets people sign in even while Google verification is still pending.
- **Implement OAuth for real, hosted.** Google: Authorization Code + PKCE, Web-application client (client secret required), `access_type=offline` + `prompt=consent` for refresh tokens. Microsoft: public client (PKCE, no secret), `consumers` tenant, `Mail.Read` + `offline_access` — and remember MS killed basic-auth/app-password IMAP for personal accounts in 2024, so OAuth is mandatory for Outlook.com. **Critical fix vs `server.py`:** the in-memory `_pending = {}` OAuth-state store won't survive multi-worker/hosted — move OAuth state to Redis (Upstash) or Postgres.
- **Persist to Neon Postgres.** Users, accounts, derived application records. For the MVP a first-connect full backfill is acceptable; incremental sync is Phase 3. Frontend state (`pipeline.manualPositions`, `timeframe`, `sort`, `cardOrder`, pin/ignore sets, status-override maps) migrates from localStorage to backend persistence for hosted users.
- **Run under the Google test-user allowlist (≤100).** This is exactly what the allowlist is *for* — real hosted multi-user behavior, capped, while verification proceeds.

**Deliverables:** Deployed web app (Vercel frontend, Fastify API on Fly.io, Neon Postgres); Clerk auth; one-mailbox connect for Google + Microsoft; live board rendering derived records; ≤100 test users onboarded.

**Risks:**
- This is the biggest scope chunk — guard against gold-plating. One mailbox, four statuses, live board. Multi-mailbox merge, analytics, reminders are all Pro/later.
- OAuth-state and token-refresh bugs (the `valid_access_token()` + `on_refresh` persistence path) are fiddly; budget debugging time.
- Microsoft personal-account OAuth quirks (`consumers` tenant) are a known pain point.

**Exit criteria:** A test user signs in (Clerk), connects one Google *or* Microsoft mailbox via incremental consent, and sees a correctly classified live board, hosted, persisted in Postgres. Contract and classifier are the shared packages — no fork.

---

## Phase 3 — Backend Hardening

**Duration: 4–7 weeks.** Less visible than Phase 2 but **non-negotiable before launch** — this is what makes the product pass CASA, respect the privacy brand, and not bankrupt you on API quota.

**Goal:** Replace full-rescan sync with incremental push-driven sync, encrypt tokens at rest with envelope encryption, and enforce derived-records-only storage.

**Tasks:**
- **Kill the full-re-read-every-sync.** Today `server.py`/`providers.py` re-search up to a year of mail on every sync (Gmail caps ~800 thread ids / first 200 threads `format=metadata`; Graph up to 1000 via `$search` + junk; IMAP ~12 ANDed SEARCH terms with `SINCE`, `MAX_MESSAGES=300`). No History API, no delta, no cursor. This burns quota, won't scale, and **fails CASA's data-minimization review.** Replace with: Gmail `users.history` (per-account `historyId` cursor) + `watch` → Pub/Sub push; Microsoft Graph `delta` queries + change-notification subscriptions renewed before expiry. Per-account cursor + subscription-expiry stored in Postgres. Full backfill **only** on first connect.
- **Envelope-encrypt tokens at rest** (Decision #9). Per-row data key (libsodium `crypto_secretbox`) wrapping the OAuth tokens; master key in managed KMS. **Never** plaintext or base64 in the hosted build. (The `server.py` `.pipeline-accounts.json` chmod-0600-but-unencrypted store and the desktop base64 fallback are *local-only* and explicitly out of scope here — acceptable for single-user local, unacceptable hosted.) Mail tokens are the crown jewels; envelope encryption caps blast radius and enables key rotation without re-reading every row.
- **Enforce derived-records-only storage** (Decision #11). Persist company, role, status, status-history dates, and the ≤600-char snippet — **never** raw email bodies. Raw text lives only briefly in-flight (during the sync→classify pass, and during the optional Pro LLM second pass) and is never written durably. This is the literal expression of the privacy brand and the strongest CASA/GDPR posture.
- **Stand up the worker/queue.** Sync + subscription-renewal workers as always-on containers on Fly.io (Decision #12 — Pub/Sub push and pre-expiry renewal need a persistent listener; Lambda-only fights this). Upstash Redis for the job queue and rate-limit buckets.
- **GDPR/CCPA delete + export.** User-controllable disconnect/delete that actually purges tokens and derived records.

**Deliverables:** Incremental sync live for Gmail + Graph (cursors + subscriptions in Postgres); envelope-encrypted token store backed by KMS; derived-only persistence verified (no raw bodies in DB); Fly.io workers + Upstash queue; working delete/export.

**Risks:**
- Gmail `watch`/Pub/Sub and Graph subscription lifecycle (renewal-before-expiry, missed-notification reconciliation) are genuinely tricky — the failure mode is silent staleness. Build reconciliation (periodic catch-up via cursor) as a backstop.
- KMS/key-rotation plumbing is easy to half-do; the data key must be re-wrappable without re-reading rows.

**Exit criteria:** No code path re-reads a full mailbox after first connect; every token in Postgres is envelope-encrypted; a DB dump contains zero raw email bodies; delete/export demonstrably purge data. **This phase is a CASA gate — do not launch without it.**

---

## Phase 4 — Mobile MVP

**Duration: 3–5 weeks.** Deliberately *after* web + backend are stable, because mobile is **companion-only** and depends entirely on a stable hosted API.

**Goal:** An Expo / React Native glance-and-act companion that reads server-derived records over the hosted API — and never scans a mailbox on-device.

**Tasks:**
- **Build the Expo RN companion** (`apps/mobile`) importing `@pipeline/classify` (logic) and `@pipeline/contracts` (types) and `packages/ui-native` (native tokens — web and native share design tokens + logic, *not* rendering primitives, per Decision #4). It reads the **server-derived** application records over the hosted API.
- **Enforce the companion boundary** (Decision #2): mobile **never** scans a mailbox on-device. No on-device classification of raw mail, no per-platform restricted-scope grant. First-run OAuth, billing, analytics deep-dives, and account deletion/export all live on web — the reasons being (a) on-device scanning would re-fork the classifier, (b) duplicate restricted-scope/CASA risk per platform, and (c) break the one-place-classifies rule.
- **Glance-and-act UI:** board overview, status changes, pin/ignore, and (Pro, later) follow-up reminder push — backed by the same derived records.
- **Ship to internal channels:** TestFlight + Play internal testing. Public app-store submission can lag GA.

**Deliverables:** Expo app reading hosted derived records; native auth handoff to the web/Clerk session; internal-channel builds on TestFlight + Play internal.

**Risks:**
- Scope creep toward making mobile "do its own sync" — reject this hard; it violates the architecture and re-opens compliance risk.
- App-store review timelines (esp. Apple) add their own lead time — start the developer accounts and store listings during this phase, not at launch.

**Exit criteria:** A user signed in on web sees the same board on mobile, can act on it, and **no mailbox is ever read on the device**. Companion ships to internal testers.

---

## Phase 5 — Polish, QA, and Launch

**Duration: 4–8 weeks of work, but the *launch* itself is gated by Google — it happens when verification + CASA pass, which may be later than the engineering is done.** This is the phase where the Phase 0 clocks come due.

**Goal:** Finalize compliance, legal, and QA, and flip to public multi-user GA — but only after the external gates clear.

**Tasks:**
- **Land Google verification + CASA Tier 2.** Respond to assessor findings (the Phase 3 incremental-sync + derived-only + encrypted-tokens work is what makes these answerable). Until this passes, you stay on the ≤100 test-user allowlist — **no public multi-user launch ships ahead of it** (Decision #16).
- **Complete Microsoft publisher verification** (MPN/Partner) for the consent screen and to raise limits.
- **Finalize legal.** Turn the draft `PRIVACY.md`/`TERMS.md` into counsel-reviewed published docs with a *real* contact address replacing the placeholder.
- **Sign and notarize the desktop build.** `electron-builder` currently ships **unsigned/unnotarized** dmg/nsis — sign and notarize before any wide desktop distribution.
- **Stand up billing + the license gate** for the open-core split (Decision #13): Merchant-of-Record (Lemon Squeezy / Paddle — handles global VAT for a solo founder) issuing Ed25519-signed offline-verifiable license tokens; public key embedded in the app; hosted Pro gates server-side by subscription claim, desktop gates by license token. Build *just enough* — moat is convenience + B2B compliance, not DRM.
- **QA pass:** end-to-end across the three run modes (Electron / local web / static demo), error states, rate-limit behavior, sync reconciliation, delete/export. Load/quota sanity-check now that sync is incremental.

**Deliverables:** Passed Google verification + CASA; Microsoft publisher verification; published legal docs with real contact; signed/notarized desktop build; live billing + license gate; QA sign-off; **public multi-user GA**.

**Risks:**
- **The dominant risk of the whole project: Google/CASA slips the launch date.** Engineering can be done and you still can't open the gates. Mitigation is entirely in Phase 0 — having started early. There is no engineering fix in Phase 5.
- Assessor findings force backend rework — minimized by having done Phase 3 properly.
- Apple notarization snags on the desktop build.

**Exit criteria:** Google restricted-scope verification passed, CASA Tier 2 passed, Microsoft verified, legal published with real contact, desktop signed, billing + license gate live. **Only then** does the test-user allowlist come off and public GA ship.

---

## Phase 6 — Post-launch Improvements

**Duration: Continuous.** This is where the *revenue* lives — Free is the funnel; Pro/Teams is the business.

**Goal:** Ship the license-gated Pro and Teams features that justify the price, and improve retention.

**Tasks (roughly in monetization-impact order):**
- **Multi-mailbox merge (Pro).** Already essentially built in the desktop `main.js` (loopback OAuth, multi-account store, merge into one board) — this is *cheap to gate* on hosted and a strong first paid feature.
- **LLM second-pass classification (Pro, hosted-only).** *(Sequencing note: this is **built and gate-validated pre-GA** — see §17.2 "Pro-feature complete (still gated/private)" and §19 Step 14 — running privately under the test-user allowlist. It appears in this post-launch list because it is publicly **enabled and sold** once verification clears, not first built here.)* The intended-but-unbuilt LLM pass in `detectStatus`. Keyword/regex `@pipeline/classify` runs first; the LLM escalates **only** low-confidence/ambiguous threads to cap marginal cost (Decision #14). Server-side only (key custody + cost control), default a small/fast Haiku-class Claude model for cost-per-classification. Only send consented text; never persist the raw body sent. The marginal cost is exactly what justifies the Pro gate. This also fixes the classifier's known brittleness on unusual/multilingual/mixed-signal phrasing.
- **Analytics (Pro, hosted).** Funnel %, time-in-stage, response rate, weekly digest — derivable from the status-history dates you're already persisting.
- **Follow-up reminders, CSV/PDF export, interview-prep generator, notes/contacts (Pro).** Mix of cheap-to-gate (export, notes) and medium/LLM build (reminders, interview-prep).
- **Teams (B2B2C).** Seat/license admin (Clerk org primitives help here), **opt-in aggregate-only** cohort dashboards that **never** touch inbox content, optional white-label. Career-services compliance is the real moat.
- **Pay down debt:** expand the golden corpus continuously (every misclassification a user reports becomes a fixture), tighten sync reconciliation, and keep the CASA posture current (it's annual).

**Deliverables:** Shipped Pro features behind the license gate; Teams seat admin + cohort dashboards; growing golden corpus; renewed annual CASA.

**Risks:**
- Building Pro features the free funnel doesn't actually convert on — let usage data, not the roadmap, prioritize order. Multi-mailbox and LLM classification are the safest first bets (one is nearly built, the other is the headline feature).
- LLM cost creep if the confidence threshold for escalation is set too loose — instrument cost-per-classification from day one.

**Exit criteria:** None — this phase is continuous. The milestone that matters is the first paying Pro user, then the first Teams seat contract.

---

# 12. Feature Prioritization

This section sequences the post-rebuild feature backlog against the Canonical Decisions Brief. Sequencing logic is not "what's most exciting" — it is **what unblocks revenue and what de-risks the launch gates** first. Two things dominate ordering:

1. **The hosted rebuild is the commercial surface.** Anything that doesn't run on the hosted Node/Fastify + React/TS stack is, at best, a desktop-only convenience. The free local build (`server.py` + `index.html`) is **frozen** — no new features land there.
2. **The leak and the sync model are not features but they gate features.** The `business/OPEN-CORE-SPLIT.md` leak (live, git-tracked, publicly exposing this exact tier strategy) and the full-rescan sync in `providers.py`/`server.py` are remediation work that must precede or accompany the first paid feature. They appear here because they consume the same build budget and block CASA.

**Legend used in every table:**

- **Tier** — Free / Pro / Teams per the locked tier mapping.
- **Surface** — Hosted (Node API + React web), Local (frozen Python/`index.html`), Desktop (Electron), Mobile (Expo companion). "Both" = hosted + local where the feature already exists in the frozen build.
- **Gate cost** — *cheap-to-gate* (logic exists or is trivial; the work is the paywall/claim check) vs *expensive-to-build* (net-new system, marginal runtime cost, or large surface area).
- **Complexity / Value / Risk** — Low / Med / High.

A blunt framing up front: of the eight named feature candidates, **only two are cheap-to-gate-and-already-exist** (multi-mailbox merge, CSV export). The rest are real builds. The prioritization protects that fact — you ship the cheap revenue unlocks first while the expensive ones are still scaffolding.

---

## Bucket 1 — Must Build First

These are the minimum set to (a) make the hosted product chargeable at all, (b) stop the bleeding from the leak, and (c) make sync survive a CASA review and real users. Nothing in Bucket 2+ is reachable without these.

| Feature | Tier | Surface | Gate cost | Cmplx | Value | Risk | Why first / dependencies |
|---|---|---|---|---|---|---|---|
| **Leak remediation + repo split** (purge `business/OPEN-CORE-SPLIT.md` from git history, move ~14 MB media out of MIT repo) | n/a | Repo | cheap-to-gate (it's deletion) | Low | High | **High** | Per Decision #15 this is a **release gate**. The doc is headed "do NOT commit" and is committed — your pricing, moat, and Pro/Teams split are public *right now*. History scrub (`git filter-repo`) + force-push + rotate anything secret-adjacent. Trivial effort, high consequence. **No dependencies. Do this week one.** |
| **`@pipeline/classify` extraction (TS) + parity gate** | Free | Hosted/Mobile/API | cheap-to-gate (it's a refactor) | Med | High | Med | Single-source-of-truth classifier (Decision #5). Everything downstream — hosted board, LLM second pass, analytics status-history — imports this. Extract the 236-line `classify.js` (`detectStatus`, `resolveCompany`, `extractRole`, `ATS_DOMAINS`) into the TS package; freeze the Python copy and bind both to a **shared golden corpus** so they can't drift. Reuse existing `test/classify.test.js` + `test/mappers.test.js` as the corpus seed. **Dependency: monorepo scaffold (Decision #4).** |
| **`@pipeline/contracts` (zod) + TS mappers** | Free | Hosted/Mobile/API | cheap-to-gate | Med | High | Low | The unified `{ threadId, domain, subject, messages[] }` / `BODY_CHARS=600` shape, reimplemented from `providers.py` mappers into TS, validated against `mappers.test.js`. Without this the API has no typed boundary and mobile can't reuse logic. **Depends on monorepo scaffold.** |
| **Incremental, push-driven sync** (Gmail `history`/`watch`→Pub/Sub; Graph `delta`+subscriptions) | Free | Hosted | expensive-to-build | High | High | **High** | The current model — `_fetch_gmail` caps ~800 ids / 200 threads, `_fetch_graph` up to 1000 msgs, IMAP 12 SEARCH terms capped at 300, **re-reading ~1 year of mail every sync** — will not pass CASA data-minimization and will burn quota at any real user count (Decision #10). This is the single biggest hosted build. **Depends on: contracts, classifier, Postgres cursors, always-on workers (Fly.io, Decision #12).** |
| **Envelope token encryption at rest** | Free | Hosted | expensive-to-build | Med | High | **High** | Tokens today are `.pipeline-accounts.json` chmod 0600, **unencrypted** (acceptable local, "unacceptable hosted" per the brief). Per-row libsodium `crypto_secretbox` data key wrapped by KMS (Decision #9). Mail OAuth tokens are the crown jewels; this is non-negotiable before any hosted token is stored. **Depends on Postgres + KMS.** |
| **Derived-records persistence (no raw bodies)** | Free | Hosted | expensive-to-build | Med | High | Med | Persist company/role/status/status-history + the ≤600-char snippet only; raw text lives only in-flight (Decision #11). This *is* the privacy brand expressed in schema, and it's the strongest CASA/GDPR posture. **Depends on contracts + classifier (records are their output).** |
| **Identity + incremental mail consent** (Clerk session; restricted scope requested only on mailbox connect) | Free | Hosted | expensive-to-build | Med | High | Med | Decision #8. Decouples sign-in from the Google restricted-scope/CASA gate so login works before verification clears, and gives org/seat primitives you'll need for Teams later. **Depends on hosted API existing.** |

**Bucket-1 honest note:** five of these seven are infrastructure, not features a user sees. That's correct. The frozen local build already demonstrates the *product*; the hosted Bucket-1 work is what makes it a *business* that won't get suspended by Google or breached on day one. Resist the urge to ship a Pro feature before the sync and token story are real.

---

## Bucket 2 — Build Second

The first revenue. These are chosen because each is either **cheap-to-gate-and-already-exists** (fast money) or a high-leverage Pro pillar that directly justifies the subscription. Order within the bucket: cheapest gate first.

| Feature | Tier | Surface | Gate cost | Cmplx | Value | Risk | Why second / dependencies |
|---|---|---|---|---|---|---|---|
| **Multi-mailbox merge** | Pro | Both (built in desktop) | **cheap-to-gate** | Low | High | Low | Already implemented in `main.js` (loopback OAuth, multi-account store, merges mailboxes into one board). On hosted, the *logic* is the incremental-sync work; the **Pro gate is a server-side subscription-claim check**, near-zero build. This is the textbook first paid feature: high perceived value, the engine already exists. **Depends on: hosted sync, license/subscription claim plumbing.** |
| **License gate plumbing** (Ed25519 offline token desktop; server-side subscription claim hosted; MoR webhook) | n/a | Hosted+Desktop | expensive-to-build (once) | Med | High | Med | Not a user feature, but **the thing that turns every "cheap-to-gate" item into money**. Decision #13: Lemon Squeezy/Paddle MoR webhook issues the claim/token; public Ed25519 key embedded. Build once, gate forever. Deliberately *not* heavy DRM. **Depends on: nothing in-app; blocks all Pro monetization.** |
| **CSV / PDF export** | Pro | Both | **cheap-to-gate** | Low | Med | Low | Derived records already exist (Bucket 1). CSV is trivial; PDF is a templated render. Pure additive value behind the claim check. **Depends on: derived-records persistence, license gate.** |
| **Notes / contacts** | Pro | Both | cheap-to-gate | Low | Med | Low | A new column on the application record + a panel in the React board. No mail access, no marginal cost, no compliance surface. Easy retention win behind the gate. **Depends on: derived-records schema, license gate.** |
| **Follow-up reminders** | Pro | Hosted (+desktop) | medium build | Med | High | Med | High product value (this is *the* "don't let an application go cold" hook) but needs a scheduler/worker + notification channel (email; later mobile push). Status-history dates from the classifier feed the "stale" trigger. **Depends on: status-history persistence, always-on workers, an email sender.** |
| **LLM classification (Pro, server-side, low-confidence second pass)** | Pro | Hosted only | expensive-to-build | Med | High | Med | The clearest "has marginal cost ⇒ justifies charging" feature (Decision #14). The keyword classifier is **brittle on multilingual / mixed-signal phrasing** by the brief's own admission, so the LLM escalation is real value, not a gimmick. Runs *only* on low-confidence threads to cap cost; Haiku-class default; **never persist the raw body sent**. **Depends on: `@pipeline/classify` confidence output, hosted sync, key custody.** |

**Why LLM classification is Bucket 2, not Bucket 1:** it's the strongest single argument for the paid tier, and the regex classifier's brittleness is documented. But it cannot precede the classifier extraction (it's literally the second pass *on top of* `@pipeline/classify`) and it adds the one place raw text is processed in-flight — which you only want to open *after* the no-raw-storage posture is locked. So: right after the infra, first among the "earns the subscription" features.

---

## Bucket 3 — Build Later

Real Pro/Teams value, but each is **expensive-to-build** with a dependency chain that only closes once Bucket 1–2 exist and you have enough hosted users for the data to matter. Building these early is premature optimization against a user base you don't have yet.

| Feature | Tier | Surface | Gate cost | Cmplx | Value | Risk | Why later / dependencies |
|---|---|---|---|---|---|---|---|
| **Funnel analytics** (funnel %, time-in-stage, response rate, weekly digest) | Pro | Hosted | **expensive-to-build** | High | High | Med | The marquee Pro feature, but it needs **clean status-history over time** to be non-embarrassing — and status-history quality depends on incremental sync + LLM second pass being settled. Garbage-in analytics on a brittle regex classifier would undersell the tier. Weekly digest reuses the reminders worker. **Depends on: status-history depth, sync stability, reminders infra.** |
| **Interview-prep generator** | Pro | Hosted | medium-expensive (LLM) | Med | Med | Med | LLM-driven, so it shares the cost/key custody machinery from the LLM-classification build. Genuine value but **narrower** than reminders/analytics, and it leans on company/role resolution being good (the company recovery in `classify.js` is solid; role extraction via `ROLE_PATS` is shallower). Ship after the LLM plumbing has paid for itself on classification. **Depends on: LLM infra, role/company quality.** |
| **Mobile companion app** (Expo RN; reads server-derived records, never scans on-device) | Free/Pro mix | Mobile | expensive-to-build | High | Med | Med | Decision #2: glance-and-act, **never** scans a mailbox on-device — it consumes the hosted API. It can't exist before the hosted API, contracts, and incremental sync are stable, and it adds app-store overhead a solo founder shouldn't carry pre-revenue. High strategic value, wrong *timing*. **Depends on: stable hosted API + `@pipeline/contracts` + push notifications.** |
| **Teams: seat / license admin** | Teams | Hosted | medium build | Med | Med | Med | Needs Clerk org primitives (chosen partly *for* this, Decision #8) + the license/subscription plumbing extended to seat counts. No point building B2B seat management before you've validated single-seat Pro. **Depends on: Clerk orgs, license gate, validated Pro.** |
| **Code-signing / notarization** (Electron `electron-builder` dmg/nsis currently **unsigned**) | n/a | Desktop | medium build | Low | Med | Med | The desktop build ships unsigned/unnotarized today — Gatekeeper/SmartScreen friction. Matters for the funnel's desktop arm but doesn't block hosted revenue, so it waits until desktop distribution is a priority. Pure cost (certs + CI), no architecture. **Depends on: Apple/Win signing certs.** |

---

## Bucket 4 — Do Not Build Yet

Explicitly deferred. Each has a **named trigger** — the condition under which it graduates to a real bucket. Building any of these now is the classic solo-founder failure mode: over-engineering moat/compliance/B2B before there's a customer.

| Feature | Tier | Surface | Gate cost | Cmplx | Value now | Risk if built now | Trigger to revisit |
|---|---|---|---|---|---|---|---|
| **Teams aggregate-only cohort dashboards** (opt-in, never inbox content) | Teams | Hosted | **expensive-to-build** | High | Low (no Teams customers) | High — privacy-sensitive aggregation surface, huge build, **zero validated demand** | A signed (or seriously LOI'd) career-services / bootcamp customer. This is B2B2C; build it *with* a design partner, not speculatively. |
| **White-label** | Teams | Hosted | medium build | Med | Low | Med — theming/tenancy plumbing for nobody | A Teams customer explicitly paying for it. Optional even in the tier plan. |
| **Heavy DRM / anti-piracy beyond the Ed25519 offline token** | n/a | Desktop/Hosted | expensive-to-build | High | Negative | High — burns budget on copy-prevention the brief explicitly says isn't the moat (Decision #13) | Evidence of material revenue loss to piracy. Realistically: never. Moat = convenience + B2B compliance. |
| **New features in the frozen local build** (`server.py` / `index.html`) | Free | Local | n/a | — | Negative | High — re-forks logic out of `@pipeline/classify`, breaks the single-source rule, reintroduces drift | Never by default. The local build is a frozen funnel/privacy-proof artifact (Decision #3); fixes only, no features. |
| **FastAPI reuse of `providers.py` for the hosted backend** | n/a | Hosted | — | — | Negative | High — re-forks the classifier into Python, blocks mobile from importing it, reintroduces the dual-runtime drift being killed | Never (explicitly REJECTED, Decision #6). Listed here only to forestall the "but `providers.py` already works" temptation. |
| **Generic file-serving / public hosting of the local Python server** | n/a | Local | — | — | Negative | **High** — `server.py` allowlists static files *on purpose* to avoid leaking `config.json`/`.pipeline-accounts.json`/`.git`; OAuth `_pending` is in-memory single-process; it binds 127.0.0.1 by design. Hosting it multi-user would leak tokens and break OAuth state. | Never. The hosted product is the Node/Fastify rebuild, not a deployed `server.py`. |

---

### One-screen sequencing summary

| Order | Theme | Gates unlocked |
|---|---|---|
| 1 | **Stop the leak; lay the rails** (repo scrub, `@pipeline/classify`, `@pipeline/contracts`, sync, token encryption, derived records, identity) | Legal/compliance posture; CASA-survivable sync; chargeable, breach-resistant hosted base |
| 2 | **First revenue** (license plumbing → multi-mailbox, CSV/PDF, notes → reminders → LLM classification) | Pro tier becomes real money; cheapest gates first |
| 3 | **Deepen Pro + open new surfaces** (analytics, interview-prep, mobile, Teams seat admin, desktop signing) | Retention + B2B groundwork once data and users exist |
| 4 | **Hold** (cohort dashboards, white-label, DRM, local-build features, FastAPI, public Python hosting) | Only on a named trigger — usually a paying customer |

The discipline this matrix enforces: **infrastructure and the leak before features; cheap-to-gate before expensive-to-build; validated demand before B2B/moat work.** A solo founder building with AI tooling can move fast, but only along this dependency chain — every Bucket-2 revenue feature is downstream of the Bucket-1 classifier extraction and sync rebuild, and no amount of speed reorders that.

---

# 13. Migration Strategy

This is not a migration in the database-cutover sense. There is no central user data, no hosted state, nothing to drain. The current app is a local-first, single-user artifact whose only persistence is `localStorage` on one machine. So "migration" splits cleanly into two unrelated problems:

1. **Code migration** — moving logic (the classifier, the contract, the mappers, the provider abstraction) from the current JS/Python split into the new monorepo's shared TS packages, without regressing classification quality.
2. **Per-user data onboarding** — which is *greenfield import on first connect*, not a backfill. When a hosted user connects a mailbox, the API scans and derives records into Postgres for the first time. There is no legacy server-side dataset to carry forward.

Conflating these two is the most common way this kind of move goes wrong. Treat them separately.

## 13.1 Strategy: build in parallel, never in-place

**Decision: parallel build, with the current local app frozen and still shipping.** Do not refactor `index.html`, `server.py`, `classify.js`, `providers.py` in place toward the hosted architecture. Per Canonical Decision #3, the local build is a separate, frozen artifact and the hosted frontend is a clean React+TS+Vite rebuild.

Why parallel and not gradual-replace:

| Reason | Detail |
|---|---|
| The local app is the funnel and the privacy proof | Per the constraints, a credible free/local option must stay alive. If you start mutating `server.py` into a multi-worker Fastify-shaped thing, you break the single-process, 127.0.0.1-only, zero-dep property that *is* the privacy pitch. |
| Different runtimes, different languages | The local backend is Python stdlib; the hosted backend is Node/TS Fastify (#6). There is no incremental "port file by file in place" path between them — they are different processes with different deploy models. |
| The monolith is small | `index.html` is 1,394 lines / ~76 KB — **not** the 2.6 MB the original prompt claimed (that figure is `business/explainer.html`, a marketing page). 1,394 lines of vanilla JS is faster to reimplement as components than to incrementally transmute into React. Reimplement, don't untangle. |
| Open-core needs a clean seam anyway | The split between public-MIT-free and private-license-gated-Pro can't be retrofitted onto a single monolith. A fresh package boundary is required regardless. |

The local build keeps shipping unchanged the entire time the hosted product is built. Its only mandatory change is the **leak/asset remediation** (§13.7), which is a release gate, not a migration step.

## 13.2 Disposition of every current asset (keep / freeze / extract / rewrite / migrate)

| Asset | Lines | Disposition | What actually happens |
|---|---|---|---|
| `classify.js` | 236 | **EXTRACT → rewrite as TS** | Becomes the seed of `@pipeline/classify` (TS). The JS file is retired on the hosted side; a frozen copy stays in the local build. |
| `providers.py` (mappers) | 343 | **EXTRACT (logic), REWRITE (transport)** | The raw→unified *mapping* logic is reimplemented as TS mappers under `@pipeline/contracts`. The OAuth/PKCE/refresh transport logic is **re-implemented**, not ported, into the Node API (#6). |
| `server.py` | 566 | **FREEZE (local) + REWRITE (hosted)** | Stays as-is for the local build. Its endpoints, allowlist static serving, and in-memory `_pending` OAuth state are *not* carried into hosted — hosted is Fastify + Neon + Upstash. The full-rescan sync logic is explicitly **discarded** and replaced by incremental sync (#10). |
| `index.html` | 1,394 | **FREEZE (local) + REDESIGN (hosted)** | Local keeps the vanilla-JS monolith. Hosted is a fresh React+TS+Vite component app that reuses the *concepts* (board, LiveProvider/MockProvider swap, status colors) but none of the file. |
| `main.js` / `preload.js` / `gmail.js` / `msgraph.js` / `imap.js` | ~670 | **KEEP (desktop) + HARVEST** | Desktop Electron build stays. Its loopback-OAuth + multi-account-merge logic is the *reference* for the hosted multi-mailbox feature (which is "already ~built in desktop"). `safeStorage` keychain handling informs nothing on the server side — hosted uses envelope encryption (#9), not OS keychain. |
| `MockProvider` / demo data | — | **KEEP + PORT** | Reimplemented in the React app as the static-demo run mode. It is the open funnel's "try without connecting" path and stays Free-tier. |
| `test/classify.test.js` (131) `test/mappers.test.js` (163) `test/providers_test.py` (130) | 424 | **REPURPOSE as golden corpus** | These existing fixtures become the parity safety net (§13.4). Do not delete them — they are the only existing evidence of correct behavior. |
| `LiveProvider` / `pipelineAPI` abstraction | — | **KEEP (concept)** | The Provider seam (desktop `window.pipelineAPI.fetchThreads` vs web `/api/threads` vs Mock) is the architectural pattern the hosted app reuses: same unified contract, swappable data source. |
| GitHub Actions `build.yml` / `test.yml` | — | **EXTEND** | Keep the existing Node + Python test lanes; add the parity-gate lane and the monorepo Turborepo pipeline. |

## 13.3 Step (a): single-file `index.html` → component framework

`index.html` is one file holding the dark-theme UI, the board, the localStorage state machine, and the Provider switch. Do not migrate it — rebuild it. Concrete sequence:

1. **Inventory behavior before writing any React.** Enumerate the localStorage keys it owns — `pipeline.manualPositions`, `pipeline.timeframe`, `pipeline.sort`, `pipeline.cardOrder`, plus the pin/ignore sets and manual status-override maps. Each becomes either client state (Free, kept in `localStorage` even on hosted for cheap features) or server state (Pro, Postgres) per §13.5. Write this mapping down first; it is the real spec.
2. **Lock the contract in `@pipeline/contracts`.** Define the zod schema for `{ threadId, domain, subject, messages:[{date, from, body}] }` with `BODY_CHARS=600` enforced. The React app consumes only this type. This guarantees the new UI can't drift from the contract the local build and classifier already speak.
3. **Re-express the Provider seam as a typed interface.** The current app picks `window.pipelineAPI.fetchThreads` (desktop) → `/api/threads` (web) → `MockProvider`. In React this becomes one `ThreadProvider` interface with three implementations: `HostedApiProvider` (calls the Fastify API), `MockProvider` (demo), and — only if you ship a web-embeddable local mode — a local one. Same swap, typed.
4. **Rebuild visual primitives as components**, not by copying markup: `Board`, `Column(status)`, `Card`, `TimeframeFilter`, `SortControl`, `SearchBox`. Status colors stay the canonical four — applied/gray, interview/yellow, offer/green, rejected/red — sourced from shared design tokens (#4) so mobile (`ui-native`) and web (`ui-web`) agree without sharing rendering code.
5. **Port `SHOW_LOGOS=false`-by-default and the favicon `referrerpolicy=no-referrer` behavior verbatim.** This is a privacy default, not a cosmetic one; losing it silently weakens the brand claim.
6. **Defer Pro surfaces behind a gate component.** Analytics, reminders, export, LLM-pass UI render only when the server-side subscription claim is present (#13 gating). Build them as lazy routes so the Free shell stays small.

The local `index.html` is untouched throughout. Two UIs coexist: frozen vanilla local, evolving React hosted.

## 13.4 Step (b): consolidate `classify.js` + `providers.py` → one `@pipeline/classify` with a parity gate

This is the highest-risk step because the classifier is the product's brain and it is currently **keyword/regex only, brittle on unusual/multilingual/mixed-signal phrasing**. Any silent regression here degrades the core value. Treat it as a refactor-under-test, not a rewrite.

First, correct the framing the prompt invites: **`providers.py` is not a classifier twin.** `classify.js` *classifies* (scored `detectStatus`, `resolveCompany`, `extractRole`, the ~40-entry `ATS_DOMAINS` set, negated-offer handling via `NEG_OFFER_RE`); `providers.py` *maps* raw Gmail/Graph payloads to the unified shape. So the consolidation is two distinct moves:

- **Classification logic** (`classify.js`) → `@pipeline/classify` (TS).
- **Mapping logic** (`providers.py` raw→unified) → TS mappers in `@pipeline/contracts`, validated by the existing `mappers.test.js` corpus.

Sequence, with the safety net built *before* the port:

1. **Freeze a golden corpus first.** Harvest every fixture from `classify.test.js`, `mappers.test.js`, and `providers_test.py` into a single language-neutral fixtures file: input thread → expected `{ status, company, role }` (and for mappers, raw payload → expected unified shape). This corpus is the contract for "correct." Add adversarial cases the current tests miss: negated offers ("we are unable to offer"), `Acme via Greenhouse` display-name recovery, multi-level TLD company roots (`co.uk`), and `detectStatus` returning `null` (caller keeps prior status). These are exactly the brittle edges; lock them down before touching code.
2. **Port `classify.js` to TS function-by-function**, preserving the *scored* model (not first-match): `OFFER_RE/REJECT_RE/INTERVIEW_RE/APPLIED_RE` accumulate points, highest wins, precedence offer > rejected > interview > applied. Keep `null` semantics. The dual-runtime trick (browser globals + `module.exports`) disappears — TS + the bundler handle all three runtimes (web/mobile/Node API), which is the entire point of #5.
3. **Run the TS classifier against the golden corpus in CI; require byte-equal `{status, company, role}` output** versus the captured expectations. This is the parity gate. The port is not "done" until it is green on the full corpus.
4. **Keep a Python parity lane in CI.** The frozen local build still runs Python tests; per #5 the *shared golden corpus* runs in **both** the Node and Python CI lanes so the two artifacts can't silently diverge over time. If someone changes a regex in one and not the other, CI fails.
5. **Only then wire the intended LLM second pass** (#14) — Pro-only, server-side, escalating low-confidence threads. Note the LLM pass that the current `detectStatus` comment anticipates **is not built** today; it is net-new and must sit *behind* the keyword classifier, never replace it, so the Free tier keeps a working deterministic classifier and the golden corpus stays meaningful.

Net result: one classifier of record on the hosted side; the local Python and JS copies are explicitly tolerated as frozen, drift-guarded by the shared corpus rather than by shared code.

## 13.5 Step (c): `localStorage` → Postgres

There is no server-side user data today — frontend state is 100% `localStorage` (no backend persistence). So this is not a data dump-and-load; it is a *policy decision per key* about what becomes server-of-record and what stays client-side.

| Current `localStorage` key | Hosted disposition | Rationale |
|---|---|---|
| `pipeline.timeframe`, `pipeline.sort`, `pipeline.cardOrder` | **Stay client-side** (`localStorage`) | View preferences; cheap, per-device, no reason to round-trip the DB. Free tier. |
| `pipeline.manualPositions`, manual status-override map | **Server (Postgres), Pro; client fallback, Free** | Manual override is a Free feature, but cross-device sync of overrides is a Pro reason-to-pay. Free keeps it local; Pro persists to the user's row. |
| pin / ignore sets | **Server (Postgres)** when signed in | Should survive device loss once there's an account; small, per-user. |
| (derived application records — *not currently persisted anywhere*) | **Server (Postgres), authoritative** | Per #11, hosted persists derived records (company, role, status, status-history dates, ≤600-char snippet) — **never raw bodies**. This is the new system of record that didn't exist before. |

Mechanics:

1. **No bulk migration job.** Because nothing lives server-side yet, the first time a user signs in and connects a mailbox, the API does the first incremental backfill (#10), classifies via `@pipeline/classify`, and writes derived records. That *is* the data onboarding.
2. **Optional one-time client import.** For a returning local-app user moving to hosted, offer an explicit "import my local board" action that reads their `localStorage` overrides/pins and POSTs them to the API. This is opt-in, runs once, and is the only thing resembling a classic migration — and it's tiny (a few JSON maps).
3. **Schema minimization is a compliance requirement, not a nicety.** Raw email bodies are never written; only the ≤600-char snippet and derived fields. This is the literal expression of the privacy brand and the strongest posture for Google's restricted-scope / likely CASA Tier 2 data-minimization review.
4. **Disconnect/delete must truly delete.** GDPR/CCPA: account deletion and per-mailbox disconnect must hard-delete derived records and tokens, not soft-flag them. Wire this into the schema (cascade deletes) from day one, because it's far harder to retrofit.

## 13.6 What to test *before* you cut anyone over

Migration risk lives in three places. Gate each:

1. **Classifier parity (blocking).** The golden corpus (§13.4) must be green in both CI lanes before the TS classifier is allowed to serve a single hosted user. No green corpus, no hosted classify.
2. **Mapper parity (blocking).** TS mappers reproduce `providers.py` output on the `mappers.test.js` corpus exactly — otherwise the unified contract silently shifts and every downstream classification is fed bad input.
3. **Incremental-sync correctness (blocking before public multi-user).** The current code does a full re-read every sync (Gmail caps ~800 ids / 200 threads `format=metadata`; Graph up to 1000 via `$search`; IMAP ~12 SEARCH terms ANDed with SINCE, `MAX_MESSAGES=300`, ~1 year). The new path is Gmail `users.history` + `watch`→Pub/Sub and Graph `delta` + change-notification subscriptions with pre-expiry renewal (#10). Test that a delta sync produces the *same* derived records as a full backfill on a fixture mailbox — drift here means missed or duplicated applications. This must pass before public launch not only for correctness but because full-rescan won't survive CASA's data-minimization review.
4. **Contract conformance (blocking).** Every provider path must emit zod-valid `@pipeline/contracts` shapes with `BODY_CHARS=600` enforced. A runtime contract validator in the sync pipeline catches a misbehaving provider before it pollutes the DB.

## 13.7 How to not break the current app (and close the live leak)

The current app keeps shipping. Protect it:

1. **Freeze branch / tag the local build.** Cut a release tag for the current vanilla local + desktop build so it has a stable, supported line independent of all hosted work. Bugfixes to local land on that line; hosted churn never touches it.
2. **Do not point the local app at hosted infra.** `server.py` stays 127.0.0.1-only, single-process, allowlist static serving, `.pipeline-accounts.json` chmod 0600. The whole privacy claim depends on it not phoning home.
3. **Remediate the leak *before* any further public work — this is a release gate, correcting the brief.** `business/OPEN-CORE-SPLIT.md` is literally headed "Internal planning doc. Local only — do NOT commit" and is nonetheless git-tracked and public in the MIT repo, exposing pricing, tiering, and moat reasoning. Required:
   - Purge `business/` strategy docs from the public repo **including git history** (history scrub / force-push, rotate anything sensitive that was exposed).
   - Move the ~14 MB of marketing media — `pipeline-demo.mp4` (8 MB), `explainer.html` (the actual 2.5 MB file), `pipeline-demo.gif` (1.4 MB), screenshots, `vo.mp3` — out of the MIT *app* repo into a separate marketing/asset repo or CDN. The public funnel repo ships code + MIT license + (finalized) legal docs only.
4. **Gate the open-core seam at the package boundary, not in files.** Free = public MIT packages (`@pipeline/classify`, `@pipeline/contracts`, the React Free shell, Mock/demo). Pro/Teams = **private** packages (analytics, reminders, export, LLM pass, seat admin). The hosted app composes both; the public repo only contains the Free packages. This is why the rebuild-as-monorepo step (#4) is load-bearing for migration — you cannot cleanly split a single `index.html`/`server.py`, but you can publish some workspace packages and keep others private.
5. **Sequence legal/compliance into the cutover, not after it.** `PRIVACY.md` / `TERMS.md` are drafts with placeholder contact info; they must be finalized with counsel and given a real contact, and Google restricted-scope verification (+ likely CASA Tier 2) and Microsoft publisher verification must complete, **before** the hosted app serves more than the ≤100 test-user allowlist. Until then, hosted runs in test-user mode against real users you've allowlisted — which is a perfectly good private beta and lets you validate the entire migration end-to-end without a public-launch gate blocking you.

## 13.8 Migration order of operations (the actual sequence)

1. Stand up the monorepo (pnpm + Turborepo), empty `@pipeline/contracts` + `@pipeline/classify` packages, CI skeleton.
2. Freeze the golden corpus from the three existing test files; add adversarial edges.
3. Port classifier + mappers to TS; pass the parity gate in both CI lanes. **Blocking.**
4. Remediate the leak and move marketing assets out of the public repo. **Release gate, can run in parallel with 1–3.**
5. Build the Fastify API: Clerk identity, incremental sync (#10), envelope-encrypted tokens (#9), Neon/Upstash, derived-record schema with cascade deletes.
6. Rebuild the hosted React+TS+Vite frontend against `@pipeline/contracts`; reuse Provider/Mock concepts.
7. Run hosted in **test-user allowlist mode** (≤100); validate delta-sync-vs-backfill parity and contract conformance on real mailboxes.
8. Finalize legal docs + complete Google/Microsoft verification.
9. Split Pro/Teams into private packages; wire the Ed25519 license gate (desktop) and server-side subscription claim (hosted).
10. Public multi-user GA — **only** after 7 and 8 are green.

Throughout all ten steps, the frozen local + desktop build keeps shipping. Nothing about this sequence requires taking the existing app offline, because there is no shared server state to take offline — which is the one genuine gift of having started local-first.

---

# 14. Testing and QA Plan

The classifier is the only part of this codebase that already has a real test discipline (`test/classify.test.js`, 131 lines; `test/mappers.test.js`, 163 lines; `test/providers_test.py`, 130 lines). Everything else — `server.py`, `main.js`, the frontend, OAuth, sync — is effectively untested. The transformation in this plan multiplies the surface area (hosted API, incremental sync, push subscriptions, billing, LLM second-pass, mobile companion) and raises the cost of a defect from "one local user sees a wrong card" to "we leaked a token / failed CASA / charged the wrong card / scanned mail we weren't consented to." This section defines what gets tested, to what bar, and what blocks a release.

The non-negotiable framing: **`@pipeline/classify` is the product. Its tests are the product's tests.** Everything else protects the perimeter around it. We invest test budget proportional to blast radius — classifier correctness, token-at-rest secrecy, and "we never persist raw mail" get the deepest coverage; UI polish gets smoke tests.

## 14.1 Test layers and tooling

| Layer | Scope | Tool | Where it runs |
|---|---|---|---|
| Unit | `@pipeline/classify`, `@pipeline/contracts` zod schemas, TS mappers, pure helpers | Vitest (TS), `node --test` legacy retained for local build, `python -m unittest` for frozen Python | Per-package CI lane, pre-commit |
| Integration | API ↔ Postgres ↔ Redis; sync workers ↔ mocked Gmail/Graph; webhook → license issuance | Vitest + Testcontainers (ephemeral Postgres/Redis), Nock/MSW for provider HTTP | `apps/api` CI lane |
| Contract | Provider raw → unified `{ threadId, domain, subject, messages[] }` shape; API DTOs | Recorded-fixture replay + zod parse assertions | `@pipeline/contracts` lane |
| E2E (web) | Sign-in → connect mailbox (mocked OAuth) → board renders → manual override persists → export | Playwright | Nightly + pre-release |
| E2E (mobile) | Companion read path, deep-link to web for OAuth/billing | Maestro (Expo-friendly) or Detox | Pre-release |
| Security | Static (Semgrep), dependency (Dependabot/`npm audit`/`pip-audit`), secret scan, token-at-rest assertions, allowlist/SSRF | Semgrep + custom integration tests | Every PR + nightly |
| Performance | Sync backfill throughput, classifier batch latency, API p95 | k6 (API), microbenchmark harness (classifier) | Nightly, pre-release |
| Accessibility | WCAG 2.1 AA on web board | axe-core via Playwright, manual keyboard/SR pass | Pre-release |

The monorepo (pnpm + Turborepo) makes `turbo run test` fan out per package with caching, so an unchanged `@pipeline/classify` doesn't re-run downstream suites unnecessarily — important for a solo founder's CI minutes.

## 14.2 The classifier corpus — the central testing investment

The current `classify.test.js` is a hand-written sanity suite: a few dozen strings asserting `detectStatus` and `resolveCompany` behave. That is nowhere near enough to (a) trust the keyword baseline on real-world mail, or (b) safely introduce an LLM second-pass. We build a **versioned golden corpus** as a first-class artifact in `@pipeline/classify/corpus/`.

### Corpus structure

Each case is a JSON record matching the unified contract plus a labeled expectation:

```jsonc
{
  "id": "neg-offer-de-001",
  "source": "synthetic",          // synthetic | donated | anonymized
  "locale": "de-DE",
  "tags": ["negated-offer", "ats-routed", "greenhouse"],
  "thread": { "threadId": "...", "domain": "...", "subject": "...", "messages": [/* date, from, body<=600 */] },
  "expect": { "status": "rejected", "company": "Acme GmbH", "role": "Data Engineer" }
}
```

The corpus must exercise, at minimum, these axes — each a deliberately stocked bucket, not incidental coverage:

| Axis | Why it breaks the keyword classifier today |
|---|---|
| **Multi-provider** (Gmail/Graph/IMAP mapping) | Different `from`/header shapes feed `resolveCompany`; Graph junk-folder routing differs |
| **ATS-routed** ("Acme via Greenhouse", all ~40 `ATS_DOMAINS`) | `resolveCompany` must recover real employer from display-name/subject/body, not the ATS |
| **Negated offer** ("we are unable to offer", "regret to offer no further") | `NEG_OFFER_RE` must score these as `rejected`, not `offer` — highest-risk false positive |
| **Mixed-signal** (interview reschedule that also says "your application") | Scored classifier must pick correctly; tests the precedence offer>rejected>interview>applied |
| **Multilingual** (de, fr, es, pt, etc.) | Keyword/regex is English-only — these are *expected failures* of the baseline and the prime LLM justification |
| **Status transitions** | Same thread over time; `detectStatus` returns `null` correctly so caller keeps prior status |
| **Role extraction edge cases** | `ROLE_PATS` on noisy subjects ("Re: Fwd: Your application — Sr. SWE (Remote)") |
| **Company-name cleanup** | Legal-suffix/recruiting-word stripping, `rootName()` on `co.uk`-style multi-level TLDs |

We do **not** require the keyword baseline to pass multilingual/exotic cases — those are labeled `baseline:expected-fail` and exist to (a) prove the LLM earns its cost and (b) prevent silent English-only regressions. The CI gate distinguishes "must pass" cases from "documented baseline misses."

### Building the corpus without storing real user mail

Privacy is the brand; the corpus cannot become a shadow inbox. Three sourcing channels, in priority order:

1. **Synthetic (primary).** Author templates per ATS and per status/locale, fill with fake company/role/name slots from a fixture dictionary. Use an LLM offline to *generate variants and translations* of real-world phrasing patterns, then a human labels/spot-checks. This is the bulk of the corpus, carries zero PII, and is freely committable to the (now-cleaned) public repo. Generation is reproducible from seeds so the corpus diffs are reviewable.
2. **Opt-in donated.** A consent-gated, explicit "donate this thread to improve classification" flow — never default-on, never silent. Donated threads pass through the **same anonymization pipeline** before they ever land in the corpus or any durable store.
3. **Anonymized.** A deterministic scrubber that: replaces person names/emails with tokens, hashes/zeroes `threadId`/message-ids, strips signatures and tracking links, truncates to the existing `BODY_CHARS=600` snippet, and runs a PII detector (names, phones, addresses) with a hard fail if residue remains. Output is reviewed by a human before commit. Anything that can't be cleanly scrubbed is dropped, not "best-effort kept."

A separate test asserts the anonymizer itself: feed it known-PII strings, assert the output contains none. The scrubber is security-critical code and gets unit + property-based tests (fuzz with generated PII).

## 14.3 Validating the LLM classifier against the keyword baseline

The LLM is a Pro-only, server-side **second pass** that escalates only low-confidence/ambiguous threads (`@pipeline/classify` runs first; see §10/§14 of the plan). It must be proven to *improve* outcomes without regressing the cases the keyword classifier already gets right. No LLM ships to Pro until it clears this gate.

### Metrics, per status, on the golden set

Run both classifiers over the corpus and compute, **per status** (`applied`/`interview`/`offer`/`rejected`):

- **Precision and recall per status** — aggregate accuracy hides that `offer` false-positives (telling someone they got an offer they didn't) and `rejected` false-positives are far more harmful than an `applied`/`interview` mix-up. Track them separately.
- **Confusion matrix** (4×4 + a `null`/"no-change" column) for both classifiers, side by side.
- **Cost-per-correct** for the LLM: dollars spent / additional correct classifications over baseline. The LLM has marginal cost (Haiku-class model); if it costs more per *net* correct answer than it returns in value, the escalation threshold is wrong.
- **Net regression count**: cases the keyword baseline got right that the LLM gets wrong. This number must be **zero on the "must-pass" set** to ship — the LLM may not break what regex already nails.

### Hard release bar for the LLM second-pass

| Gate | Bar |
|---|---|
| Regression on must-pass cases | 0 (any keyword-correct case the LLM breaks blocks release) |
| `offer` false-positive rate | ≤ keyword baseline, and absolute ≤ 0.5% on must-pass set |
| `rejected` false-positive rate | ≤ keyword baseline |
| Net correctness gain (overall) | strictly positive, driven by the multilingual/mixed-signal buckets the baseline fails |
| Cost-per-net-correct | within budget set in §14 (LLM) of the plan; logged per release |

### A/B on the low-confidence subset

Because the LLM only fires on low-confidence threads, that subset is where the matrix matters. Online, run a shadow/A-B: route a fraction of *consented* low-confidence threads through the LLM, log keyword-vs-LLM disagreements (status only, never raw body — the raw text sent to the LLM is never persisted, per the privacy rule), and surface disagreements for periodic human spot-labeling that feeds back into the golden set. The escalation confidence threshold is a tuned parameter, re-validated against the corpus whenever the model or prompt changes.

## 14.4 Cross-language parity — keeping TS and Python in sync

The hosted side collapses to one TS classifier (`@pipeline/classify`), but the **frozen local Python build keeps its own copy** of classification/mapping logic. That is two implementations of the same brain, and they *will* drift. The defense is a **shared golden corpus run in both CI lanes**.

- The corpus lives in one canonical location and is consumed by both the Node lane (Vitest) and the Python lane (`unittest`). Neither lane owns a private copy.
- Each lane loads every "must-pass" case, runs its own classifier, and asserts the produced `{ status, company, role }` exactly equals `expect`.
- A dedicated **parity job** in CI fails the build if the two lanes produce *different* outputs for the same input — not just if one is wrong against the label, but if they **disagree with each other**. Drift between the two implementations is itself a build break, independent of correctness.
- The existing `mappers.test.js` corpus is folded into this: the TS mappers under `@pipeline/contracts` (reimplementing `providers.py`'s raw→unified mapping) and the Python `providers.py` mappers must both reproduce the same unified shape from the same recorded raw fixtures.

```
corpus/  (single source)
  ├─ classify/*.json   → Node lane ✓ , Python lane ✓ , agree? ✓
  └─ mappers/*.json    → TS mappers ✓ , providers.py ✓ , agree? ✓
            ↑ disagreement = build failure
```

This is the mechanism that makes "one place classifies" survive the reality that there are physically two codebases. If the local Python build is ever allowed to genuinely diverge (it's frozen, so it shouldn't), the parity job is where we find out.

## 14.5 API and integration tests

- **Provider mapping replay.** Recorded (sanitized) Gmail/Graph/IMAP responses replayed through `providers` → assert unified contract via zod. No live API calls in CI.
- **Incremental sync correctness.** With mocked Gmail `users.history`/`watch` and Graph `delta`/subscriptions: assert first-connect does a full backfill, subsequent syncs use the stored cursor, a replayed history event produces exactly one record update, and subscription renewal fires before expiry. Explicitly regression-test against the old behavior — a test asserts we do **not** re-search a year of mail per sync.
- **Token store.** Integration test against ephemeral Postgres asserting tokens are written **envelope-encrypted** (per-row data key, master in KMS) — read the raw row, assert it is not plaintext and not base64-decodable to a token. A token in plaintext at rest is a release-blocking failure, full stop.
- **"No raw mail persisted" invariant.** A guard test runs a full sync of a fixture inbox, then scans every durable store (Postgres rows, Redis, logs) for known raw-body sentinel strings planted in the fixtures. Any hit fails the build. This is the automated enforcement of the privacy brand and the strongest CASA/GDPR evidence we can produce.
- **OAuth state & multi-process.** Test that OAuth `state` survives across workers (it must move out of the in-memory `_pending = {}` that only worked single-process in `server.py`). A test that spins two API instances and completes a callback on the instance that didn't start the flow.
- **Webhook → license issuance.** Mocked Lemon Squeezy/Paddle webhook → assert Ed25519-signed token issued, signature verifies against the embedded public key, tampered token rejected, and subscription claim gates the correct Pro features server-side.
- **Idempotency & quota.** Replayed duplicate push notifications produce no duplicate records; rate-limit buckets (Upstash) shed load as configured.

## 14.6 Security tests

| Test | Asserts |
|---|---|
| Static allowlist / file-serve | The hosted equivalent of `server.py`'s allowlist still refuses `config.json`, `.pipeline-accounts.json`, `.git`; no generic file serving |
| Secret scanning | CI gitleaks/trufflehog on every push; **plus a one-time history scrub verification** that `business/OPEN-CORE-SPLIT.md` and the strategy docs are gone from history (see §15 leak remediation) |
| Token-at-rest | Covered in §14.5 — plaintext token at rest blocks release |
| SSRF / OAuth redirect | Redirect URIs and any user-influenced fetch are allowlisted; callback `state` and PKCE verified |
| Authz boundaries | A user cannot read another user's accounts/records; Pro features 403 without subscription claim; Teams cohort dashboards never expose inbox content (assert aggregate-only) |
| Session security | httpOnly + secure + SameSite cookies (Clerk); CSRF on state-changing endpoints |
| Dependency / SCA | `npm audit` + `pip-audit` (frozen Python build) + Dependabot; high-sev blocks |
| LLM data handling | Raw body sent to the model is never logged or persisted; only consented text is sent |
| PII scrubber | The corpus anonymizer leaves zero PII (property/fuzz tested) |

Run an external **security review on the diff** (the `security-review` skill) before any public multi-user launch milestone, in addition to the automated gates — restricted-scope mail handling justifies a human pass.

## 14.7 Performance and regression

- **Classifier batch latency.** Microbenchmark `@pipeline/classify` over the full corpus; assert per-thread classification stays sub-millisecond and total batch time doesn't regress >10% between releases (it's pure, dependency-free — it should stay fast).
- **Sync backfill throughput.** Measure first-connect backfill against a mocked large mailbox; assert it completes within target and respects provider rate limits. This is the workload that replaces the old 200/300/1000-message caps and must scale.
- **API p95.** k6 against the hosted API for board fetch and sync-trigger endpoints under representative concurrency.
- **Regression suite = the golden corpus + recorded fixtures.** Any change to `classify.js`/`@pipeline/classify` re-runs the full corpus; the diff in pass/fail per bucket is posted to the PR. A case that flips from pass→fail blocks merge unless explicitly re-baselined with justification.

## 14.8 Mobile and accessibility

- **Mobile (companion-only).** Tests assert the app **never scans a mailbox on-device** — it reads server-derived records over the hosted API. E2E covers: cold start → board renders from API, deep-link hand-off to web for OAuth/billing/deletion, offline/stale-cache behavior. No *status classification or mailbox scanning* runs client-side on mobile — `detectStatus`, all sync logic, and OAuth-token custody are server-only. (The only `@pipeline/classify` code allowed to execute on-device is pure display helpers — e.g. `cleanCompanyName`/`rootName` for label normalization — which touch no mailbox and make no network call.) A CI test asserts the mobile bundle does not import `detectStatus` or any sync/scan path.
- **Accessibility (web board).** axe-core in Playwright on the board, plus a manual keyboard-only and screen-reader pass (the dark-theme board's color-coded statuses — gray/yellow/green/red — must not rely on color alone; status needs a text/aria label). Target WCAG 2.1 AA before public launch.

## 14.9 Manual QA checklist (pre-release)

Run on web (hosted), desktop (Electron), and the static demo build:

- [ ] Sign in (Clerk) on a fresh account; session cookie is httpOnly/secure.
- [ ] Connect Gmail via incremental consent; restricted-scope grant requested **only** at connect, not at sign-in.
- [ ] Connect Outlook.com (OAuth mandatory — MS killed app-password IMAP for personal in 2024); refresh-token rotation persists.
- [ ] First connect does a full backfill; second sync uses the cursor (verify no year-long re-search via logs/metrics).
- [ ] Board renders all four statuses with correct colors **and** text labels; ATS-routed companies show the real employer, not "Greenhouse."
- [ ] Manual status override, pin, ignore persist (hosted: backend; local: localStorage keys `pipeline.*`).
- [ ] Multi-mailbox merge (Pro) shows one combined board.
- [ ] LLM second-pass (Pro) only fires on low-confidence threads; non-Pro never triggers it.
- [ ] CSV/PDF export (Pro) gated server-side; free account is refused.
- [ ] Disconnect/delete removes accounts, tokens, and derived records (GDPR/CCPA); verify rows actually gone.
- [ ] Mobile shows current board from API; "connect mailbox" deep-links to web.
- [ ] Demo/MockProvider build works with zero network and stores nothing.
- [ ] `SHOW_LOGOS` default off; enabling uses `referrerpolicy=no-referrer`.

## 14.10 UAT and bug triage

**User acceptance testing.** Because Google verification gates us to a ≤100 test-user allowlist until CASA/verification clears, UAT runs in two phases: (1) a private allowlist beta of real job-seekers on the hosted app under the unverified-app cap, with a structured feedback form focused on classification correctness ("was any card mislabeled?" feeds donated/anonymized corpus cases), and (2) a friends-and-family desktop beta that needs no verification. UAT sign-off requires the manual checklist green on all three run modes and zero open P0/P1 bugs.

**Bug triage.**

| Severity | Definition | Response |
|---|---|---|
| **P0** | Security/privacy: token leak, raw mail persisted, cross-user data access, billing charge error, leak of strategy docs | Stop-ship; hotfix immediately; release-blocking |
| **P1** | Core brain wrong at scale (systematic misclassification), sync broken, OAuth/refresh broken, data loss on disconnect | Block release; fix before merge to main |
| **P2** | Single-case misclassification, UI defect, perf regression within tolerance | Triaged into corpus/backlog; batched |
| **P3** | Cosmetic, copy, nice-to-have | Backlog |

Misclassification reports are first-class: every P1/P2 classification bug becomes a labeled corpus case (synthetic if it carries PII, anonymized if donated) so the regression suite grows to cover it permanently. The classifier's test corpus is the institutional memory of every wrong card we've ever shipped.

## 14.11 Minimum coverage before launch

These are the bars that **block a public multi-user launch**. Below them, we do not ship beyond the test-user allowlist.

| Area | Minimum bar |
|---|---|
| `@pipeline/classify` line/branch coverage | ≥ 90% line, ≥ 85% branch (it's pure and central — no excuse) |
| Classifier golden corpus | ≥ 500 labeled cases across all axes in §14.2; every ATS in `ATS_DOMAINS` represented; ≥ 5 locales |
| Cross-language parity | TS and Python lanes agree on **100%** of must-pass cases; disagreement = build break |
| LLM second-pass (if shipping) | Clears the §14.3 hard release bar (0 must-pass regressions, `offer` FP ≤0.5%) |
| "No raw mail persisted" invariant | Automated guard passing; sentinel scan clean across all durable stores |
| Token-at-rest | Envelope-encryption integration test passing; no plaintext/base64 token at rest |
| Authz boundaries | Cross-user access tests passing; Pro/Teams gates enforced server-side |
| Leak remediation verification | `business/` strategy docs confirmed purged from git history; 14 MB media moved out of MIT repo |
| E2E happy path | Sign-in → connect (mocked) → board → override → export green on web; companion read-path green on mobile |
| Legal/compliance | `PRIVACY.md`/`TERMS.md` finalized with counsel + real contact; Google restricted-scope verification path underway; MS publisher verification done — none of these are "tests" but all are launch gates (§16) |
| Accessibility | axe-core no critical violations; status not color-only |
| API integration coverage | ≥ 80% on `apps/api` core routes (auth, sync, accounts, billing webhook) |

The single most important line in this table: **the cross-language parity gate at 100% and the "no raw mail persisted" invariant are absolute.** A drift in the brain or a single persisted raw body is not a bug to file — it is a release that does not happen.

---

# 15. DevOps and Deployment Plan

This section assumes the monorepo, stack, and split locked in the Canonical Decisions Brief: a Turborepo/pnpm workspace; hosted web on Vercel; Fastify API + sync/renewal workers on Fly.io; Neon Postgres; Upstash Redis; Clerk identity; an Ed25519-licensed desktop build via `electron-builder`; and an Expo/RN companion app. The governing constraint is that this is **one repo with two release trains that ship on different clocks and to different audiences**, and a solo founder operating it. Everything below optimizes for that: low idle cost, few moving parts, and automation that prevents the exact failure modes already present in the codebase (the `business/OPEN-CORE-SPLIT.md` leak, unsigned binaries, full-rescan quota burn).

## 15.1 The two release trains (the framing everything else hangs on)

| | Train A — Open local/desktop | Train B — Hosted web + mobile |
|---|---|---|
| Artifact | `electron-builder` dmg/nsis (current build) + optional AppImage; static `index.html`/`classify.js` local server | `apps/web` (Vercel), `apps/api` + workers (Fly.io), `apps/mobile` (App Store / Play) |
| Audience | OSS users, privacy-first, the funnel | Paying Pro/Teams users |
| Cadence | Slow, tagged releases (`v1.4.0`), no urgency | Continuous; merge-to-`main` deploys |
| Source visibility | **Public MIT repo** | **Private packages** (gated Pro/Teams code) |
| Trust requirement | Apple Developer ID + notarization, Windows Authenticode | TLS, no signing; secrets + token custody |
| Breakage blast radius | A user must re-download; no live outage | Live multi-user outage, billing, mail sync |

These are different risk profiles. Train A's nightmare is shipping a malware-flagged unsigned binary or leaking strategy docs into a public repo. Train B's nightmare is a token-store breach or a sync worker that DDoSes Gmail and gets the OAuth app suspended mid-CASA. The CI/CD must treat them as **separate pipelines triggered by separate events** (a git **tag** for Train A; a push to `main` touching `apps/web`/`apps/api`/`apps/mobile` for Train B), even though they live in one repo.

## 15.2 Environments

| Env | Purpose | Web | API + workers | DB | Identity / OAuth |
|---|---|---|---|---|---|
| **dev** | Local laptop | `vite dev` | `fastify` local + local Redis (or Upstash dev DB) | Neon dev branch | Clerk dev instance; Google **test-user allowlist** |
| **preview** | Per-PR ephemeral | Vercel preview URL | Fly.io ephemeral app (or shared `staging` API behind a flag) | **Neon branch per PR** (copy-on-write) | Clerk dev; mocked mail providers by default |
| **staging** | Pre-prod mirror | `staging.` Vercel project | Fly.io `pipeline-api-staging` | Neon `staging` branch | Clerk staging; **real** Google/MS OAuth under test-user allowlist |
| **prod** | Live | `app.pipeline.…` | Fly.io `pipeline-api` (≥2 instances) | Neon `main` (PITR on) | Clerk prod; **verified** Google/MS apps (post-CASA gate) |

Two things to call out. First, **Neon database branching is the single biggest leverage point** for a solo founder: each PR gets a real copy-on-write Postgres branch, so preview deploys run migrations against production-shaped schema without touching prod data, and the branch is torn down on PR close. This is what makes "preview" honest rather than a sqlite toy. Second, **prod is the only environment allowed to touch a verified Google/MS OAuth app and real user mailboxes.** dev/preview default to mocked providers; staging uses the test-user allowlist (≤100 users) so you can rehearse the real OAuth + restricted-scope flow without exposing real customers before CASA clears (§16).

## 15.3 CI/CD — extending the existing GitHub Actions

The repo already has `build.yml` and `test.yml`. They assume a flat, single-language project and will not survive the monorepo. The migration is **make CI monorepo-aware via Turborepo affected-graph + pnpm, add the parity gate, add deploy via OIDC, add secret scanning** — not a rewrite from scratch.

**Workflow topology (replace the two existing files with five):**

| Workflow | Trigger | Job |
|---|---|---|
| `ci.yml` | PR + push to `main` | Lint, typecheck, unit tests, **golden-corpus parity** (below), build all affected packages via `turbo run … --filter=...[origin/main]` |
| `secret-scan.yml` | PR + push (and a nightly full-history scan) | gitleaks/trufflehog + a custom check that **fails if any tracked path matches `business/**` or contains the "do NOT commit" sentinel** |
| `deploy-web.yml` | push to `main`, paths `apps/web/**`, `packages/**` | Vercel deploy (prod) via Vercel's own Git integration or CLI w/ OIDC |
| `deploy-api.yml` | push to `main`, paths `apps/api/**`, workers, `packages/**` | `flyctl deploy` via **GitHub OIDC** (no long-lived Fly token) |
| `release-desktop.yml` | **tag push** `v*` | `electron-builder` matrix (macos/win/linux) + sign + notarize + GitHub Release |

**Monorepo awareness.** Turborepo's remote cache + `--filter` against the merge-base means a PR that only touches `apps/mobile` does not rebuild the API or re-run the desktop matrix. This keeps CI minutes (and your bill) proportional to the change. Concretely the core CI step is:

```
turbo run lint typecheck test build --filter='...[origin/main]'
```

**The golden-corpus parity job is non-negotiable and is the linchpin of Decision #5.** The hosted side collapses classification into one TS package `@pipeline/classify`, but the **free local Python build keeps its own frozen copy** of the classifier (it's a separate artifact). That is two implementations of the product's brain, and they *will* drift. The gate:

1. A shared fixtures directory `fixtures/golden/*.json` — each is a unified-shape thread plus expected `{status, company, role}`.
2. **Node lane:** run `@pipeline/classify` over every fixture, assert exact match. This also covers what `classify.test.js` (131 lines) and `mappers.test.js` (163 lines) test today, now pointed at the package.
3. **Python lane:** run the frozen local classifier (the `providers.py`/`detectStatus` logic as it exists in the MIT build) over the *same* fixtures, assert the *same* expected output.
4. CI fails if either lane disagrees with the golden file. **Drift between trains is a red build, by construction.**

This is the only thing standing between you and the "two classifiers silently disagree, and a user's offer shows up as `applied` on desktop but `offer` on web" support nightmare. Note the brief's correction: `providers.py` is a raw→unified **mapper**, not a classifier twin, so the parity corpus has two distinct assertion sets — mapper output (raw provider payload → unified shape, validated by the `mappers.test.js` corpus) and classifier output (unified shape → `{status, company, role}`).

**OIDC deploy, no static cloud keys.** Both `deploy-api.yml` and `deploy-web.yml` authenticate to Fly.io/Vercel via GitHub OIDC short-lived tokens, not a `FLY_API_TOKEN` secret sitting in repo settings forever. This is the correct posture given that the same org also owns the public repo — a leaked classic token is a hosted-infra breach.

## 15.4 Secret scanning — closing the `business/` leak permanently

The repo has a **live, committed strategy leak**: `business/OPEN-CORE-SPLIT.md` is headed "Internal planning doc. Local only — do NOT commit to the public repo." and is git-tracked and public, exposing pricing, moat reasoning, and the tier plan. Per Decision #15 the remediation (history scrub + move ~14 MB of marketing media out of the MIT app repo) is a **release gate**. DevOps's job is to make the leak **unrepeatable**:

- `secret-scan.yml` runs gitleaks **and** a custom path/sentinel check. Any file under `business/**`, or any file containing the literal "do NOT commit" sentinel, **fails the build**. This is a structural guard, not a process promise.
- A `pre-commit` hook (committed, opt-in but documented) runs the same scan locally so the founder gets the failure before pushing.
- GitHub native **push protection + secret scanning** enabled on the public repo.
- A **nightly full-history** trufflehog scan, because the dangerous secrets (mail OAuth client secrets, Fly tokens) would be catastrophic and history-rewriting after the fact is expensive — you want to know the same day.

## 15.5 Database migrations

| Decision | Choice |
|---|---|
| Tool | **Drizzle ORM + drizzle-kit** (TS, lives in `@pipeline/contracts` adjacency; schema is code, shares types with API) |
| Workflow | `drizzle-kit generate` produces a versioned SQL migration file, committed and reviewed in the PR; `drizzle-kit migrate` applies it |
| Where applied | Migrations run **as a discrete CI step against the Neon PR branch** in preview, against `staging` branch pre-merge, and as a **release step in `deploy-api.yml` before the new API instances take traffic** |
| Safety rule | **Expand → migrate → contract.** No destructive column drop in the same deploy that ships the code change. Add new, dual-write/backfill, switch reads, drop old in a *later* release. Mandatory because the token rows and derived-record tables are load-bearing and Fly does rolling restarts. |

Drizzle over Prisma here: lighter, no separate engine binary, SQL-first migrations you can read and PITR-reason about, and it shares the TS toolchain. The migration runs **before** the rolling deploy completes and is gated on success — a failed migration aborts the deploy and the old instances keep serving.

## 15.6 Secrets management

| Layer | Mechanism |
|---|---|
| CI → cloud | **GitHub OIDC** (Fly/Vercel), no long-lived tokens in repo |
| Runtime app secrets | `fly secrets set` (Fly's encrypted secret store) for API/workers; Vercel encrypted env vars for web |
| **Mail OAuth tokens (the crown jewels)** | **Envelope encryption** (Decision #9): per-row libsodium `crypto_secretbox` data key, wrapped by a master key in a managed **KMS** (e.g. cloud KMS / Fly + KMS). **Never** plaintext or base64 at rest — the desktop base64 fallback is local-only and out of scope here. |
| Signing keys | Apple Developer ID cert + Windows code-signing cert + the **Ed25519 license-issuer private key** live in GitHub Actions encrypted secrets / a dedicated secrets manager, **never** in the repo. The Ed25519 **public** key is the only key embedded in app builds. |
| LLM API key | Server-side only, Fly secret, never shipped to web/mobile/desktop (Decision #14). |

The brief is explicit that the **hosted token store fixes the codebase's current gap**: today `.pipeline-accounts.json` is `chmod 0600` but **not encrypted at rest**, acceptable only for local-single-user. Hosted is non-negotiably envelope-encrypted so a Postgres dump or Neon branch leak doesn't hand over live mailbox access. KMS-held master key means **rotation without re-reading every row**.

## 15.7 Monitoring, logging, error tracking, uptime

| Concern | Tool | Notes |
|---|---|---|
| Error tracking | **Sentry** across `apps/web`, `apps/api`, `apps/mobile` | Source maps uploaded in CI; release tagged with the git SHA so errors map to a deploy |
| Structured logging | **pino** (Fastify-native) → Fly's log stream → a cheap log sink (Better Stack / Axiom free tier) | **Never log raw email bodies, tokens, or the 600-char snippet content.** Log thread IDs and derived status only. This is a privacy-brand requirement, not a nicety. |
| Metrics that matter | Per-account **sync lag**, **Gmail/Graph API quota consumption**, subscription/`watch` **expiry countdown**, queue depth (Upstash), classifier **LLM escalation rate** + cost | Quota is the operational kill-switch: the old full-rescan design burned quota; the new incremental design (§ Decision #10) must be *watched* so a regression doesn't silently reintroduce it and trip Google's abuse limits |
| Uptime | **Better Stack / UptimeRobot** hitting `/healthz` (API) and a synthetic web check; **plus** an internal cron that alerts if any Gmail `watch` / Graph subscription is within N hours of expiry and not renewed | The expiry monitor is specific to this product — a missed renewal silently stops sync for that user with no error |
| Alerts | Sentry → email/Slack; PagerDuty is overkill for a solo founder, but a single high-signal channel is mandatory | |

The subscription-expiry monitor deserves emphasis: push-driven sync (Decision #10) replaces the old "full re-read every time" model, but its failure mode is *silent* — a subscription lapses and that user just stops getting updates. Uptime monitoring of a URL won't catch it; you need an internal job asserting "every active account has a non-expired, renewed subscription cursor."

## 15.8 Rollbacks and backups

**Rollbacks.**
- **Web (Vercel):** instant promote of the previous immutable deployment. Zero-cost, one click/CLI.
- **API/workers (Fly):** `flyctl releases` keeps prior images; `flyctl deploy --image <prev>` or roll back to the prior release. Combined with the expand/contract migration rule, a code rollback never strands the DB schema.
- **Migrations:** because we never drop in the same release, a code rollback is always safe against the *current* schema. A *bad migration* is recovered via Neon PITR (below), not via a down-migration (down-migrations on prod data are a trap).

**Backups — Postgres PITR.**
- **Neon provides point-in-time restore** via continuous WAL retention. Set retention to the maximum the plan affords (target ≥7 days, ideally 30 for GDPR/incident windows).
- **Restore drill:** quarterly, restore `main` to a throwaway Neon branch and verify the API boots and token-decryption works against it. An untested backup is not a backup — and here the restore must specifically prove the **KMS-wrapped tokens still decrypt** post-restore.
- **Logical export:** a weekly `pg_dump` of the **derived-records schema only** (never raw mail — there is none persisted, by design, Decision #11) to cold storage, as defense-in-depth against a provider-level Neon failure.
- **GDPR/CCPA delete:** account deletion must purge derived records + tokens **and** be reflected in backups within the retention window; document this in PRIVACY.md (§16). PITR retention is therefore also a *privacy liability ceiling* — don't retain longer than you can justify.

## 15.9 Train A — open desktop release (electron-builder, signing, notarization)

This is the train with the **largest gap versus today**: packaging is `electron-builder` but **unsigned and unnotarized**. Shipping that publicly means macOS Gatekeeper blocks it ("damaged / unidentified developer") and Windows SmartScreen flags it — fatal for a privacy-brand product asking users to grant mailbox access. Fixing it is a hard prerequisite for any public desktop GA.

| Platform | Requirement | Mechanism in `release-desktop.yml` |
|---|---|---|
| **macOS** | Apple **Developer ID Application** cert + **notarization** + stapling | `electron-builder` with `CSC_LINK`/`CSC_KEY_PASSWORD` (cert from CI secret), `notarize: true` via Apple API key (`APPLE_API_KEY`/`ISSUER`/`KEY_ID`); `xcrun stapler` on the dmg. Requires a **$99/yr Apple Developer** account. |
| **Windows** | **Authenticode** code signing | Cert from CI secret (OV cheap but SmartScreen reputation builds slowly; EV / Azure Trusted Signing avoids the SmartScreen warning window). Sign nsis + the binary. |
| **Linux** *(optional — not in the current electron-builder config, which targets dmg/nsis only)* | AppImage (no OS signing) | Publish checksums + (optionally) GPG-sign the release assets. |

**Workflow shape:** tag `v1.4.0` → matrix build on macos/windows/ubuntu runners → sign + notarize per-OS → attach artifacts + **SHA-256 checksums** to a GitHub Release → optional `electron-updater` feed for auto-update. The desktop build also **embeds the Ed25519 public key** for license verification (Decision #13) — the issuer private key never touches this workflow's outputs, only the verifier.

This train is **tag-driven, not push-driven**: the OSS desktop build releases on an intentional cadence (release train, §15.11), decoupled from the continuous hosted deploys. A push to `main` must never accidentally cut a desktop release — only an annotated `v*` tag does.

## 15.10 Mobile app store release process

The mobile app is **companion-only** (Decision #2): it reads server-derived records over the hosted API and **never scans a mailbox on-device**. This materially simplifies store review — no on-device OAuth to Google/Microsoft restricted scopes, no per-platform restricted-scope verification, and a cleaner privacy-nutrition-label story.

| Stage | iOS | Android |
|---|---|---|
| Build | **EAS Build** (Expo) | EAS Build |
| Internal test | **TestFlight internal** (instant, no review) → external (needs review) | **Play internal testing track** (fast) → closed → open |
| Submit | `eas submit` → App Store Connect | `eas submit` → Play Console |
| Review timeline | Typically ~24–48h, occasionally longer; **plan for it** | Hours to a few days; first submission slower |
| Cadence | Ship JS-only fixes via **EAS Update (OTA)** to skip review where Apple/Google policy allows; binary changes go through review | Same OTA strategy via EAS Update |

Two operational notes. First, **EAS Update lets you OTA-patch JS/asset changes** without a store round-trip, which is how you keep mobile in lockstep with the shared `@pipeline/contracts`/`@pipeline/classify` packages when a contract field changes — but native-module or permission changes still require a reviewed binary, so version the API contract defensively (§15.11). Second, because mobile depends on the hosted API contract, **a breaking API change must be backward-compatible across the time it takes the slowest user to update the binary** — you cannot force-update an app store binary on your schedule. This makes API contract versioning a mobile-release concern, not just a backend one.

## 15.11 Versioning strategy

**Independent semver per train; contracts versioned across both.**

| Thing | Versioning |
|---|---|
| `@pipeline/contracts`, `@pipeline/classify` | **Semver, the source of truth.** A breaking change to the unified shape `{ threadId, domain, subject, messages[] }` or to `{status, company, role}` output is a **major** bump and triggers the parity gate + a contract-compatibility review. Changesets to manage versions/changelogs in the monorepo. |
| Desktop (Train A) | Semver git tags `vX.Y.Z`, **release-train cadence** (e.g. monthly or on meaningful feature batches). Slow, deliberate, tagged. |
| Hosted web/API (Train B) | **Continuous**; "version" is the git SHA + a Sentry release tag. No marketing version needed; rollback is by deploy, not by version number. |
| Mobile | Store `version` (semver) + monotonic `buildNumber`; **API contract version negotiated at runtime** so an old binary keeps working against a newer API. |
| **Public HTTP API** | Explicit `/v1/` prefix. The contract is consumed by a mobile binary you cannot force-update — so **additive-only within `/v1/`**, breaking changes go to `/v2/` with `/v1/` kept alive through a deprecation window. |

The discipline that ties it together: `@pipeline/contracts` is the **single versioned definition of the wire shape and the classifier output**, consumed by web, mobile, desktop (frozen copy gated by parity), and the API. A bump there is the one event that ripples across *both* trains, and the golden-corpus parity job (§15.3) is the mechanism that makes such a bump safe rather than a silent cross-train divergence.

## 15.12 Build-order / first-90-days sequencing for DevOps

Because the brief is execution-ready, the DevOps work has a strict dependency order:

1. **Leak remediation + secret-scan gate first** (§15.4). Nothing else ships publicly while `business/OPEN-CORE-SPLIT.md` is live. History scrub, media moved out, `secret-scan.yml` enforcing it — done before any new public commit.
2. **Monorepo CI rebuild + parity gate** (§15.3) — the foundation every train builds on.
3. **Neon branching + Drizzle migrations + envelope-encrypted token store** (§15.5–15.6) — before the hosted API touches a real token.
4. **Fly deploy via OIDC, staging on the test-user allowlist, monitoring + expiry watcher** (§15.7) — before any hosted multi-user traffic.
5. **Desktop signing/notarization** (§15.9) — before public desktop GA, in parallel since it's a separate train.
6. **Mobile EAS pipeline** (§15.10) — last, since it depends on a stable hosted API contract.

Steps 1–2 gate *everything*; steps 3–4 gate the hosted launch and must land before the Google CASA / Microsoft verification sequencing in §16; step 5 gates desktop GA independently. None of this is optional polish — each item closes a concrete, named gap in the current codebase.

---

# 16. Team and Role Breakdown

This section maps the work in this plan to three staffing realities. The throughline: the codebase is small (~3,600 lines) and AI coding tools will move you fast on it, but the things that can *kill* this product — Google restricted-scope verification, CASA, Microsoft publisher verification, token-at-rest custody, and the privacy/legal posture — are precisely the areas where AI and contractors are most dangerous. The leak already in the repo (`business/OPEN-CORE-SPLIT.md`, git-tracked despite "do NOT commit") is a live demonstration that the founder, not a tool, has to own this.

## What AI coding tools do well vs. badly *on this specific codebase*

Be honest about where leverage is real. This is not generic.

| Task | AI tooling verdict | Why, grounded in the code |
|---|---|---|
| Reimplement `classify.js` → `@pipeline/classify` (TS) | **Excellent** | 236 lines, pure, dependency-free, already dual-runtime, already unit-tested (`test/classify.test.js`). The golden corpus is the spec. AI ports this in an afternoon. |
| Port `providers.py` mappers → TS (`@pipeline/contracts`) | **Excellent** | Raw→unified mapping is mechanical; `mappers.test.js` (163 lines) is the oracle. AI is good at "make these fixtures pass." |
| Rebuild `index.html` (1,394 lines) as React+TS+Vite | **Good** | It's 76 KB of vanilla JS with a clear data contract and three Provider modes. AI scaffolds components fast. Watch for it inventing state libraries you don't need. |
| Fastify API skeleton, zod DTOs, Neon/Drizzle schema | **Good** | Boilerplate-shaped. AI produces it quickly and competently. |
| Gmail `users.history` + `watch`/Pub-Sub, Graph `delta` + subscription renewal | **Mediocre / dangerous** | This is where AI confidently writes plausible-but-wrong sync. `historyId` gaps, expired subscriptions, lost cursors, Pub/Sub redelivery semantics — AI hallucinates the edge cases. Treat all generated sync code as a draft to be tested against real mailboxes. |
| Envelope encryption (libsodium `crypto_secretbox`, KMS-wrapped DEK) | **Use AI to write, NEVER to design or trust** | AI will happily produce code that "encrypts" with a hardcoded key, a deterministic nonce, or no authentication. The pattern must be specified by the founder; the implementation must be reviewed line-by-line. |
| OAuth scope minimization, consent screen config, verification submissions | **Bad — do not delegate to AI at all** | These are not coding tasks. AI does not know the current state of Google's CASA Tier 2 requirements or Microsoft publisher verification; it will produce confident, outdated, or fabricated answers. This is human research against live policy docs. |
| `PRIVACY.md` / `TERMS.md` finalization | **Bad** | AI drafts read fine and create false confidence. These are legal instruments needing counsel, not autocomplete. |
| Leak remediation (git history scrub of `business/`) | **Use AI for the commands, founder verifies** | `git filter-repo` invocation is easy to generate; whether the secret is *actually* gone from all refs/forks/caches is a judgment call the founder must confirm. |

The pattern: **AI is excellent at the bounded, test-anchored majority of the build and untrustworthy on exactly the four things that gate launch** — sync correctness, token custody, OAuth verification, and legal posture.

---

## (a) Solo founder + AI tools — the realistic case

This is the assumed scenario. You are the architect, the IC, and the compliance officer. AI tools are your junior engineers; they are fast, tireless, and occasionally confidently wrong in ways that create liability.

**What the founder personally does (cannot be handed off, even to AI):**

| Area | Why founder-owned |
|---|---|
| **The security model** | Token-at-rest is the crown jewels. You decide the envelope-encryption design (per-row DEK, KMS-wrapped master, nonce discipline, rotation story), and you read every line of the implementation. The desktop base64 fallback is fine *only* because it's local-only; the hosted build has no such excuse. If you don't understand it, you can't defend it. |
| **OAuth scope + verification strategy** | `gmail.readonly` is a Google **restricted** scope. Public launch requires app verification and a likely **CASA Tier 2** assessment by a Google-approved third party. Microsoft needs **publisher verification**. These are sequenced gates with lead times measured in weeks-to-months. The founder owns the timeline, the submissions, and the data-minimization story that CASA reviewers will scrutinize. |
| **Privacy posture as product** | "Store derived records, not raw mail" (≤600-char snippet only, raw text in-flight only) is the brand *and* the CASA defense. The founder enforces this in architecture review — it is the one invariant AI will silently violate by, e.g., logging full bodies "for debugging." |
| **Legal finalization (with counsel)** | `PRIVACY.md`/`TERMS.md` are drafts with placeholder contact info. The founder engages a lawyer, supplies the real data-flow facts, and ships a real contact before any multi-user launch. |
| **Leak remediation decision** | The founder decides `business/` is purged from the public MIT repo and history-scrubbed, and that the ~14 MB of media moves to a separate asset repo/CDN, before further public work. This is a release gate, not a backlog item. |

**What AI tools carry (founder reviews):** the classifier port, the contracts/mappers, the React rebuild, the Fastify/Neon/Upstash scaffolding, the Clerk integration wiring, the license-token verify (Ed25519) glue, CSV/PDF export, most of the UI. This is the bulk of the line-count and the bulk of the velocity.

**Where the solo founder gets in trouble:**
- Letting AI design the sync layer and trusting it. Incremental sync (`historyId`/`delta` + subscriptions) is the one subsystem where a confident hallucination silently drops or duplicates user data. Budget real time to test against live Gmail/Graph accounts, not just fixtures.
- Treating CASA as a last-minute checkbox. It's a sequenced dependency; discover its requirements *before* you build sync, because data-minimization decisions (don't persist raw bodies, don't over-request scope) are the things CASA grades.
- Skipping the leak fix because "it's just a planning doc." It's pricing, moat, and monetization strategy, public and git-tracked. It costs you nothing to fix now and credibility later if a competitor or HN finds it first.

**Biggest time-wasters in this scenario:** rebuilding the local Python build (it's frozen — leave it), over-engineering the license DRM (moat is convenience + B2B compliance, not copy-prevention), and bikeshedding the React component library before the API even returns real data.

---

## (b) Small team — founder + 1–2 engineers (or one contractor)

You add hands but the founder-owned list above does **not** shrink. Delegate by *boundedness and reversibility*, not by line count.

| Role | Owns | Skills |
|---|---|---|
| **Founder** | Security model, OAuth/CASA/MS verification, privacy posture, legal+counsel liaison, leak remediation, open-core split design, the `@pipeline/classify` and `@pipeline/contracts` invariants. | Architecture; enough crypto literacy to review envelope encryption; willingness to read live policy docs. |
| **Full-stack TS engineer** | `apps/web` React rebuild, `apps/api` Fastify endpoints, Neon/Drizzle schema, Upstash queue wiring, analytics (Pro), reminders, export. | React+TS+Vite, Node/Fastify, Postgres, queues. |
| **Contractor (scoped, optional)** | The mobile Expo companion (read-only, server-derived records — never scans on-device), or a one-off design pass. | Expo/RN; design tokens, not bespoke rendering. |

**Safe to outsource:** mobile companion app, design system / `ui-web` polish, the React rebuild itself, CSV/PDF export, marketing-site/CDN migration of the `business/` media. All of these are bounded, testable, and carry no compliance liability.

**Must NOT be outsourced (founder retains even with a team):**
- **OAuth client ownership and verification submissions.** The Google Cloud project, the OAuth consent screen, the CASA engagement, and the Microsoft publisher account stay in the founder's name and control. A contractor's account holding your restricted-scope grant is an unacceptable single point of failure and an attestation problem.
- **Token-at-rest crypto design.** A contractor may *implement* under spec, but the founder designs and reviews it. "We hired someone for security" is not a CASA answer.
- **The privacy invariant (no raw-mail persistence).** This must be enforced in code review by someone who treats it as inviolable. Put it in a CI check (grep/AST guard against logging `body`) so it survives staff turnover.

**Biggest team time-waster:** a second engineer touching the sync cursors and license-gating without the founder's review, producing data loss or a leaky Pro gate that's expensive to claw back. Gate those two subsystems behind founder review.

---

## (c) Professional engineering team — funded, 4–8+ people

Realistic only post-revenue or post-raise; included for completeness. The work doesn't get *bigger*, it gets *parallelized and hardened*. Over-staffing this 3,600-line core is itself a mistake — most of these roles are part-time or fractional until scale demands otherwise.

| Role | Owns | Notes |
|---|---|---|
| **Founder / Head of Product** | Privacy brand, open-core strategy, tier roadmap, final sign-off on security and compliance. | Still owns the posture; now has people to execute. |
| **Tech lead / backend** | Fastify API, sync workers, Neon schema, queue reliability, the `@pipeline/classify` parity gate across Node+Python CI lanes. | The hardest correctness work (sync) lives here. |
| **Frontend** | `apps/web`, `ui-web`, analytics dashboards, Teams admin. | Component app; design tokens shared, not rendering. |
| **Mobile** | `apps/mobile` Expo companion. | Strictly read-only of server records. |
| **Security / compliance lead (or fractional vCISO)** | Envelope encryption + KMS rotation, threat model, **CASA Tier 2 engagement**, pen-test coordination, incident response. | The role that justifies a hire the moment you go multi-user. |
| **Legal counsel (external)** | Finalize `PRIVACY.md`/`TERMS.md`, DPA for Teams/B2B, GDPR/CCPA delete-export flows. | External, not headcount. |
| **DevOps / SRE (fractional)** | Fly.io always-on workers, subscription-renewal cron, monitoring, secrets/KMS. | Subscriptions need a persistent listener — this is why hosting is hybrid, not pure serverless. |

**Even here, the founder cannot delegate:** the *decision* to ship to multi-user GA, which is contingent on Google verification + CASA + Microsoft verification being complete (until then, hosted runs under the ≤100 test-user allowlist). That gate is a business/legal judgment, not an engineering ticket.

**Biggest professional-team time-waster:** premature scale-out — NestJS-style ceremony, microservices, a custom auth stack instead of Clerk, a self-hosted Postgres instead of Neon. The architecture is deliberately lean (Fastify, managed Neon/Upstash, managed Clerk) precisely so a small team isn't doing undifferentiated infra work. A funded team's instinct to "build it properly" by adding layers is the fastest way to slow this product down.

---

## The one rule across all three scenarios

Everything that touches **mail OAuth tokens, restricted-scope access, raw email content, or legal/privacy claims** is founder-owned and human-verified — AI writes the code, the founder owns the model. Everything else — the classifier port, the React rebuild, the API scaffolding, the mobile companion, exports, analytics — is fair game for AI tools and contractors, because it's bounded, test-anchored, and carries no compliance liability. The line between "delegate" and "don't" in this codebase is not difficulty; it's blast radius.

---

# 17. Cost and Complexity Estimate

These numbers are planning-grade ranges for a solo founder building primarily with AI coding tools, on the stack the Canonical Brief locked (hosted Node/Fastify + React/Vite, mobile Expo companion, Neon Postgres, Upstash Redis, Fly.io workers, Clerk auth, Lemon Squeezy/Paddle MoR, Claude Haiku-class second-pass LLM). They assume one builder, near-zero idle infra, and the four-status derived-record model (no raw mail at rest). Where a range is wide, the width is the point — it reflects real unknowns (CASA vendor pricing, conversion rate, mailbox size distribution), not laziness.

Currency: USD. "Active user" = a user with at least one connected mailbox syncing in a given month.

## 17.1 Engineering complexity by workstream

Complexity is rated on build difficulty for a single AI-assisted developer, not lines of code. The existing app is ~3,600 lines; almost none of the hard work below exists yet. The current `classify.js` (236 lines) and `providers.py` (343 lines) are an asset for the *logic*, not the *system* — extracting and hardening them is cheap; everything around them (auth, incremental sync, billing, compliance) is where the cost lives.

| Workstream | Complexity | Why |
|---|---|---|
| Extract `@pipeline/classify` (TS) from `classify.js` + `@pipeline/contracts` (zod) | Low | Pure, dependency-free, already unit-tested. Mechanical port; the parity gate (§5) is the only subtle part. |
| Rebuild hosted frontend (React+TS+Vite) from `index.html` | Low–Medium | 1,394 lines of vanilla JS is small. Reimplementing the board/search/timeframe/sort is faster than untangling. State currently lives in localStorage — moving it server-side is the real work, not the UI. |
| Fastify API + DTO validation + Provider abstraction | Medium | Straightforward, but it is the spine everything bolts onto. |
| Clerk identity + incremental mail-scope consent (§8) | Medium | Decoupling sign-in from `gmail.readonly` grant is the tricky bit; Clerk offloads MFA/recovery/org primitives. |
| Envelope token encryption + KMS rotation (§9) | Medium | libsodium `crypto_secretbox` is easy; key custody, rotation, and *not* logging plaintext is the discipline cost. |
| **Incremental push sync (Gmail history+watch / Graph delta+subscriptions)** | **High** | The single hardest piece. Pub/Sub wiring, per-account `historyId`/delta cursors, subscription renewal-before-expiry, replay/idempotency, partial-failure recovery. Replaces today's full-rescan. |
| Sync/renewal workers on Fly.io (always-on) | Medium–High | Persistent listeners + scheduled renewal + long first-connect backfills. Not a serverless fit (§12). |
| LLM second-pass escalation (§14) | Medium | Logic is small; the discipline is confidence-gating, cost caps, and never persisting the sent body. |
| Billing: MoR webhook → Ed25519 license / subscription claim (§13) | Medium | Webhook idempotency + offline-verifiable token issuance. Don't over-build DRM. |
| Analytics (funnel %, time-in-stage, response rate, digest) | High | "Expensive-to-build" in the tier table for a reason: needs status-history events modeled correctly from day one or it's un-backfillable. |
| Mobile companion (Expo RN, read-only) | Medium | Kept cheap *only because* it never scans on-device (§2). It is a thin client over the hosted API. |
| Teams: seat admin + opt-in cohort dashboards | High | Aggregate-only-never-inbox-content guarantees + admin surface. Defer past first launch. |
| **Leak + repo hygiene (§15)** | **Low effort, high urgency** | Git-history scrub of `business/OPEN-CORE-SPLIT.md` and moving ~14 MB media out is a day, but it is a release gate, not optional. |
| **Compliance: Google verification + CASA, MS publisher verification (§16)** | **Low code, high calendar** | Almost no engineering; weeks-to-months of external process and real money. The true critical path to GA. |

The asymmetry to internalize: the *code* is mostly Low/Medium. The two things that are genuinely High — **incremental push sync** and **compliance/CASA** — are also the two you cannot fake, skip, or AI-autocomplete your way through.

## 17.2 Time-to-MVP and time-to-launch

"Solo + AI tooling" compresses code authoring substantially but does **not** compress external review processes (Google/Microsoft/CASA), legal counsel turnaround, or the inherent serial nature of sync debugging against live mail APIs. Calendar weeks assume meaningful part-time-to-full-time effort, not 40h/week guaranteed.

| Milestone | Scope | Low | Expected | High |
|---|---|---|---|---|
| **MVP (private / test-user allowlist)** | Hosted web, single mailbox, Clerk auth, incremental Gmail sync, keyword classifier, derived records in Postgres, encrypted tokens. Runs under Google ≤100 test-user allowlist — **no verification yet**. | 6 wk | 10–12 wk | 16 wk |
| **Pro-feature complete (still gated/private)** | Multi-mailbox merge, LLM second-pass, reminders, analytics, export, billing/license gate, Graph delta sync. | +6 wk | +10 wk | +16 wk |
| **Mobile companion (beta)** | Expo read-only client over hosted API. | +3 wk | +5 wk | +8 wk |
| **Polished public multi-user launch (GA)** | Above **plus** leak remediation, finalized PRIVACY/TERMS with counsel + real contact, Google restricted-scope verification, **CASA Tier 2 assessment**, Microsoft publisher verification, store review (Apple/Play). | — | **5–9 months total** from start | 12+ months |

The gap between "code done" and "GA" is dominated by **CASA and OAuth verification**, which run on Google's and an assessor's calendar, not yours. Plan to operate productively under the test-user allowlist (≤100 users) for the entire pre-verification window — treat that as a feature of the rollout, not a blocker.

## 17.3 Infrastructure cost (monthly, hosted, small scale)

"Small scale" = roughly 0–1,000 active users. The architecture is deliberately serverless-priced so idle cost is near-zero; the step-ups come from always-on Fly workers and Postgres compute as sync volume grows.

| Component | Low (idle / pre-launch) | Expected (≈100–1,000 active) | High (scaling / heavy sync) | Notes |
|---|---|---|---|---|
| Fly.io API + sync/renewal workers (always-on) | ~$5–15 | $25–60 | $100–250 | Must be always-on for Pub/Sub listeners + pre-expiry subscription renewal (§12). The one component that is *not* scale-to-zero. |
| Neon Postgres (serverless) | $0–19 | $19–69 | $100–300 | Scales to zero when idle; compute + storage grow with derived records and status-history events. |
| Upstash Redis (queue + rate-limit) | $0–5 | $5–20 | $30–80 | Per-request priced; cheap until sync fan-out is heavy. |
| Vercel (web frontend) | $0 | $0–20 | $20–60 | Hobby may suffice early; Pro tier if bandwidth/seats demand. |
| Clerk (auth/identity) | $0 | $0–25 | $25–100+ | Free MAU tier covers early; per-MAU + Teams/org features cost more. |
| Cloud KMS (master key for envelope encryption) | ~$1 | ~$1–5 | $5–15 | Key storage is cents; cost is per-operation, and we wrap per-row data keys, not per-decrypt to the master. |
| Pub/Sub (Gmail push) | $0 | $0–5 | $5–20 | Generous free tier; volume-priced beyond. |
| **Infra subtotal (excl. LLM, excl. store/CASA)** | **~$10–40** | **~$75–220** | **~$300–800** | LLM and per-email costs are tracked separately in §17.5. |

The honest headline: **idle is ~$10–40/mo, real-but-small is under ~$250/mo.** This is well within "minimize hosting cost early." The architecture's whole point (incremental sync, derived records, scale-to-zero Postgres) is to keep this curve flat until paid conversion funds it.

## 17.4 Mobile + store + third-party fixed costs

| Item | Cost | Cadence | Notes |
|---|---|---|---|
| Apple Developer Program | $99 | Annual | Mandatory to ship the Expo companion to iOS/TestFlight. |
| Google Play Developer | $25 | One-time | Cheap; one-and-done. |
| Code signing / notarization (desktop) | $0–99 | — | macOS notarization rides the same $99 Apple account; current builds are **unsigned/unnotarized** and must be fixed before wide desktop distribution. |
| Merchant-of-Record (Lemon Squeezy / Paddle) | ~5% + ~$0.50/txn | Per transaction | No fixed monthly. MoR absorbs global VAT/tax compliance — worth the cut for a solo founder. |
| Domain + email + misc | $20–60 | Annual | Real contact for PRIVACY/TERMS lives here. |

**Mobile maintenance burden: deliberately LOW.** Because the companion never scans a mailbox on-device (§2), it carries no per-platform classifier fork, no per-platform restricted-scope grant, and no background-sync battery/permission fights. Its ongoing cost is OS/SDK churn (annual Expo + iOS/Android target bumps), store re-review, and keeping the read-only API client in step with the contract. The $99/yr Apple tax is the steady drip; the rest is occasional, not continuous.

## 17.5 LLM inference cost — the explicit Pro-tier justification

This is the cost that *justifies charging for Pro* (§14). The keyword classifier (`@pipeline/classify`) is free and runs first on every thread; the LLM only escalates **low-confidence/ambiguous** threads. That escalation gate is the entire cost-control story.

**Per-classified-email (only the escalated fraction hits the model):**

The input is one thread's text capped at `BODY_CHARS=600` per message snippet plus subject/from — call it ~300–800 input tokens, with a tiny structured output (~30–80 tokens: status, company, role, confidence). At Haiku-class pricing this is a *small fraction of a cent per escalated email* — order ~$0.0005–0.002 each.

| Variable | Low | Expected | High |
|---|---|---|---|
| Cost per escalated email | ~$0.0004 | ~$0.001 | ~$0.003 |
| Share of emails escalated (after keyword pass) | 10% | 20–30% | 50% |
| Job-related emails per active user / month | 30 | 80 | 200 |
| Escalated emails / user / month | ~3 | ~16–24 | ~100 |
| **LLM cost / active Pro user / month** | **~$0.001–0.01** | **~$0.02–0.05** | **~$0.30** |

Even at the pessimistic end, LLM cost per Pro user is **cents per month** against the paid-tier price — comfortably profitable. Two things keep it there: (1) **second-pass-only escalation** means the expensive model never touches the majority of unambiguous "thanks for applying" / "unfortunately" emails the regex layer already nails; (2) the 600-char snippet cap means each call is small by construction — we are not feeding full email bodies (which we don't even persist, per §11).

Risk to watch: a poorly-tuned confidence threshold that escalates 80–90% of mail collapses the margin. The threshold is a **cost lever, not just an accuracy lever** — instrument escalation rate per user and alert on drift.

## 17.6 Compliance cost — CASA is the real recurring liability

This is the cost line founders consistently underestimate, and the one that is unavoidable for a `gmail.readonly` restricted-scope app going multi-user.

| Item | Cost | Cadence | Notes |
|---|---|---|---|
| Google OAuth app verification (restricted scope) | $0 direct | One-time + on change | Free, but gated on a complete privacy policy, demo video, and domain verification. Slow. |
| **CASA Tier 2 assessment** (Google-approved third-party assessor) | **~$1,000–$15,000+** | **Annual** | Required for restricted-scope apps at scale. Self-guided/lower tiers are cheaper; a full assessor-led Tier 2 is the expensive case. Price varies wildly by assessor and app complexity — **the single largest recurring compliance cost, and it recurs every year.** |
| Microsoft publisher verification (MPN/Partner) | $0–low | One-time | Needed for a clean consent screen and to raise consent limits. |
| Legal review of PRIVACY/TERMS | $300–2,000+ | One-time + on material change | Current docs are **drafts with placeholder contact** — not launchable. Counsel sign-off is a hard GA gate (§16). |

**Plan for CASA as a recurring four-figure-plus annual line item.** Until verification + CASA clear, the hosted product is legally capped at the **≤100 test-user allowlist** — which is exactly why the Brief sequences this before GA. Budget the assessment before you budget paid marketing; an unverified app cannot scale past 100 users no matter how good the funnel is.

## 17.7 Email-provider API quota — a scaling cost and risk, not a line item

This is the cost the *current* architecture would fail on, and the reason §10 (incremental push sync) exists.

- **Today's full-rescan model burns quota catastrophically.** Every sync re-reads up to ~1 year of mail: Gmail caps ~800 thread ids / fetches first 200 threads (`format=metadata`), Graph pulls up to 1,000 via `$search`, IMAP runs ~12 SEARCH terms ANDed with SINCE (`MAX_MESSAGES=300`). At single-user-local this is merely wasteful; at hosted multi-user it is a **quota wall and a CASA data-minimization red flag** simultaneously.
- **Gmail API** has per-user and per-project quota units; metadata reads are cheap per call but full rescans multiply call count by user count. **Graph** throttles aggressively (429 + Retry-After) under burst. Incremental `history`/`delta` collapses steady-state reads to *near-zero* between changes — the cost moves from "every sync" to "only on actual mailbox change," which is the only model that scales.
- **The quota risk is operational, not a bill you can prepay.** You cannot buy your way out of a 429 storm; you engineer your way out with cursors, backoff, idempotent replay, and push notifications. Treat quota headroom as a capacity metric to monitor, with first-connect backfills (the one expensive operation) rate-limited and queued through Upstash so one new user's 1,000-message backfill never starves everyone else's incremental updates.

## 17.8 Bottom line

| Question | Answer (range) |
|---|---|
| Engineering complexity | Mostly Low–Medium code; **two genuinely High items**: incremental push sync and analytics. Compliance is low-code, high-calendar. |
| Infra cost (small scale) | **~$10–40/mo idle → under ~$250/mo at 100–1,000 active users.** |
| AI/LLM cost | **Cents per Pro user / month**, gated by second-pass-only escalation; trivially profitable against the paid-tier price. |
| Mobile maintenance | **Low** — companion-only, never scans on-device; mainly $99/yr Apple + SDK churn. |
| Fixed third-party | $99/yr Apple, $25 once Google Play, ~5%+$0.50/txn MoR. |
| **Largest recurring liability** | **CASA Tier 2: ~$1k–$15k+/yr** — budget it before marketing. |
| Time to MVP (private, allowlist) | **~10–12 weeks expected.** |
| Time to polished GA | **~5–9 months**, dominated by Google verification + CASA, not by code. |

The strategic read: this app is **cheap to host and cheap to run AI on by design** — the architecture (incremental sync, derived records, scale-to-zero Postgres, second-pass LLM) was chosen precisely to keep the per-user marginal cost near zero. The dominant costs are not servers; they are **CASA's annual assessment and the calendar time to clear restricted-scope verification.** Money is spent on compliance, not compute.

---

# 18. Risk Register

The register below is scoped to the architecture the Canonical Decisions Brief locks: hosted Fastify/Node API on Fly.io, Neon Postgres + Upstash Redis, React+TS+Vite hosted web, Expo companion mobile, the extracted `@pipeline/classify` TS package, push-driven incremental sync, envelope-encrypted tokens, and the open-core MIT/Pro/Teams split. Severity = blast radius if it lands; Likelihood = probability on the current trajectory if unaddressed. Risks are ordered roughly by Severity × Likelihood.

| # | Risk | Severity | Likelihood | Why it matters | Prevention strategy | Recovery strategy |
|---|------|----------|------------|----------------|---------------------|-------------------|
| 1 | **`business/OPEN-CORE-SPLIT.md` strategy leak (already live)** | High | **Certain (already happened)** | A file literally headed "do NOT commit to the public repo" is git-tracked and public in the MIT repo. Pricing, tiering, moat reasoning, and B2B plans are exposed to any competitor or future hire who clones the repo. It also signals sloppy data hygiene to anyone evaluating a *privacy* brand. | Treat as a release gate (Decision #15). Purge the entire `business/` strategy-doc set from the working tree, scrub it from git history (`git filter-repo`), force-push, and add `business/` to `.gitignore`. Move marketing media (mp4/gif/explainer/screenshots/vo.mp3, ~14 MB) to a separate asset repo or CDN. Add a CI check that fails if any path matching `*OPEN-CORE*`, `*pricing*`, or the strategy-doc names reappears. | Assume the strategy is *already* public — it has been cloned/forked/cached (GitHub, search engines, archive.org). Recovery is acceptance, not retraction: stop publishing strategy in the code repo permanently, and don't build a business model that depends on the pricing being secret. The moat is convenience + B2B compliance, not surprise. |
| 2 | **Google restricted-scope (`gmail.readonly`) verification rejected or stalled** | High | High | `gmail.readonly` is a Google RESTRICTED scope. Public multi-user launch requires OAuth app verification and almost certainly an annual CASA Tier 2 assessment by a Google-approved assessor. Today the app only works under the ≤100 test-user allowlist. A rejection or 6–12 week stall blocks the *entire* hosted Gmail funnel — the dominant inbox for job seekers. | Decision #10 + #11 are the verification posture, not just performance: incremental `history`/`delta` sync + persist-derived-records-not-raw-mail is exactly what CASA's data-minimization review rewards. Finalize `PRIVACY.md`/`TERMS.md` with counsel and a real contact (Decision #16) before submission. Submit verification early, behind the allowlist, while building. Budget for the assessor fee. Keep the consent screen, scope justification, and demo video pristine. | Run hosted under the test-user allowlist (≤100) indefinitely as a private beta — revenue from that cohort is still possible. If Gmail verification stalls, lead go-to-market with **Outlook/Microsoft** and the **free desktop build** (which uses the user's own OAuth client and sidesteps hosted verification). Resubmit with assessor remediation; never let a single provider gate the whole launch. |
| 3 | **Token / email-data breach destroys the privacy-led brand** | High | Med | Privacy is THE brand and the entire B2B/Teams compliance pitch. Mail OAuth refresh tokens are the crown jewels — one leaked DB or KMS key is read access to thousands of inboxes. A breach here isn't a bug, it's an extinction event: the differentiator inverts into the liability. | Envelope encryption per Decision #9 (per-row libsodium `crypto_secretbox` data key, master key in managed KMS, never plaintext/base64 hosted). Persist **derived records, not raw mail** (#11) so a DB dump exposes snippets+metadata, not full inboxes. Least-privilege DB roles, no broad `SELECT` on the token table from app code, audit logging on token decryption. Rotate keys on schedule. Read-only mail scopes only — never request write/send. | Documented incident runbook: revoke all OAuth grants (force re-consent), rotate the KMS master key + per-row keys, invalidate Clerk sessions. Because we store derived records not raw bodies, breach disclosure is "snippets + metadata + tokens," materially smaller than "full inboxes" — and tokens revoked at the provider are dead. Have the GDPR/CCPA breach-notification template and counsel contact ready *before* launch, not during. |
| 4 | **Microsoft publisher verification rejected/delayed** | High | Med | Microsoft killed basic-auth/app-password IMAP for personal accounts in 2024 — OAuth is *mandatory* for Outlook.com. Publisher verification (MPN/Partner) is required to clean up the consent screen and raise user limits. Without it, Outlook is stuck at unverified-app friction and low caps, kneecapping the second-largest inbox. | Start MPN/Partner enrollment in parallel with Google verification (Decision #16) — it's a slower bureaucratic process, so begin early. Use the public-client PKCE flow (no secret) already implemented in `providers.py`/`main.js`, `consumers` tenant, minimal `Mail.Read` + `offline_access` scopes. Keep app registration metadata, privacy URL, and support contact accurate. | If delayed, run Outlook in unverified-app mode for the test cohort (users click through the "unverified" warning) and lean on Gmail + desktop builds for the public funnel. Microsoft verification has no CASA-equivalent assessor cost, so the path to resolution is mostly paperwork patience. |
| 5 | **Full inbox re-scan (current sync model) fails to scale** | High | High | Today every sync is a full re-read: Gmail caps ~800 thread ids / 200 threads, Graph pulls up to 1000 via `$search`, IMAP runs ~12 ANDed SEARCH terms with `MAX_MESSAGES=300`, re-searching up to a year of mail *every time*. This burns API quota linearly with users, adds latency, and — critically — *fails CASA's data-minimization review* because it repeatedly reads far more than it needs. | Decision #10: incremental, push-driven sync. Gmail `users.history` + `watch`→Pub/Sub; Graph `delta` + change-notification subscriptions renewed pre-expiry; per-account `historyId`/delta cursor + subscription expiry in Postgres. Full backfill ONLY on first connect. Always-on workers on Fly.io (#12) handle the persistent listener + renewal that serverless can't. | If a provider's push channel breaks or a cursor is lost, fall back to a *bounded* incremental catch-up (since-last-cursor, not since-a-year), then re-establish `watch`/subscription. Per-account quota circuit-breaker: if an account exceeds its budget, back off and surface "sync paused" rather than hammering the API and risking a project-wide quota suspension. |
| 6 | **LLM classification cost outruns Pro revenue** | High | Med | AI classification is a Pro feature *because* it has marginal cost. If the LLM second pass fires on too many threads — or a heavy user re-syncs constantly — per-classification cost can exceed the paid-tier price, turning the flagship paid feature into a per-user loss. | Decision #14: keyword/regex `@pipeline/classify` runs FIRST; the LLM escalates ONLY low-confidence/ambiguous threads. Default to a small/fast Haiku-class Claude model for cost-per-classification. Cache classifications keyed by content hash so re-syncs don't re-bill. Hard per-user/per-day LLM budget caps with a circuit breaker. Server-side only (key custody + cost control) — never client-issued. | Instrument cost-per-active-Pro-user from day one; alert if it crosses a margin threshold. Tighten the confidence gate (escalate less), shrink the model, or cap LLM calls/day per user. Worst case, gate AI classification behind the higher Teams tier or a metered add-on rather than bundling it flat. Pricing the one-time tier must assume a *bounded* lifetime LLM spend, not unlimited. |
| 7 | **Classifier drift between the TS hosted copy and the frozen Python local copy** | Med | High | The brief mandates ONE classifier (`@pipeline/classify`, TS) for hosted web/mobile/API, while the free local Python build keeps a frozen copy. Two implementations of scored `detectStatus` + `resolveCompany`/`ATS_DOMAINS` will silently diverge — a thread classified "offer" on hosted but "interview" on local erodes trust in the product's "brain." | Decision #5: a SHARED golden-corpus (fixtures + expected `{status, company, role}`) runs in BOTH CI lanes (Node and Python). Treat the local Python copy as *frozen* — no feature work there; new classification logic lands in TS only. The existing `classify.test.js` (131 lines) becomes the seed corpus; mirror it into the Python lane. | If CI parity fails, the TS package is canonical; the Python copy is patched to match (or the feature is simply not backported, and the corpus marks it TS-only). Because local is a separate frozen artifact, divergence is contained — but the golden corpus must gate every classifier PR so drift is caught at commit time, not in user reports. |
| 8 | **`providers.py` mapper logic re-forks instead of being reimplemented in TS** | Med | Med | `providers.py` is a raw→unified MAPPER (Gmail/Graph field mapping), not a classifier twin. Decision #6 explicitly REJECTS reusing FastAPI/`providers.py` server-side. If the team reaches for the working Python mapper "just for the API," it re-forks mapping logic into Python, blocks mobile from importing it, and reintroduces the dual-runtime drift being killed. | Reimplement mapping in TS under `@pipeline/contracts`, validated by the existing `mappers.test.js` corpus (163 lines) ported to the Node lane. The Fastify API imports the TS mapper — no Python in the hosted path. Make the contract a zod schema so raw→unified mapping is type-checked end to end. | If a Python mapper sneaks into the hosted backend, treat it as tech debt with a removal ticket; the zod contract + shared corpus make the TS reimplementation a mechanical port. Local Python keeps its own `providers.py` (frozen artifact) — that's allowed; the rule is no Python *in the hosted runtime*. |
| 9 | **Hosted frontend rebuilt as a new monolith (history repeats)** | Med | Med | The current UI is a 1,394-line / ~76 KB single `index.html` (vanilla JS, no framework) — *not* 2.6 MB as the user believed (that's `business/explainer.html`, a marketing page). Decision #3 rebuilds hosted as React+TS+Vite components. The risk is reimplementing it as one giant component file and recreating an unmaintainable monolith in a new language. | Component decomposition enforced from the first commit: board, column, card, filters, account-connect, billing as separate components. Lint rules / file-size budgets in CI. Shared logic lives in `@pipeline/classify` + `@pipeline/contracts`, not in the view layer. The 76 KB monolith is small enough to reimplement cleanly — that's the *point* of rebuilding rather than untangling. | The local `index.html` stays frozen and shippable as the free build regardless of hosted-frontend churn, so a messy hosted rewrite never blocks the funnel. If the React app accretes a god-component, refactor incrementally — the unified contract isolates the view from the data model. |
| 10 | **OAuth `_pending` in-memory state breaks under multi-worker/hosted** | Med | High | `server.py` keeps OAuth `_pending = {}` in process memory — fine for single-process local, fatal hosted. With multiple Fly.io workers, an OAuth callback can land on a different instance than the one that issued the `state`, dropping the PKCE flow and failing every connect attempt non-deterministically. | Hosted backend is a *rebuild* (Fastify, Decision #6), not a port of `server.py` — move PKCE `state`/`code_verifier` into Upstash Redis (Decision #7) with a short TTL, keyed by `state`. Never hold auth flow state in process memory in the hosted build. Stateless workers behind the load balancer. | If a callback fails to find its `state`, return a clean "connection expired, retry" rather than a 500, and re-issue the flow. This risk is fully designed-out by not carrying `server.py`'s in-memory model forward — the prevention is architectural, not operational. |
| 11 | **Solo-founder bus factor / scope overrun across web + mobile + API + compliance** | High | High | One founder, AI-assisted, limited budget, simultaneously owns: hosted rebuild, mobile app, incremental sync workers, envelope encryption, Google CASA, Microsoft verification, billing, and legal. That is a multi-team scope. Burnout or a stall on any one item (especially compliance) cascades into the whole launch. | Sequence ruthlessly: ship free local + desktop (already built) as the funnel *now*; get OAuth verifications in flight early (they're calendar-bound, not effort-bound); build hosted web before mobile (mobile is companion-only, Decision #2, so it depends on the API existing). Keep hosting near-zero idle (Neon/Upstash/Fly serverless-priced, #12). Lean on managed services (Clerk for auth/MFA/seats, MoR for tax) to *delete* whole problem classes. | Cut scope, not corners: mobile and Teams can slip without blocking the Pro web launch. Keep the free build alive as the always-shippable fallback so there's a live product even if hosted stalls. Document the architecture (this plan) so the bus factor is mitigated by writing, not just code. |
| 12 | **Gmail/Graph push subscription expiry → silent sync death** | Med | High | Decision #10 depends on Gmail `watch` (expires ~7 days) and Graph change-notification subscriptions (short max lifetime, must be renewed). If a renewal worker misses, syncs silently stop and users see a stale board with no error — the worst UX failure for a "track my applications" product: it looks like nothing happened. | Always-on renewal worker on Fly.io (the explicit reason #12 rejects pure serverless). Store subscription expiry per account in Postgres; renew well before expiry with retry/backoff. Health-check that watches the watchers — alert if any account's subscription is within the renewal window and unrenewed. | Detect staleness via a "last successful sync" timestamp per account; if it exceeds a threshold, auto-trigger a bounded incremental catch-up and re-establish the subscription. Surface a visible "reconnect needed" state to the user rather than silently showing old data. |
| 13 | **Incremental consent UX confuses users / tanks mailbox-connect conversion** | Med | Med | Decision #8 decouples identity (Clerk sign-in) from the mail grant (`gmail.readonly`/`Mail.Read` requested only at mailbox-connect). Good for security and for not blocking sign-in on CASA status — but a two-step "sign in, *then* separately authorize scary mail access" flow plus Google's unverified-app warning screen can crater connect-through rates. | Sequence the mail-grant prompt right when the user's intent is highest (they clicked "Connect mailbox"), with an in-product explanation *before* the OAuth redirect: read-only, derived-records-only, disconnect anytime. Show the privacy posture (no raw mail stored) explicitly. Reinforce with the SHOW_LOGOS-off / no-referrer privacy defaults already in the product. | Instrument the connect funnel (sign-in → connect-click → grant → first-sync) and find the drop-off step. If the unverified-app warning is the killer, that's another reason to prioritize verification (#2/#4). Offer the free desktop build (own OAuth client, no warning) as an alternative path for privacy-skittish users. |
| 14 | **Mobile companion scope creep into on-device inbox scanning** | Med | Low | Decision #2 fixes mobile as glance-and-act: it reads server-derived records over the hosted API and NEVER scans a mailbox on-device. The temptation to "just add direct Gmail sync to the app" would re-fork the classifier per-platform, duplicate restricted-scope risk on iOS/Android, and break the one-place-classifies rule — multiplying CASA surface across app-store builds. | Hard architectural line: mobile imports `@pipeline/classify` for *display/consistency* but has no mail-provider SDK and no mail OAuth scope. First-run OAuth, billing, analytics deep-dives, and deletion/export live on web (#2). Code review rejects any mail-fetch dependency in `apps/mobile`. | If a mobile mail-scan feature is ever genuinely needed, it routes through the hosted API and workers — never on-device. The companion model means the mobile app can ship and update independently without touching the restricted-scope verification surface. |
| 15 | **Unsigned/unnotarized desktop build erodes the free funnel** | Med | Med | Packaging is electron-builder (dmg/nsis) but currently UNSIGNED/unnotarized. macOS Gatekeeper and Windows SmartScreen will throw scary "unidentified developer / unrecognized app" warnings — directly contradicting the privacy/trust brand on the *first* artifact many funnel users touch. | Budget for an Apple Developer ID + notarization and a Windows code-signing cert before promoting the desktop build publicly. Wire signing into the electron-builder CI (`build.yml`). Treat the desktop build as a trust artifact, not just a convenience. | Until signed, document the Gatekeeper/SmartScreen bypass clearly and honestly in the README, and lead the public funnel with the hosted web app (no install warning) while signing is arranged. Signing is a known, bounded cost — schedule it, don't skip it. |
| 16 | **Draft legal docs (`PRIVACY.md`/`TERMS.md`) ship with placeholder contact** | High | Med | Both are explicitly marked drafts ("review with legal counsel before publishing") with placeholder contact info. Publishing a *privacy product* under unreviewed terms with no real contact is both a legal exposure (GDPR/CCPA require a reachable controller contact + lawful basis) and a credibility failure — and Google/Microsoft verification will reject a placeholder privacy URL. | Decision #16: finalize with counsel, add a real monitored contact, host at a stable public URL, *before* any multi-user launch and before submitting OAuth verification (the privacy URL is part of that submission). Include GDPR/CCPA disconnect/delete/export language matching the actual data model (derived records, not raw mail). | If legal review lags, the launch waits — this is a non-negotiable gate, not a fast-follow. The free local build (no backend, no data leaving the device) can ship under a much simpler local-only privacy statement while hosted legal is finalized, keeping the funnel alive without the hosted liability. |
| 17 | **License gate over-engineered, or trivially cracked, distracting from the real moat** | Low | Med | Decision #13 uses an Ed25519-signed offline token with the public key embedded in the app. Any embedded-key offline DRM is crackable by a determined user, and over-investing in anti-piracy is wasted effort for a solo founder. The opposite failure — a flaky license check that locks out *paying* users — is worse than piracy. | Keep it deliberately minimal (#13): offline-verifiable signed token, MoR webhook (Lemon Squeezy/Paddle) issues it and handles global tax. Hosted Pro gates SERVER-SIDE by subscription claim (uncrackable, since the compute is server-side); only the *desktop* relies on the local token. Moat = convenience + B2B compliance, not copy-prevention. | If desktop tokens get shared, accept it as a marketing cost — the high-value Pro features (LLM classification, analytics, reminders) are hosted/server-side and gate on the subscription claim, which a leaked desktop token can't bypass. Never let license-check bugs block paying users; fail open on transient verification errors, fail closed only on a definitively invalid signature. |
| 18 | **Static-file allowlist regresses → config/token leak via hosted file serving** | Med | Low | `server.py` deliberately serves an ALLOWLIST (only `index.html`, `classify.js`) precisely to avoid leaking `config.json`, `.pipeline-accounts.json`, `.git`. A naive hosted rewrite using a generic static handler, or a misconfigured Vercel/Fastify static route, could expose secrets or token stores. | Hosted web is a built React+Vite bundle served by Vercel (static assets only, no app secrets in the bundle) — the API (Fastify) serves *no* static files and holds tokens only in Postgres (encrypted). Keep the allowlist instinct: explicit routes, no generic file server, secrets only in env/KMS, never on disk in a web-served path. CI secret-scanning (`run_secret_scanning`) on the repo. | If a path traversal or misrouted static handler is found, treat as a security incident (rotate any exposed secret, audit access logs). The architecture removes the at-risk pattern entirely by separating static frontend (Vercel) from the secret-holding API — the prevention is structural. |

**Cross-cutting note on sequencing.** The highest-leverage prevention actions are *calendar-bound, not effort-bound*: the OPEN-CORE-SPLIT.md purge (#1), OAuth verification submissions (#2, #4), and legal finalization (#16) all gate the public launch and several take weeks of external-party turnaround. They must start before, not after, the hosted rebuild — the engineering risks (#5, #7, #10, #12) are largely designed-out by obeying the Canonical Decisions, whereas the compliance and leak risks are only resolved by elapsed external time.

---

# 19. Final Recommended Build Path

This is the single ordered path. Not options — instructions. Earlier sections argued the *what* and *why*; this section is the *when*, and it is deliberately sequenced so that nothing expensive gets built before the thing it depends on is proven, and nothing public gets touched until the live leak is closed. The hard truth up front: the codebase is small (~3,600 lines), so the bottleneck is **not** writing code — AI tooling makes that cheap. The bottleneck is **compliance, key custody, sync correctness, and not shipping a security incident**. Order accordingly.

## The path, in order

### Phase 0 — Stop the bleeding (Day 0, before anything else)

**Step 1 — DELETE the live leak. This is a release gate, not a task.**
`business/OPEN-CORE-SPLIT.md` is headed *"Internal planning doc. Local only — do NOT commit to the public repo."* and is git-tracked in a public MIT repo. Pricing, moat reasoning, and the whole monetization strategy are readable by anyone, including competitors and the very ATS vendors whose domains `classify.js` hardcodes. Nothing else in this plan matters while that file is public.

- Purge **all** of `business/` strategy docs from the working tree AND git history (`git filter-repo --path business/OPEN-CORE-SPLIT.md --invert-paths`, then the rest of the strategy docs). History scrub is required — deleting in a new commit leaves it in every clone and the GitHub commit view.
- Move the ~14 MB of marketing media out of the app repo entirely: `pipeline-demo.mp4` (8 MB), `explainer.html` (2.5 MB — note: *this* is the 2.5 MB HTML file, **not** `index.html`, which is 76 KB), `pipeline-demo.gif` (1.4 MB), screenshots (1.1 MB), `vo.mp3`. These go to a separate private marketing repo or a CDN/asset bucket. The MIT funnel repo ships **code + LICENSE + draft legal docs only**.
- Force-push the rewritten history, rotate anything secret that might have been adjacent, and add a CI check (or a `pre-commit`/`.gitignore` guard) that fails if `business/` reappears.

> Until Step 1 is done, do not open a single editor tab on a new feature. A leaked pricing/moat doc is a competitive and credibility wound that compounds daily.

### Phase 1 — Audit (Week 1)

Audit before design, because two facts here change the design.

**Step 2 — Classifier corpus audit.** `classify.js` (236 lines, scored not first-match, ATS-domain recovery, negated-offer handling) is the product's brain and it is *good* — but its accuracy is unmeasured beyond `test/classify.test.js` (131 lines). Before extracting it to TS (#5), build a **golden corpus** of real-shaped fixtures with expected `{status, company, role}`. This corpus is the single most reused artifact in the whole plan: it's the TS-extraction parity gate, the Python-local parity gate, and the eval baseline that later tells you whether the Pro LLM second pass (#14) actually beats keywords. You cannot justify charging for AI classification without this baseline.

**Step 3 — Sync/quota audit.** Confirm the real cost of today's behavior: full re-read every sync, `_fetch_gmail` caps ~800 ids / 200 threads, `_fetch_graph` up to 1000, IMAP ~12 ANDed SEARCH terms with `MAX_MESSAGES=300`, re-searching ~1 year of mail. Document the exact quota burn per sync per provider. This number is the business case for incremental sync (#10) and a CASA data-minimization finding waiting to happen — write it down now so it drives priority later.

**Step 4 — Compliance clock audit.** Inventory the verification path *before* writing backend code, because lead times dominate the launch date:
- `gmail.readonly` is a Google **restricted** scope → app verification + likely **CASA Tier 2** by an approved assessor. Today it works only under the ≤100 test-user allowlist.
- Microsoft publisher verification (MPN/Partner) for the consent screen.
- `PRIVACY.md` / `TERMS.md` are drafts with placeholder contact info; counsel review + real contact required.

Start these clocks early (Step 16) — they run for *weeks-to-months* in parallel with all engineering.

### Phase 2 — Design first (Week 1–2)

**Step 5 — Design the contract and the monorepo skeleton, not features.** Lock `@pipeline/contracts` (zod schemas for `{ threadId, domain, subject, messages:[{date, from, body}] }`, `BODY_CHARS=600`, plus API DTOs) and stand up the pnpm + Turborepo skeleton. Everything downstream imports these. Design the **data model for derived records** here too (#11): company, role, status, status-history dates, ≤600-char snippet — and the explicit rule that **raw bodies are never durably stored**. Designing the persistence boundary now is what makes the privacy brand real instead of aspirational; retrofitting it later means a schema migration plus a CASA re-review.

**Step 6 — Design token-at-rest and identity before any hosted token touches a disk.** Envelope encryption (#9): per-row libsodium `crypto_secretbox` data key, master key in managed KMS. Identity (#8): Clerk for sessions, mail scope as *separate incremental consent*. These are design-first because getting them wrong means a breach or a re-architecture, and because decoupling identity from mail scope is what lets you ship sign-in while Google verification is still pending.

### Phase 3 — Build, in dependency order (Week 2–8)

**Step 7 — Extract the classifier to `@pipeline/classify` (TS).** Port `classify.js` to TypeScript, gate it against the Step 2 corpus until parity is exact. Reimplement `providers.py`'s raw→unified mapping as TS mappers under `@pipeline/contracts`, validated by the existing `mappers.test.js` corpus (163 lines). The Python local build keeps its frozen copy; the **shared golden corpus runs in both CI lanes** to prevent drift. This is step one of building because *everything* — web, mobile, API, workers — imports it.

**Step 8 — Build the Fastify API + Postgres/Redis with the new token store.** Neon Postgres (system of record), Upstash Redis (queue/rate-limit). Implement OAuth connect with **envelope-encrypted** tokens from line one. **DELETE the base64 token fallback for the hosted build** — it exists in desktop (`main.js`, with an intentional `console.warn`) as a local-only degradation and is explicitly out of scope hosted. Plaintext-equivalent tokens server-side is a non-starter.

**Step 9 — Build incremental, push-driven sync (#10).** Gmail `users.history` + `watch` → Pub/Sub; Graph `delta` + change-notification subscriptions with pre-expiry renewal; per-account `historyId`/`deltaLink` cursor + subscription expiry in Postgres. **Full backfill only on first connect.** This is the single highest-leverage backend build: it kills the quota burn from Step 3, is mandatory for CASA data-minimization, and is the reason hosting is hybrid not pure-serverless (#12) — subscriptions need a persistent listener and pre-expiry renewer that fights Lambda's execution model.

**Step 10 — Rebuild the hosted web frontend (React + TS + Vite).** Do **not** migrate the 1,394-line `index.html`. Reimplement the board against the new API, importing `@pipeline/classify` and `@pipeline/contracts`. The monolith is small enough to reimplement faster than to untangle, and the rebuild is where you stop carrying localStorage-only state forward. The local `index.html` + `server.py` build is **frozen** — a separate artifact, left essentially as-is as the funnel/privacy proof.

**Step 11 — Deploy hosting (#12).** API + sync/renewal workers on Fly.io (always-on, cheap), web on Vercel, Postgres on Neon, Redis on Upstash. Wire KMS. This is plumbing; it follows the code it hosts.

### Phase 4 — Monetize, then companion (Week 8–14)

**Step 12 — Build the license/billing gate (#13).** Ed25519 signed offline-verifiable token, public key embedded; Merchant-of-Record (Lemon Squeezy / Paddle) webhook issues tokens — MoR handles global VAT/tax for a solo founder. Hosted Pro gates **server-side by subscription claim**; desktop Pro gates by the license token. Don't over-build DRM; the moat is convenience + B2B compliance.

**Step 13 — Ship the first paid Pro features that gate cheaply and already exist.** Order by build cost, not excitement: **multi-mailbox merge** (already built in desktop `main.js` — just expose + gate), CSV/PDF export, notes/contacts. These prove the gate works and start revenue before you spend on the expensive ones.

**Step 14 — LLM second pass, Pro-only, server-side (#14).** Now — not earlier — because it requires the Step 2 corpus to prove it beats keywords, requires the billing gate to charge for its marginal cost, and requires the server-side token custody. Keyword classifier runs first; LLM escalates **only** low-confidence/ambiguous threads. Default to a small/fast Claude (Haiku-class) for cost-per-classification. Never persist the raw body sent to the model.

**Step 15 — Build the mobile companion last (#2).** Expo / React Native, glance-and-act. It reads server-derived records over the hosted API and **NEVER scans a mailbox on-device**. First-run OAuth, billing, analytics, and deletion/export stay on web. Mobile is last because it has *zero* value until the hosted API and derived-record store exist, and because **on-device scanning is the one thing we refuse to build** — it would re-fork the classifier and multiply restricted-scope risk per platform.

### Phase 5 — Compliance & launch (runs in parallel from Week 1; gates GA)

**Step 16 — Run the verification track in parallel the whole time.** Start in Week 1 (from Step 4). Finalize `PRIVACY.md`/`TERMS.md` with counsel + real contact; complete Google restricted-scope verification + CASA Tier 2; complete Microsoft publisher verification. Until all pass, hosted runs under the Google test-user allowlist (≤100). **No public multi-user launch ships ahead of these** — and CASA will scrutinize exactly the things this path front-loaded: data minimization (Step 9), no-raw-storage (Step 5), token-at-rest encryption (Step 6/8).

## What to delay (deliberately, not by accident)

| Delay | Until | Why |
|---|---|---|
| Analytics suite (funnel %, time-in-stage, response rate, weekly digest) | After core Pro revenue exists | Expensive to build; needs a corpus of real derived records first; not a wedge feature |
| Interview-prep generator | After LLM pass is live | LLM-dependent; medium-expensive; not load-bearing for first revenue |
| Teams tier (seat admin, cohort dashboards, white-label) | After Pro is proven | B2B sales motion + opt-in aggregate dashboards are a separate, later product; don't pre-build |
| Mobile | After hosted API + derived store | Zero value before the server exists (Step 15) |
| White-label | Demand-driven | Optional even within Teams |

## What to DELETE (say it plainly)

- **The committed `business/` strategy docs + 14 MB of heavy media** from the public MIT repo, *with history scrub* (Step 1). The `OPEN-CORE-SPLIT.md` leak is live now.
- **The base64 token fallback for the hosted build** (Step 8). It is an acceptable local-only degradation in desktop; it is a breach waiting to happen server-side.
- **The idea of full mobile parity.** Mobile is companion-only and never scans on-device (Step 15). Reject any feature request that pushes scanning, billing, or first-run OAuth onto the phone.
- **The dual-runtime classifier duplication on the hosted side.** One TS `@pipeline/classify`, imported everywhere hosted; Python keeps a *frozen* local copy gated by the shared corpus, not a maintained twin.

## What to validate with users (don't guess)

1. **Classifier accuracy on real inboxes** — does the keyword classifier (Step 7) get status/company/role right often enough that people trust the board? Measure against the Step 2 corpus *and* a handful of real test-allowlist users. This decides whether the LLM pass is a nice-to-have or a must-have.
2. **Does multi-mailbox merge alone justify the paid tier?** It's the cheapest-to-ship Pro feature (already in desktop). If it doesn't convert, the pricing or the wedge is wrong — find out before building analytics.
3. **Privacy as a buying reason** — does "read-only, derived-records-only, local option exists" actually move users, or is it table stakes? The whole architecture is bet on this; validate it with the ≤100 allowlist before GA.

## The three readiness milestones

| Milestone | Proven when |
|---|---|
| **READY FOR WEB** | Hosted app: Clerk sign-in + separate mail consent works; tokens stored envelope-encrypted (no plaintext/base64); incremental push sync runs end-to-end (first-connect backfill + delta, no full re-read); board renders real derived records from the API via `@pipeline/classify`; raw bodies are never written to durable storage (verifiable in schema + logs). |
| **READY FOR MOBILE** | Hosted API is stable and versioned against `@pipeline/contracts`; derived-record store is the single read source; Expo app shows the board and acts on records **with zero on-device scanning**; OAuth/billing/deletion correctly deep-link back to web. |
| **READY TO LAUNCH (public, verified, multi-user)** | `business/` leak purged from history; base64 hosted fallback gone; billing gate live (Ed25519 + MoR webhook); `PRIVACY.md`/`TERMS.md` final with real contact; Google restricted-scope verification + CASA Tier 2 passed; Microsoft publisher verification passed; user-controllable disconnect/delete/export working (GDPR/CCPA). Only then does the app leave the ≤100 allowlist. |

## Do this first / this week

1. **`git filter-repo` the `business/` strategy docs out of history; move the 14 MB of media to a private/CDN repo; force-push; add a CI guard.** (Step 1 — today.)
2. **Build the golden classifier corpus** (real-shaped fixtures → expected `{status, company, role}`). (Step 2.)
3. **Document the exact per-sync quota burn** for Gmail/Graph/IMAP as-is. (Step 3.)
4. **Open the Google verification + CASA and Microsoft publisher-verification tickets, and send `PRIVACY.md`/`TERMS.md` to counsel.** Start the slow clocks now. (Step 4/16.)
5. **Stand up the monorepo skeleton and lock `@pipeline/contracts`.** (Step 5.)

Everything else waits on these five. If you do only item 1 this week, you have still removed a live, compounding liability — do it before you read Section 20.
