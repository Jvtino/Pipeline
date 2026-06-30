# Pipeline — hosted app (Phase 2)

The hosted product from `docs/Pipeline-Transformation-Plan.md`, in progress. Two apps over the shared packages (`@pipeline/contracts`, `@pipeline/classify`):

- **`apps/api`** — Fastify (TypeScript). Reduces threads through `@pipeline/classify` into **derived application records** (company, role, status, dates, ≤600-char snippet — never raw email) and serves them, contract-validated, at `GET /api/applications`.
- **`apps/web`** — React + Vite. A warm, light "leather-and-paper" workspace built on the API's
  derived records: a sidebar-and-header shell over Dashboard, Applications, Companies, Contacts,
  Calendar, Tasks, Statistics, Documents, Templates and Settings, plus an application detail drawer,
  a New Application modal, and onboarding/connect. The board, sync and OAuth connect are wired to the
  real API; the 7-status presentation system (the API serves 4), all metrics, and design-only
  interactions (Move stage, manual apps, notes, tasks, sync settings) are derived from the board or
  kept in a client-side `localStorage` overlay — the server contract is untouched. See
  `src/lib/derive.ts` (board → screens) and `src/lib/overlay.ts` (client overlay).

> **Status:** runs on **demo data** out of the box, and can connect a **real
> mailbox** — Google/Microsoft OAuth (PKCE), per-user persistence, envelope-encrypted
> tokens, a relevance-gated incremental sync, and demo data cleared on first connect
> are all wired. Connecting Gmail/Outlook needs **your** OAuth client IDs + consent:
> see **[../CONNECT-MAILBOX.md](../CONNECT-MAILBOX.md)**.

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
