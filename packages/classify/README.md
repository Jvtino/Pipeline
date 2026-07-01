# @pipeline/classify

Pipeline's classifier "brain", in TypeScript — the **single source of truth** for:

- **`detectStatus(text)`** — scores email text into `applied | interview | offer | rejected` (scored, not first-match; negation-aware).
- **`classifyStatus(text)`** — the same label as `detectStatus`, **plus a confidence (0..1) and the reasons** it decided (`strong_phrase`, `weak_cue_only`, `mixed_signal`, `no_signal`). The confidence was always computed internally — this just stops throwing it away.
- **`resolveCompany(thread)`** — recovers the real employer behind an ATS (Greenhouse, Lever, Workday, LinkedIn, Indeed, …) from the sender name → subject → body.
- **`extractRole(subject)`**, plus the helpers (`companyFromDomain`, `cleanCompanyName`, `rootName`, …).
- **`classifyThread(thread)`** (in `aggregate.ts`) — the rich, self-describing result for a whole thread: status + overall confidence + reasons, a `company`/`role` each with a confidence and a "fell back" flag, and the four value-or-null enrichment fields below.

### Confidence & enrichment (additive; never fabricated)

`classifyThread` flags a thread **low-confidence** (→ "needs review" in the UI) when the status rests on weak cues, a decisive email carries a conflicting signal (`mixed_signal`), the employer could only be resolved to the ATS **platform** (`company_platform_fallback`), the role is the generic fallback (`role_generic_fallback`), or it's inbound **recruiter sourcing with no application** in the thread (`recruiter_sourcing_no_application`, so cold outreach never floods the board as a confident interview).

The enrichment extractors (`extract.ts`) each return a real value **or `null`** — they return the *matched text*, never a parsed/normalized guess, so a wrong-but-confident value is impossible:

- `extractInterview` — explicit date/time text and/or a booking link (Calendly, …). No timezone math.
- `extractCompensation` — `$120k`, `$120,000–$150,000`, `$60/hr`, `£90k`; vague phrases ("competitive salary", "DOE") → `null`.
- `extractLocation` — Remote / Hybrid / on-site / "City, ST".
- `extractRecruiterContact` — sign-off name + title/email, only when clearly present.

Pure and dependency-free at runtime (only type-imports from `@pipeline/contracts`). Imported by the hosted web app, the API/workers, and — for display normalization only — the mobile companion. See `docs/Pipeline-Transformation-Plan.md` §6 (Decision #5).

## Parity with the legacy build

The root `classify.js` (CommonJS) stays the **frozen** local/desktop build. `src/parity.test.ts` asserts this TS port and the legacy JS agree on the **five gated primitives** (`detectStatus`, `resolveCompany`, `companyFromDomain`, `companyFromSenderName`, `extractRole`) over `corpus/cases.json` (plus adversarial inputs), so the two copies can't silently drift.

Everything new here (confidence, reasons, `classifyThread`, the extractors, role cleanup) is **additive and TS-only** — `classify.js` is **untouched**, so the label/company/role the two builds show stay identical while the web/API gain the richer signal. **Grow `corpus/cases.json` with every real-world misclassification.**

```bash
pnpm --filter @pipeline/classify build
pnpm --filter @pipeline/classify test   # unit + parity gate
```

## Try the brain on one email

See status + confidence + reasons + enrichment for a single message (offline, no server):

```bash
pnpm --filter @pipeline/classify try     # built-in sample
pnpm --filter @pipeline/classify try -- --subject "..." --body "..." --domain greenhouse.io --from "Acme <x@greenhouse.io>"
```

## Growing the corpus from a real mistake (offline, no deps)

When the brain gets one wrong, capture it so a test locks in the fix. Prints the JSON to paste by default; add `--write` to append it (note: `--write` reformats the file to standard 2-space JSON — use the default dry-run to keep the compact style):

```bash
node packages/classify/scripts/add-case.mjs status       --text "Your application was viewed." --expected null
node packages/classify/scripts/add-case.mjs roleClean    --raw "SWE (Remote) — Req #12" --company Acme --clean "SWE"
node packages/classify/scripts/add-case.mjs compensation --text "Base is $130k." --expect "$130k"
# …then: pnpm --filter @pipeline/classify test
```

Kinds: `status`, `company`, `companyFromDomain`, `companyFromSenderName_null`, `role`, `roleClean`, `confidence`, `interview`, `compensation`, `location`, `recruiterContact`, `sourcing`. Flags accept `null`/`true`/`false`/numbers (coerced); everything else is a string. No telemetry, no network.
