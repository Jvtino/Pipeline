# MIGRATION_PLAN — data-repair considerations for the Known Issue A fixes

**Status: REPORT ONLY. Nothing here is implemented. Approval is required before any of it ships.**

## What needs no migration (verified)

- **Hosted (web/API/DB)**: application records are stored one-per-thread and re-derived on every
  sync (`upsertApplications` overwrites company/role/status). Bundling happened at *board build
  time*, not at rest. With the extraction + grouping fixes, existing records self-heal on the
  next sync; boards built from stored records stop merging as soon as records re-sync (the new
  nullable `platform_fallback` column backfills via the idempotent `ADD COLUMN IF NOT EXISTS` —
  additive schema, no data rewrite).
- **Desktop board**: threads are re-fetched and re-classified on every sync; grouping is computed
  in-memory. No stored company data to repair.

## The one real migration concern (desktop IMAP users only)

The IMAP threading fix changes the derived thread key for shared-ATS mail
(`domain|subject` → `domain|subject|company` or `domain|subject|messageId`). Desktop threadIds
are derived from that key (`imap-<base64>`), and three localStorage stores key on them:

- `pipeline.statusOverrides` (manual status corrections)
- pinned positions (by app id)
- `pipeline.manualPositions` is unaffected (its ids are user-generated)

**Impact**: after updating, an IMAP-connected desktop user's manual overrides/pins that pointed
at *ATS-domain threads* stop matching (the thread now has a new id). Non-ATS threads keep their
exact old ids. Gmail/Outlook (API-threaded) desktop users are entirely unaffected — only the
IMAP path derives ids from the grouping key.

**Proposed repair (NOT implemented)**: on first load after update, for each orphaned override/pin
id, re-key it by matching the old thread's `(domain, normalized subject)` against the new thread
list; when exactly one new thread matches, transfer the override; otherwise drop it and surface a
one-time "N manual changes could not be carried over" notice. Small, self-contained, runs once.

**Why not silently shipped**: rewriting user-entered corrections heuristically can attach a
status override to the WRONG company — corrupting user data is worse than a one-time loss of a
pin. Decision needed: ship the re-keying repair, or accept the one-time orphaning with a notice.

## Approval requested

1. Accept one-time orphaning of IMAP-thread overrides/pins (do nothing), OR
2. Approve the re-keying repair above as a separate reviewed diff.
