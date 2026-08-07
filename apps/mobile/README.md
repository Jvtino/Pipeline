# @pipeline/mobile

The Pipeline mobile app — Expo (SDK 57) + Expo Router + TanStack Query,
styled entirely from `@pipeline/tokens` (the desktop dark theme). It consumes
derived records from `@pipeline/api` and **never** scans a mailbox, holds a
mail token, or sees raw email.

## Run it

```bash
pnpm install                          # workspace root
pnpm --filter @pipeline/api dev       # the server (localhost:3001)
cd apps/mobile && pnpm start          # press i (iOS sim), a (Android), w (web)
```

Without `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` the app uses the API's development
sign-in (non-production servers only). Android emulators reach the host API via
`10.0.2.2` automatically.

## Modes

| Env | Effect |
|---|---|
| `EXPO_PUBLIC_API_URL` | API origin (default localhost:3001 / 10.0.2.2:3001) |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Real sign-in (Clerk); otherwise dev sign-in |
| `EXPO_PUBLIC_DEMO=1` | No network at all — in-memory demo "server" over the sample inbox |

## Checks

```bash
pnpm build     # tsc --noEmit
pnpm test      # vitest (pure logic: board filtering, calendar, formatting, version gate)
pnpm export    # proves the iOS bundle compiles (Metro)
```

Store builds: `eas.json` profiles (`preview`, `demo`, `production`) via
`.github/workflows/eas.yml` on `mobile-v*` tags — requires the `EXPO_TOKEN`
secret (see `docs/LAUNCH-CHECKLIST.md`).
