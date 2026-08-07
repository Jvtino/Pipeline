// Notification POLICY — who is told what, exactly once. Two triggers only
// (status changes from sync, interview reminders) — no engagement spam, ever.
// Every logical notification claims a dedupe key in the push_log ledger before
// sending, so overlapping sync ticks, worker+web scheduler overlap, and
// restarts can never double-send. Payloads carry ids, not mail content.
import {
  listActiveDevices,
  recordPushOnce,
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

async function deliver(deps: NotifyDeps, userId: string, kind: "transition" | "interview", make: (token: string) => PushMessage): Promise<void> {
  const devices = await listActiveDevices(deps.db, userId);
  const wanted = devices.filter((d) => (kind === "interview" ? d.notifyReminders : d.notifyStatusChanges));
  if (!wanted.length) return;
  const outcomes = await deps.gateway.send(wanted.map((d) => make(d.expoPushToken)));
  for (const o of outcomes) {
    if (o.deviceNotRegistered) {
      await disableDeviceByToken(deps.db, o.token);
      deps.log?.(`push: disabled dead token ${o.token.slice(0, 12)}…`);
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
    const claimed = await recordPushOnce(deps.db, { userId, kind: "transition", dedupeKey: `${userId}:${t.threadId}:${t.to}` });
    if (!claimed) continue;
    const label = STATUS_LABEL[t.to] ?? t.to;
    await deliver(deps, userId, "transition", (to) => ({
      to,
      title: t.company,
      body: t.isNew ? `New application on your board — ${t.role} (${label})` : `${t.role} moved to ${label}`,
      data: { type: "transition", threadId: t.threadId },
      channelId: "status-changes",
    }));
  }
}

/** Reminder windows: "tomorrow" fires inside (1h, 24h] before the interview,
 *  "soon" inside (0, 1h]. Each window has its own dedupe key, so a user who
 *  connects 30 minutes before an interview gets exactly one (the 1h) ping. */
export async function notifyInterviewReminders(deps: NotifyDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const HOUR = 60 * 60 * 1000;
  for (const row of await listApplicationsWithEnrichment(deps.db)) {
    const iso = row.enrichment.interviewDateTime;
    if (!iso) continue;
    const at = Date.parse(iso);
    if (Number.isNaN(at) || at <= now) continue;
    const until = at - now;
    const window = until <= HOUR ? "1h" : until <= 24 * HOUR ? "24h" : null;
    if (!window) continue;
    const claimed = await recordPushOnce(deps.db, {
      userId: row.userId,
      kind: "interview",
      dedupeKey: `${row.userId}:${row.threadId}:interview:${iso}:${window}`,
    });
    if (!claimed) continue;
    const time = /T(\d{2}:\d{2})/.exec(iso)?.[1];
    await deliver(deps, row.userId, "interview", (to) => ({
      to,
      title: `Interview ${window === "1h" ? "in about an hour" : "tomorrow"}`,
      body: `${row.company} — ${row.role}${time ? ` at ${time}` : ""}`,
      data: { type: "interview", threadId: row.threadId },
      channelId: "reminders",
    }));
  }
}

/** Receipt sweep: tokens Expo reported dead after the fact get disabled. */
export async function sweepReceipts(deps: NotifyDeps): Promise<void> {
  for (const token of await deps.gateway.pollReceipts()) {
    await disableDeviceByToken(deps.db, token);
    deps.log?.(`push: disabled dead token (receipt) ${token.slice(0, 12)}…`);
  }
}
