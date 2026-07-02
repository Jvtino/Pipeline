# LLM_DECISION — should an LLM enter the pipeline? (memo only; no code)

Evidence base: Phases 1–5. Corpus grew 83 → 146 labeled cases (incl. matching-layer and Turkish
buckets); eval is 146/146. The counts below therefore describe the failure classes that REMAIN
UNREPRESENTED or are structurally out of reach for rules, drawn from the Phase 1 probe and
analysis, not from measured eval failures (there are currently none).

## Remaining failure classes: semantic vs lexical

| Class | Kind | Evidence / expected frequency | Rules can reach? |
| --- | --- | --- | --- |
| Recruiting agency vs hiring company (agency emails from its own domain about client roles) | **Semantic** | 1 probe case (by design, ASSUMED resolved-to-agency); common for candidates using agencies | No — needs judgment about which org is "the application" |
| Multi-company recruiter threads (one thread discussing several clients) | **Semantic** | trap class identified in Phase 1; unquantified | No — one thread → one record is a data-model assumption |
| Unidentifiable platform mail (zero content signals, e.g. bare "Your application was viewed") | **Neither** | 1 matching case (now kept separate + low-confidence, by design) | No — and neither can an LLM: the information isn't in the mail |
| Unseen rejection/status phrasings (long tail, incl. Turkish breadth) | **Lexical** | Phase 2/5 fixed 9 phrasings with one-line rules; tail shrinks per real sample | Yes — each is a one-line rule + corpus case |
| Novel date/comp formats | **Lexical** | Phase 4 fixed 6 shapes the same way | Yes |
| Relevance gate for non-English inboxes | **Lexical** | known gap (gate + desktop Gmail query are English-anchored) | Yes |

Semantic residue is real but narrow: ~2 classes, both about *whose application a mail belongs
to*, not *what it says*.

## Options

**(a) Rules-only (status quo).**
Expected gain: the lexical tail keeps shrinking via the corpus loop (every measured failure in
Phases 2–5 was fixed by a small rule within the same session). Semantic classes stay unsolved but
degrade safely: low confidence → needs-review card, never a silent wrong merge.
Cost/latency: zero. Privacy: unchanged (fully local on desktop). Complexity: unchanged.

**(b) LLM fallback on low-confidence threads, specific categories, hosted Pro only.**
Trigger (exact): `classifyThread(thread).confidence < 0.5` AND reasons intersect
`{company_platform_fallback, mixed_signal, recruiter_sourcing_no_application}` — i.e., only the
threads the UI already flags for human review; on current behavior that is a small minority of
threads (the corpus flags 8 of 146 cases low-confidence). One call per flagged thread, subject +
≤600-char snippets only, output constrained to `{company?, status?, confidence}`, never written
without the `needsReview` flag preserved.
Expected gain: resolves part of the agency/multi-company/ambiguous-platform residue and acts as a
safety net for unseen phrasings between corpus updates. Grounded estimate: single-digit % of
threads affected; on the measured corpus, 0 additional cases — the gain is entirely in the
unmeasured tail.
Cost/latency: with a small model (Haiku tier), roughly $0.001–0.01 per flagged thread, ~1s added
only on flagged threads during sync (async, non-blocking is feasible).
Privacy: derived snippets leave the machine — acceptable only on the hosted tier where mail
already transits the service; NEVER for the local-first desktop tier. Fits the existing
Pro/hosted gating (`entitlement.ts`) as a Pro feature toggle, default off.
Complexity: new external dependency in sync, API keys/quotas, failure modes, eval split
(rules-vs-LLM attribution), and a second brain to keep honest.

**(c) LLM-first.**
Expected gain over (b): marginal — the rules already handle the head correctly and deterministically.
Cost: every thread, every sync; latency on the whole board; total privacy inversion for desktop
(a local-first product would ship mail content to an API by default); the parity/confidence
architecture would be bypassed wholesale. Complexity: highest. Not justified by any measured failure.

## Recommendation

**(a) Rules-only today, with (b) pre-specified as the trigger-ready fallback — do not implement
(b) until needs-review telemetry justifies it.** Concretely: instrument how many threads per user
persist in `needsReview` after a week and how often users correct them; if that floor stays above
a few per user per month, implement (b) exactly as scoped above (trigger, Haiku tier, hosted-Pro
opt-in, output schema).

**Strongest argument against this recommendation:** the eval can't see the tail. The corpus is
built from cases we already understood; a real inbox contains phrasings and layouts nobody
encoded, and every one of them is a silent miss until a user notices and reports it. A cheap LLM
fallback on exactly the flagged threads would catch part of that tail *now* for cents per month,
and deferring it trades user-visible errors for architectural purity. If user trust in the board
matters more than the marginal infra, (b)-now is the better call — which is why it ships here
fully specified, one decision away.

STOP: per the mission, nothing beyond this memo is implemented.
