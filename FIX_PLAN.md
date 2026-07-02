# FIX_PLAN — Phase 1 error analysis (read-only; no fixes implemented here)

Inputs: baseline eval (5 failures, all Known Issue A encodings) + a 50-input trap-class probe
(28 divergences from hand-labeled ground truth). Every bucket below lands as ONE diff, adds its
failing cases to the corpus FIRST, and passes the regression gate (overall must not drop; no
category −2 pts / −1 case in small categories).

## 1. Known Issue A — definitive diagnosis (extraction AND matching, plus a third site)

### Trace 1 — extraction misses the Workday tenant local part
Thread: `from: "Workday <initech@myworkday.com>", subject: "Application Update"`, generic body.
- `companyFromSenderName` (`packages/classify/src/index.ts:282`) strips the `<email>` entirely,
  leaves display name "Workday" → `isPlatformWord` → null. The tenant slug `initech` in the
  local part is **never read** (same in legacy `classify.js:134`).
- Subject/body patterns find nothing → `resolveCompany` falls back to `companyFromDomain` →
  **"Myworkday"** (`index.ts:353`); `resolveCompanySmart` (`aggregate.ts:171`) also finds nothing
  (`companyFromApplyUrl` wants dotted host slugs, not local parts) → same fallback (`aggregate.ts:192`).
- Result: Initech and Hooli both become company "Myworkday". → **extraction fault**.

### Trace 2 — extraction misses LinkedIn "viewed by <Company>"
Subject `"Your application was viewed by Acme Corp"` — none of `SUBJECT_PATS` (`index.ts:291`,
`classify.js:145`) nor `SMART_SUBJECT_RES` (`aggregate.ts:142`) cover "by <Company>"; body
pattern `your application (?:to|with) X` grabs a garbage suffix ("Acme Corp was viewed by") when
the body says "application to Acme Corp was viewed" because the cut-list (`index.ts:321`,
`aggregate.ts:159`) lacks verbs like was/viewed. → both threads fall back to **"Linkedin"**.
→ **extraction fault** (pattern gap + cut-list gap).

### Trace 3 — matching: board grouping keys on the shared fallback name
`boardFromApplications` (`packages/contracts/src/index.ts:144`) keys groups on
`a.company.toLowerCase()`; desktop `groupByCompany` (`index.html:672`) and web `companyCards`
(`apps/web/src/lib/derive.ts:270`) do the same. Every platform-fallback record ("Myworkday",
"Linkedin", …) therefore merges into ONE company card, even though the classifier itself flagged
each record `company_platform_fallback` / confidence 0.3. → **matching fault** (no
disqualification of shared-platform identity as a group key).

### Trace 4 — matching: desktop IMAP threading keys on shared domain+subject
`mapParsedToThreads` (`imap.js:52-77`, key at line 58): `key = domainOf(fromAddr) + "|" +
normSubject(subject)`. Two different Workday tenants (`initech@` vs `hooli@myworkday.com`) with
the identical boilerplate subject "Application Update" produce **one thread → one Application
record**; extraction never gets a chance to separate them. → **matching fault** (thread identity
keyed on shared platform domain).

**Verdict: BOTH layers.** (a) Extraction misses recoverable identity signals, so records fall to
the platform name far too often; (b) all three grouping sites merge on that shared name with no
guard, and the desktop IMAP mapper merges even earlier, at thread construction.

Repair path for existing data: hosted records self-heal (records are per-thread; `upsertApplications`
overwrites on every sync; grouping is computed at read time). Desktop rebuilds threads on every
fetch. **One real migration concern**: the IMAP threading fix changes derived `imap-<hash>`
threadIds, which orphans desktop manual status-overrides/pins keyed on old ids → will be written
up in MIGRATION_PLAN.md in Phase 3 and NOT implemented without approval.

## 2. Failure buckets, ranked by (cases fixed × priority) ÷ risk

Known Issue A buckets are top-3 by mandate (corpus under-represents a bug the user hits daily).

| # | Bucket | Layer / files | Evidence (fail count) | Root cause | Fix sketch | Risk |
|---|--------|---------------|----------------------|------------|-----------|------|
| 1 | **KA-EXTRACT** — recover employer identity behind ATS | `index.ts` + `classify.js` (lock-step, parity-gated) for shared patterns; `aggregate.ts` for smart-path-only signals | eval: 2 matching cases; probe: 7 company cases | Missing signals: ATS tenant **local part** (`initech@myworkday.com`); subject "viewed by X"; body "sent to X"/"application to X was viewed" (garbage-suffix cut-list gap); tenant-URL coverage gaps (`careers-acme.icims.com`, `jobs.smartrecruiters.com/<Slug>/…`); bare-address sender name → garbage "@greenhouse.io" (legacy only) | Add local-part tenant signal + subject/body patterns + cut-list verbs + URL patterns; guard bare-address garbage in `companyFromSenderName` | Med (touches parity primitives — lock-step both copies, parity gate proves agreement) |
| 2 | **KA-GROUP** — never merge on a shared-platform identity | `contracts/src/index.ts` (`boardFromApplications`), `index.html` (`groupByCompany`), `apps/web/src/lib/derive.ts` (`companyCards`); flag plumbed from `aggregate.ts` `threadToApplication` | eval: matching case 5 (silent merge of unidentifiable records) | Group key = company name; platform fallback shares one name | Additive optional `platformFallback` on `Application` (precedent: `confidence`), set by `threadToApplication`; groupers key fallback records by threadId (no merge). Desktop computes the same flag inline via `isAtsDomain(app.domain)` | Med-high (matching layer; per-surface diffs; extra before/after scrutiny) |
| 3 | **KA-IMAP** — thread identity must not be domain+subject for shared ATS domains | `imap.js` `mapParsedToThreads` | eval: 2 imapThreading cases | Key `domain\|subject` | For shared-ATS domains extend the key with recovered per-mail identity (tenant local part / resolved company); unrecoverable ATS mail keys by messageId (never merges). Non-ATS mail unchanged | Med (desktop-only; changes derived threadIds → MIGRATION_PLAN.md) |
| 4 | **STATUS-FALSE-REJ** — positive mail misread as rejection | `index.ts` `scoreStatus` + `classify.js` `detectStatus` (lock-step) | probe: 2 | `we have decided to (move\|proceed\|go)` fires as decisive rejection even in "decided to move forward with your application"; "after careful consideration" is decisive on its own but is only a preamble | Constrain the `decided to …` branch to negative continuations; demote "after careful consideration" to a weak cue | Med (core scoring; corpus rejection cases must all still pass via their other cues — verified per case before landing) |
| 5 | **STATUS-MISSED-REJ** — real rejections scored null | same as #4 (lock-step) | probe: 3 | Missing phrasings: "chosen/pursue another candidate" (singular), "with regret", "not retained" | Add decisive patterns | Low-med |
| 6 | **ROLE** — polluted/boilerplate subjects | `aggregate.ts` `cleanRole` (TS-only) + one `extractRole` pattern (lock-step) | probe: 4 | Leading boilerplate segment wins ("Interview Confirmation - SWE II"); trailing "position"; "(m/f/d)" kept; "Application received – X" unparsed | cleanRole: known-boilerplate leading-segment skip, trailing role-word strip, 1-letter-token parens = noise; extractRole: `application (received\|submitted\|…) [:–-] X` pattern | Low-med |
| 7 | **COMP** — ranges/qualifiers/locales | `extract.ts` `extractCompensation` (TS-only) | probe: 4 | "up to" dropped; "between X and Y" truncated; `€70.000` truncated to `€70.00`; "130k USD" (currency after) missed | Extend AMOUNT/COMP_RE: optional qualifier prefix, `and` joiner, European separators, currency-suffix form | Low |
| 8 | **INTERVIEW** — non-US datetime shapes | `extract.ts` `extractInterview` (TS-only) | probe: 2 | Day-month order ("12 June") and 24h times ("at 14:00", "Thursday 15:30") unsupported | Add day-first date RE and anchored 24h time RE | Low |
| 9 | **RECRUITER** — candidate echo + non-ASCII names | `extract.ts` (TS-only) | probe: 2 | Candidate's own echoed gmail returned as recruiter email; `NAME_RE` is ASCII-only (misses "Ayşe Yılmaz") | Guard emails following "your (contact) details/profile"; Unicode name regex (`\p{L}`, `u` flag) | Low |
| 10 | **TURKISH** (Phase 5) | status/date/salutation handling | no corpus coverage | brain is English-only | Per-language report; ASSUMED-template `tr` cases clearly labeled + 10-most-valuable-email-types list | Low |

## 3. Phase mapping (one bucket = one diff, eval before/after each)

- **Phase 2 (status):** buckets 4, 5 — flagged for confidence-distribution before/after since they
  touch `scoreStatus` (lock-step with legacy; parity gate must stay green).
- **Phase 3 (company/role + Known Issue A):** buckets 1 (extraction), 2 (grouping), 3 (IMAP) as
  three separate diffs in that order, regression corpus cases added before each; then bucket 6.
  MIGRATION_PLAN.md written if the IMAP fix lands; STOP for approval on any data repair.
- **Phase 4 (enrichment):** buckets 7, 8, 9. Enrichment must not alter status/company/role
  outputs (extractors are isolated in `extract.ts`; no shared code with status/company — verified).
- **Phase 5 (multilingual):** bucket 10.

## 4. Assumptions stated before acting

- **ASSUMED**: lock-step edits to the 5 parity primitives (both `classify.js` and the TS port,
  parity gate green) are the sanctioned evolution path; the "frozen" label prevents drift, not
  bug fixes. Without this, the desktop app can never receive the Known Issue A fix.
- **ASSUMED**: ground-truth labels for the 28 probe divergences are my hand labels; each becomes
  a corpus case reviewable in the diff that fixes it.
- **ASSUMED**: agency-vs-hiring-company (recruiter emails from an agency's own domain) stays
  resolved to the agency (sender identity) — changing that would need product direction; noted as
  a remaining weakness for the final report, not a bucket.
