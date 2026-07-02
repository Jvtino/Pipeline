# MIGRATION_PLAN — data repair for the IMAP thread-identity fixes

**Status: APPROVED by the user (option 2) and IMPLEMENTED.** The repair ships alongside the
threading fix; this document records what changes for existing users and how the repair behaves.

## What needs no migration (verified)

- **Hosted (web/API/DB)**: application records are stored one-per-thread and re-derived on every
  sync (`upsertApplications` overwrites company/role/status). Bundling happened at *board build
  time*, not at rest; records self-heal on the next sync. The new nullable `platform_fallback`
  column backfills via the idempotent `ADD COLUMN IF NOT EXISTS` — additive, no data rewrite.
- **Desktop Gmail / Outlook**: threadIds come from the provider APIs, not from a derived key —
  entirely unaffected.
- **Desktop board contents**: threads are re-fetched and re-classified on every sync; only
  user-entered corrections persist locally.

## What changes for desktop IMAP users

Two identity fixes change derived `imap-<hash>` threadIds:

1. **Shared-ATS splitting** (Known Issue A): the thread key now carries the mail's recovered
   employer, so two companies' boilerplate mail stops merging.
2. **Collision fix** (found while building the repair's tests): the old id derivation kept only
   the first 16 base64 chars ≈ the first ~12 bytes of `domain|subject` — barely more than the
   domain — so **every same-domain thread shared one id** and manual status overrides bled across
   unrelated applications. Ids are now a hash of the full key; all IMAP threadIds change.

Locally persisted, thread-id-keyed data: only `pipeline.statusOverrides` (manual status
corrections). Pins and the ignore list key on company *names*, not ids (a pin on a
platform-fallback name like "Myworkday" may detach when the card gains its real employer name —
re-pinning is one click; not repaired by design).

## The implemented repair

- `imap.js` attaches to every thread the id it had under the old scheme (`legacyThreadId`,
  computed with the exact historical derivation — covered by unit tests).
- On each sync, the app re-keys orphaned overrides (`repairOrphanedOverrides` in `index.html`):
  - old id still matches a live thread → untouched;
  - **exactly one** current thread descends from the old id → override transfers to the new id;
  - **several** current threads descend from it (the formerly-collided/bundled cases) → the
    override is **dropped and counted** — under the old scheme it pointed at all of them at once,
    so any transfer would be a guess, and guessing attaches a user's correction to the wrong
    company;
  - **zero** matches (thread outside the current fetch window) → left in place, harmless.
- Repairs persist immediately, so the pass is a no-op afterwards. When anything was dropped, the
  sync status line shows a one-time "⚠ N manual status change(s) couldn't be carried over".

## Residual risk (accepted)

Overrides on formerly-collided/bundled ids are lost (with notice) rather than guessed. If a
dropped override mattered, re-applying it on the now-correctly-separated card is one click — and
it will stick, which under the old colliding ids it effectively couldn't.
