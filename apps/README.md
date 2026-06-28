# Pipeline — hosted app (Phase 2)

The hosted product from `docs/Pipeline-Transformation-Plan.md`, in progress. Two apps over the shared packages (`@pipeline/contracts`, `@pipeline/classify`):

- **`apps/api`** — Fastify (TypeScript). Reduces threads through `@pipeline/classify` into **derived application records** (company, role, status, dates, ≤600-char snippet — never raw email) and serves them, contract-validated, at `GET /api/applications`.
- **`apps/web`** — React + Vite. Renders the company-grouped board from the API.

> **Status:** runs on **demo data**. Real Google/Microsoft OAuth connect, per-user persistence (Postgres), envelope-encrypted tokens, and incremental sync are the next steps (plan §8/§10) — not built yet.

## Run it locally

**Easiest (macOS, no terminal):** double-click **`start.command`** in the repo
root. It installs everything, starts the API + web, and opens your browser at
http://localhost:5173. (Needs [Node.js](https://nodejs.org) installed first.)

**Manual** — from the repo root (needs [pnpm](https://pnpm.io)):

```bash
pnpm install --filter "@pipeline/*..."     # first time
pnpm --filter @pipeline/contracts build    # build the shared packages once
pnpm --filter @pipeline/classify build

# two terminals:
pnpm --filter @pipeline/api dev            # API on http://localhost:3001
pnpm --filter @pipeline/web dev            # web on http://localhost:5173 (proxies /api -> 3001)
```

Open **http://localhost:5173**. The web dev server proxies `/api/*` to the API, so it's same-origin in dev and prod alike.

## Test

```bash
pnpm --filter "@pipeline/*" test           # contracts + classifier (incl. parity gate) + API reduction
```
