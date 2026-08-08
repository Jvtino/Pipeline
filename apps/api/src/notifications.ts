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
import type { PushGateway, PushMessage, SendOutcome } from "./push";

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

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Deliver one logical notification, claiming the send-once ledger PER DEVICE.
 *
 * Per device is the only honest granularity. The gateway reports success or
 * failure for each token separately and sends in chunks of 100, so a batch can
 * come back half-delivered — one claim covering the whole batch would either
 * strand the devices that missed out (claim stands, nobody retries) or
 * re-notify the ones that already got it (claim released, everyone re-sent).
 *
 * Each outcome decides the fate of its own claim:
 *   delivered              → claim stands; that device is never told twice
 *   transient failure      → claim released; a later tick retries THAT device
 *   device not registered  → claim stands, token disabled (nothing to retry)
 *
 * The gateway reports failures rather than throwing, so `ok` is the signal
 * that matters; a throw is handled too, for gateways that do throw.
 */
async function claimAndSend(
  deps: NotifyDeps,
  claim: { userId: string; kind: "transition" | "interview"; dedupeKey: string },
  make: (token: string) => PushMessage,
): Promise<void> {
  const devices = await listActiveDevices(deps.db, claim.userId);
  const wanted = devices.filter((d) => (claim.kind === "interview" ? d.notifyReminders : d.notifyStatusChanges));
  if (!wanted.length) return;

  const keyFor = (token: string) => `${claim.dedupeKey}:${token}`;
  const release = (token: string) =>
    releasePushClaim(deps.db, keyFor(token)).catch((e) =>
      deps.log?.(`push: claim release failed for ${token.slice(0, 12)}…: ${errText(e)}`),
    );

  // Claim first (that's what makes send-once hold under overlapping ticks),
  // then send only to the devices whose claim we won.
  const fresh: typeof wanted = [];
  for (const d of wanted) {
    if (await recordPushOnce(deps.db, { userId: claim.userId, kind: claim.kind, dedupeKey: keyFor(d.expoPushToken) })) {
      fresh.push(d);
    }
  }
  if (!fresh.length) return; // every device already has this one

  let outcomes: SendOutcome[];
  try {
    outcomes = await deps.gateway.send(fresh.map((d) => make(d.expoPushToken)));
  } catch (e) {
    // Nothing is known to have landed — hand every claim back.
    deps.log?.(`push: send threw, releasing ${fresh.length} claim(s): ${errText(e)}`);
    for (const d of fresh) await release(d.expoPushToken);
    return;
  }

  for (const o of outcomes) {
    if (o.deviceNotRegistered) {
      try {
        await disableDeviceByToken(deps.db, o.token);
        deps.log?.(`push: disabled dead token ${o.token.slice(0, 12)}…`);
      } catch (e) {
        deps.log?.(`push: couldn't disable dead token (will retry next send): ${errText(e)}`);
      }
    } else if (!o.ok) {
      // Transport blip, rate limit, oversized payload — nothing landed on this
      // device, so let a later tick try it again.
      deps.log?.(`push: not delivered to ${o.token.slice(0, 12)}… — releasing for retry`);
      await release(o.token);
    }
  }

  // A gateway that answered for fewer tokens than it was given leaves those
  // devices un-notified; releasing their claims keeps them retryable.
  const reported = new Set(outcomes.map((o) => o.token));
  for (const d of fresh) {
    if (!reported.has(d.expoPushToken)) {
      deps.log?.(`push: no outcome reported for ${d.expoPushToken.slice(0, 12)}… — releasing for retry`);
      await release(d.expoPushToken);
    }
  }
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
