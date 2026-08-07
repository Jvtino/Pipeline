// Notification POLICY — who is told what, exactly once. Two triggers only
// (status changes from sync, interview reminders) — no engagement spam, ever.
// Every logical notification claims a dedupe key in the push_log ledger before
// sending, so overlapping sync ticks, worker+web scheduler overlap, and
// restarts can never double-send. Payloads carry ids, not mail content.
import {
  listActiveDevices,
  recordPushOnce,
  releasePushClaim,
  disableDeviceByToken,
  listApplicationsWithEnrichment,
  type Database,
  type StatusTransition,
} from "@pipeline/db";
import type { PushGateway, PushMessage } from "./push";

export interface NotifyDeps {
  db: Database;
  gateway: PushGateway;
  now?: () => Date; // injectable clock for tests
  log?: (msg: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/**
 * Deliver one logical notification to every opted-in device.
 *
 * THROWS ONLY WHEN NOTHING WAS SENT (device lookup or the gateway call itself
 * failed) — that's the contract callers rely on to decide whether releasing
 * the dedupe claim is safe. Post-send bookkeeping (disabling tokens the
 * gateway reported dead) is best-effort: the push already went out, so a
 * failure there must never look like a failed delivery and must never cost
 * the user a re-send.
 */
async function deliver(deps: NotifyDeps, userId: string, kind: "transition" | "interview", make: (token: string) => PushMessage): Promise<void> {
  const devices = await listActiveDevices(deps.db, userId);
  const wanted = devices.filter((d) => (kind === "interview" ? d.notifyReminders : d.notifyStatusChanges));
  if (!wanted.length) return;
  const outcomes = await deps.gateway.send(wanted.map((d) => make(d.expoPushToken)));
  for (const o of outcomes) {
    if (!o.deviceNotRegistered) continue;
    try {
      await disableDeviceByToken(deps.db, o.token);
      deps.log?.(`push: disabled dead token ${o.token.slice(0, 12)}…`);
    } catch (e) {
      deps.log?.(`push: couldn't disable dead token (will retry next send): ${errText(e)}`);
    }
  }
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Claim → send → (on a failed send) give the claim back. The ledger is
 * claim-first so send-once holds under concurrent ticks; this pairs it with a
 * release so a transient gateway outage costs a retry, not the notification.
 * Returns false when the claim was already taken (someone else sent it).
 */
async function claimAndSend(
  deps: NotifyDeps,
  claim: { userId: string; kind: "transition" | "interview"; dedupeKey: string },
  make: (token: string) => PushMessage,
): Promise<boolean> {
  const claimed = await recordPushOnce(deps.db, claim);
  if (!claimed) return false;
  try {
    await deliver(deps, claim.userId, claim.kind, make);
  } catch (e) {
    // deliver() only throws before anything left the building, so the claim is
    // safe to hand back — a later tick will try this notification again.
    deps.log?.(`push: send failed, releasing claim ${claim.dedupeKey}: ${errText(e)}`);
    await releasePushClaim(deps.db, claim.dedupeKey).catch((releaseError) => {
      deps.log?.(`push: claim release failed for ${claim.dedupeKey}: ${errText(releaseError)}`);
    });
  }
  return true;
}

/**
 * Status-change pushes, fed by the sync engine's transition stream. Skips
 * user-overridden records (their word already outranks the classifier — a
 * "moved to X" ping would be noise) and claims `${userId}:${threadId}:${to}`
 * before sending. Backfill suppression already happened upstream.
 */
export async function notifyTransitions(deps: NotifyDeps, userId: string, transitions: StatusTransition[]): Promise<void> {
  for (const t of transitions) {
    if (t.overridden) continue;
    const label = STATUS_LABEL[t.to] ?? t.to;
    // Isolated per transition: one unlucky record must not cost this user the
    // rest of their batch.
    try {
      await claimAndSend(deps, { userId, kind: "transition", dedupeKey: `${userId}:${t.threadId}:${t.to}` }, (to) => ({
        to,
        title: t.company,
        body: t.isNew ? `New application on your board — ${t.role} (${label})` : `${t.role} moved to ${label}`,
        data: { type: "transition", threadId: t.threadId },
        channelId: "status-changes",
      }));
    } catch (e) {
      deps.log?.(`push: transition notify failed for ${t.threadId}: ${errText(e)}`);
    }
  }
}

/** Reminder windows: "tomorrow" fires inside (1h, 24h] before the interview,
 *  "soon" inside (0, 1h]. Each window has its own dedupe key, so a user who
 *  connects 30 minutes before an interview gets exactly one (the 1h) ping. */
export async function notifyInterviewReminders(deps: NotifyDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const HOUR = 60 * 60 * 1000;
  // This scan spans EVERY user. Each record is isolated below — one bad row
  // (or one user's flaky device state) must never cost every later user their
  // interview reminder, on this tick or any tick after it.
  for (const row of await listApplicationsWithEnrichment(deps.db)) {
    // A record the user closed out must not ping about its (possibly stale)
    // extracted interview — the timeline moved on even if the mail mentioned one.
    if (row.status === "rejected" || row.status === "cancelled") continue;
    // The normalized twin is the computable one — the raw interviewDateTime is
    // the email's own words ("Tuesday, June 12 at 2:30 PM ET"), which
    // Date.parse reads as NaN and would silently skip. The raw fallback keeps
    // reminders working for records enriched before the ISO field existed.
    const iso = row.enrichment.interviewDateTimeIso ?? row.enrichment.interviewDateTime;
    if (!iso) continue;
    // Zone-less machine timestamps (T- OR space-separated — legacy raws use
    // both) are pinned to UTC explicitly: Date.parse would read them in the
    // server's local zone, making reminder windows (and the epoch dedupe key)
    // deploy- and DST-dependent. Prose that only Date.parse understands still
    // falls through — approximate by design, and the deploy target is UTC.
    const zoneless = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)$/.exec(iso);
    const at = zoneless ? Date.parse(`${zoneless[1]}T${zoneless[2]}Z`) : Date.parse(iso);
    if (Number.isNaN(at) || at <= now) continue;
    const until = at - now;
    const window = until <= HOUR ? "1h" : until <= 24 * HOUR ? "24h" : null;
    if (!window) continue;
    const time = /T(\d{2}:\d{2})/.exec(iso)?.[1];
    try {
      // Keyed by the parsed MOMENT, not the string: re-derivation can rewrite
      // "2026-08-10T14:30" to its canonical "…:00" twin without re-pinging, while
      // a genuinely rescheduled interview (different moment) correctly re-fires.
      await claimAndSend(
        deps,
        { userId: row.userId, kind: "interview", dedupeKey: `${row.userId}:${row.threadId}:interview:${at}:${window}` },
        (to) => ({
          to,
          title: `Interview ${window === "1h" ? "in about an hour" : "tomorrow"}`,
          body: `${row.company} — ${row.role}${time ? ` at ${time}` : ""}`,
          data: { type: "interview", threadId: row.threadId },
          channelId: "reminders",
        }),
      );
    } catch (e) {
      deps.log?.(`push: interview reminder failed for ${row.threadId}: ${errText(e)}`);
    }
  }
}

/** Receipt sweep: tokens Expo reported dead after the fact get disabled.
 *  Per-token isolation — one stubborn row can't strand the rest of the sweep. */
export async function sweepReceipts(deps: NotifyDeps): Promise<void> {
  for (const token of await deps.gateway.pollReceipts()) {
    try {
      await disableDeviceByToken(deps.db, token);
      deps.log?.(`push: disabled dead token (receipt) ${token.slice(0, 12)}…`);
    } catch (e) {
      deps.log?.(`push: couldn't disable ${token.slice(0, 12)}… from receipt: ${errText(e)}`);
    }
  }
}
