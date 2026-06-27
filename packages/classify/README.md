# @pipeline/classify

Pipeline's classifier "brain", in TypeScript — the **single source of truth** for:

- **`detectStatus(text)`** — scores email text into `applied | interview | offer | rejected` (scored, not first-match; negation-aware).
- **`resolveCompany(thread)`** — recovers the real employer behind an ATS (Greenhouse, Lever, Workday, LinkedIn, Indeed, …) from the sender name → subject → body.
- **`extractRole(subject)`**, plus the helpers (`companyFromDomain`, `cleanCompanyName`, `rootName`, …).

Pure and dependency-free at runtime (only type-imports from `@pipeline/contracts`). Imported by the hosted web app, the API/workers, and — for display normalization only — the mobile companion. See `docs/Pipeline-Transformation-Plan.md` §6 (Decision #5).

## Parity with the legacy build

The root `classify.js` (CommonJS) stays as the **frozen** local/desktop build. `src/parity.test.ts` asserts this TS port and the legacy JS agree on every case in `corpus/cases.json` (plus adversarial inputs), so the two copies can't silently drift. **Grow `corpus/cases.json` with every real-world misclassification.**

```bash
pnpm --filter @pipeline/classify build
pnpm --filter @pipeline/classify test   # unit + parity gate
```
