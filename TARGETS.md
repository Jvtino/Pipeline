# TARGETS — per-category accuracy targets

Set at end of Phase 0. Measured by `pnpm --filter @pipeline/classify eval`. The corpus GROWS
during Phases 1–5 (every fix bucket adds its failing cases first), so targets are expressed as
**accuracy on the final, grown corpus** — which is strictly harder than the baseline corpus.
Baseline categories start at 100% only because the corpus was seeded from passing tests; the
real work is keeping categories at/near 100% while the corpus absorbs the trap classes below.

| Category | Baseline (Phase 0 corpus) | Target (final corpus) | Justification |
| --- | ---: | ---: | --- |
| status | 100% (22/22) | ≥97% | Trap classes to be encoded in Phase 1–2 (soft-close rejection, "moving forward" ambiguity, reschedules, ATS noise); a small tail of genuinely ambiguous phrasing may stay unfixable without semantics. |
| confidence | 100% (8/8) | 100% | Small category; every labeled case must hold (1-case regression rule). |
| company (base) | 100% (10/10) | ≥95% | Agency-vs-employer and multi-company threads are hard lexically; platform fallback must become rare, never wrong-confident. |
| companySmart (hosted) | 100% (10/10) | ≥97% | The hosted path gets the new identity signals (tenant local part, apply-URLs, viewed-by patterns); should beat base. |
| companyFromDomain | 100% (3/3) | 100% | Deterministic mapping; no excuse to miss. |
| companyFromSenderName_null | 100% (3/3) | 100% | Platform words must never become a company. |
| role | 100% (6/6) | ≥95% | Req-ID/location-polluted subjects to be added; some subjects genuinely contain no role. |
| roleClean | 100% (9/9) | ≥95% | Same trap classes, display-polish layer. |
| interview | 100% (5/5) | ≥90% | Timezones/relative dates/ranges/reschedules are the messiest field; value-or-null bias means "null when unsure" is acceptable, wrong-value is not. |
| compensation | 100% (6/6) | ≥95% | Ranges, hourly vs annual, currency, "up to" are pattern-shaped — rules reach them. |
| location | 100% (6/6) | ≥95% | Conservative extractor; keep it. |
| recruiterContact | 100% (5/5) | ≥90% | Highest fabrication risk; null-bias means recall can lag, precision must not. |
| **matching** | **40% (2/5)** | **100%** | Known Issue A is user-confirmed; every encoded bundling case must pass. Distinct companies must never merge on a platform key. |
| **imapThreading** | **33% (1/3)** | **100%** | Same bug, desktop IMAP layer. |
| per-language: Turkish | no coverage | report + ≥90% on ASSUMED-template cases, clearly labeled | Phase 5: real-template-based cases only, reported in a separate `tr` bucket; plus the 10-most-valuable-email-types list. Never scored "as if real" user mail. |
| **overall** | 95.0% | ≥97% on the grown corpus, **zero regressions** | Regression gate: reject any change that drops overall, or any category >2 pts (>1 case in small categories). |

Non-negotiables carried through every phase: eval before/after every diff; one failure cluster
per diff; parity + confidence system untouched (lock-step edits to the 5 primitives allowed,
gate never bypassed); no LLM calls.
