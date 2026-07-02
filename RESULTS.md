# RESULTS — brain accuracy mission, final report

Branch `claude/new-session-tu0nna` · 2026-07-02 · Eval: `pnpm --filter @pipeline/classify eval`

## 1. Baseline vs targets vs final

The corpus grew 83 → 146 labeled cases during the mission (every fix bucket added its failing
cases FIRST — the "final" column is scored on the grown, strictly harder corpus).

| Category | Baseline (Phase 0) | Target | Final | n final |
| --- | ---: | ---: | ---: | ---: |
| status | 100% (22/22) | ≥97% | **100%** | 36 |
| confidence | 100% (8/8) | 100% | **100%** | 8 |
| company (base resolver) | 100% (10/10) | ≥95% | **100%** | 15 |
| companySmart (hosted) | 100% (10/10) | ≥97% | **100%** | 18 |
| companyFromDomain | 100% (3/3) | 100% | **100%** | 3 |
| companyFromSenderName_null | 100% (3/3) | 100% | **100%** | 4 |
| role | 100% (6/6) | ≥95% | **100%** | 8 |
| roleClean | 100% (9/9) | ≥95% | **100%** | 13 |
| interview | 100% (5/5) | ≥90% | **100%** | 7 |
| compensation | 100% (6/6) | ≥95% | **100%** | 11 |
| location | 100% (6/6) | ≥95% | **100%** | 6 |
| recruiterContact | 100% (5/5) | ≥90% | **100%** | 7 |
| **matching** (Known Issue A) | **40% (2/5)** | 100% | **100%** | 5 |
| **imapThreading** (Known Issue A) | **33% (1/3)** | 100% | **100%** | 3 |
| per-language: en | 100% | — | **100%** | 137 |
| per-language: tr | no coverage | ≥90% (ASSUMED-labeled) | **100%** | 9 |
| **overall** | 95.0% (96/101) | ≥97%, zero regressions | **100% (146/146)** | 146 |

Regression gate: never tripped. Test suites: 202 classify vitest (incl. the legacy-parity gate),
45 legacy node tests, full workspace 310+ tests — all green after every diff.

## 2. Known Issue A — proof of fix

Diagnosis (Phase 1, FIX_PLAN.md §1): **both layers**, plus a third site —
(a) extraction fell back to the platform name too often; (b) all three board groupers keyed on
that shared name; (c) the desktop IMAP mapper threaded on `domain|subject`.

Regression cases (in `corpus/cases.json`, permanent):

| Case | Before | After |
| --- | --- | --- |
| Workday: `initech@` vs `hooli@myworkday.com`, same boilerplate subject | 1 group "Myworkday" | **2 groups: Initech, Hooli** |
| LinkedIn: "viewed by Acme Corp" vs "viewed by Umbrella Corp" | 1 group "Linkedin" | **2 groups: Acme Corp, Umbrella Corp** |
| Two content-identical LinkedIn notifications | silently merged | **2 separate low-confidence cards** |
| IMAP: two Workday tenants, identical subject | 1 thread → 1 record | **2 threads** |
| IMAP: same no-reply sender, company only in body | 1 thread | **2 threads** |

Behavior in the app: applications from different companies via one platform now appear as
separate cards under their real employer names (desktop, web, and API boards); when no employer
is recoverable, each stays its own "needs review" card instead of silently merging.
MIGRATION_PLAN.md covers the one data consequence (desktop-IMAP manual overrides/pins keyed on
old ATS threadIds orphan once) — **awaiting approval, not implemented**.

## 3. Every accepted change (one line each)

1. `phase 0` — eval harness (per-category/per-language + matching/imapThreading), BASELINE/TARGETS. *(harness)*
2. `phase 1` — FIX_PLAN.md error analysis. *(read-only)*
3. `phase 2a` — status: "chosen/pursued another candidate", "with regret", "not retained" rejections (lock-step).
4. `phase 2b` — status: positive "after careful consideration"/"decided to move forward with your application" no longer misread as rejection (lock-step; label audit: only the 2 intended cases changed).
5. `phase 3a` — Known Issue A extraction: Workday tenant local part, "viewed by", body cut-list verbs, bare-address guard, ATS URL coverage (icims/smartrecruiters-path/myworkdaysite/successfactors/taleo/personio), apply-URL multi-match, https-capture guard.
6. `phase 3b` — Known Issue A matching: additive `platformFallback` flag (contract+db column+classify) and no-merge rule in all three groupers (contracts board, desktop, web).
7. `phase 3c` — Known Issue A desktop IMAP: ATS-aware thread key (recovered employer or messageId; never bundle); body "sent to <Company>" pattern (lock-step); MIGRATION_PLAN.md.
8. `phase 3d` — role: boilerplate leading segments, "(m/f/d)" tags, trailing "position/role/…", "Application received: X" subjects (cleanRole TS-only + one lock-step extractRole pattern).
9. `phase 4a` — compensation: "up to"/"between…and", European thousands separators, currency-after amounts, TRY/TL.
10. `phase 4b` — interview: European day-month dates, anchored 24h times.
11. `phase 4c` — recruiter contact: candidate-echoed-details guard, Unicode names.
12. `phase 5` — Turkish status templates + LinkedIn-TR company subject (lock-step), ASSUMED-labeled `tr` corpus bucket.
13. `phase 6` — LLM_DECISION.md (memo only) + this report.

**Reverted attempts: none.** Two intra-diff corrections before commit (recorded for honesty):
the first icims URL pattern stopped at the platform's own mailbox host (fixed by walking every
match), and `SMART_BODY_RES` under `/i` captured "https" as a company (fixed via noise-word list).

## 4. IMPLEMENTED / TESTED / ASSUMED

- **IMPLEMENTED + TESTED**: everything in §3; each change landed with corpus cases added first
  (shown failing), eval before/after, full unit+parity+legacy suites green. The matching fix is
  additionally covered end-to-end by db tests (persisted flag) and the board-building tests.
- **TESTED but synthetic**: the corpus itself is curated, not captured mail. All 63 new cases are
  realistic renderings of common templates; they encode my hand labels (stated in FIX_PLAN §4).
- **ASSUMED**:
  - Lock-step edits to the 5 parity primitives are the sanctioned evolution path ("frozen" =
    no drift, not no bug fixes); the parity gate stayed green throughout.
  - Turkish `tr` cases are ASSUMED-representative templates, labeled as such in the corpus —
    not scored "as if real" user mail (they sit in a separate language bucket).
  - Agency-vs-hiring-company mail stays resolved to the agency (product decision deferred).
  - Graph/Outlook `conversationId` threading does not bundle cross-company ATS mail the way IMAP
    did (server-side threading; not reproduced locally — unverified).

## 5. Manual verification checklist (run these through the app)

Same-platform-different-company pairs (the Known Issue A proof — expect SEPARATE cards):
1. A Workday mail from `<companyA>@myworkday.com` and another from `<companyB>@myworkday.com`
   with the same subject ("Application Update") → two cards, named per company.
2. Two LinkedIn "Your application was sent to X" / "sent to Y" confirmations → two cards, X and Y.
3. Two LinkedIn "Your application was viewed by X / by Y" notifications → two cards.
4. (IMAP desktop) Any two same-subject ATS mails from different companies → two threads/cards.

Status/extraction spot checks:
5. An interview invitation opening with "After careful consideration…" → Interview, not Rejected.
6. A rejection saying "we have chosen another candidate" (no "unfortunately") → Rejected.
7. A Turkish rejection containing "Maalesef … olumsuz" → Rejected; a "Başvurunuz alınmıştır"
   ack → Active/Applied.
8. A mail with "The salary is €70.000 per year" → compensation shows "€70.000 per year" (not "€70.00").
9. "Your interview is scheduled for 12 June at 14:00 CET" → interview date extracted.
10. An ATS mail with no recoverable employer → a single "needs review" card that does NOT absorb
    other companies' mail.

## 6. Top 3 remaining weaknesses (and what would fix them)

1. **The unmeasured tail** — the corpus contains what we understood; real inboxes contain more.
   Fix: keep the corpus loop hot (`add-case.mjs` on every user-reported miss), plus the
   pre-specified LLM fallback in LLM_DECISION.md if needs-review telemetry shows a floor.
2. **Non-English relevance + fetch queries** — `looksLikeJobApplication` and the desktop Gmail
   search query are English-anchored, so a Turkish-only application thread from a company domain
   can be missed before classification ever runs. Fix: add Turkish anchors to the gate (one
   diff + gate-category eval cases) and localized fetch keywords.
3. **Agency / multi-company recruiter threads** — semantically out of reach for rules; currently
   resolved to the agency (safe but sometimes not what the user wants). Fix: product decision,
   then either an explicit agency-domain list + "on behalf of X" patterns, or the LLM fallback.
