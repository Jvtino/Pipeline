// The push gateway: a thin, injectable seam over Expo's push service. The
// policy layer (notifications.ts) decides WHO gets WHAT; this file only
// delivers — chunked sends, ticket errors, receipt polling — and reports dead
// tokens so the caller can disable them. Payloads carry ids, never content
// beyond the short title/body (plan: nothing sensitive rides in a push).
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";

export interface PushMessage {
  to: string; // Expo push token
  title: string;
  body: string;
  data: Record<string, unknown>;
  channelId?: string; // Android channel
}

export interface SendOutcome {
  token: string;
  ok: boolean;
  /** Provider says this token is gone — disable it, stop sending. */
  deviceNotRegistered: boolean;
}

export interface PushGateway {
  send(messages: PushMessage[]): Promise<SendOutcome[]>;
  /** Poll receipts for earlier sends (iOS invalidation often only shows here).
   *  Returns tokens newly reported dead. */
  pollReceipts(): Promise<string[]>;
}

/** Receipts arrive minutes after a send; keep a bounded buffer of pending
 *  ticket ids (worker process memory — lost on restart, which only means one
 *  missed poll; the next real send re-detects dead tokens). */
const MAX_PENDING_RECEIPTS = 5000;

export function expoPushGateway(): PushGateway {
  const expo = new Expo();
  const pending: { ticketId: string; token: string }[] = [];

  return {
    async send(messages) {
      const valid = messages.filter((m) => Expo.isExpoPushToken(m.to));
      const outcomes: SendOutcome[] = messages
        .filter((m) => !Expo.isExpoPushToken(m.to))
        .map((m) => ({ token: m.to, ok: false, deviceNotRegistered: true })); // malformed = never deliverable

      const expoMessages: ExpoPushMessage[] = valid.map((m) => ({
        to: m.to,
        title: m.title,
        body: m.body,
        data: m.data,
        sound: "default",
        channelId: m.channelId,
      }));
      for (const chunk of expo.chunkPushNotifications(expoMessages)) {
        let tickets: ExpoPushTicket[] = [];
        try {
          tickets = await expo.sendPushNotificationsAsync(chunk);
        } catch {
          // whole-chunk transport failure: report not-ok, keep tokens alive
          outcomes.push(...chunk.map((m) => ({ token: String(m.to), ok: false, deviceNotRegistered: false })));
          continue;
        }
        tickets.forEach((t, i) => {
          const token = String(chunk[i]!.to);
          if (t.status === "ok") {
            if (pending.length < MAX_PENDING_RECEIPTS) pending.push({ ticketId: t.id, token });
            outcomes.push({ token, ok: true, deviceNotRegistered: false });
          } else {
            outcomes.push({ token, ok: false, deviceNotRegistered: t.details?.error === "DeviceNotRegistered" });
          }
        });
      }
      return outcomes;
    },

    async pollReceipts() {
      if (!pending.length) return [];
      const batch = pending.splice(0, pending.length);
      const dead: string[] = [];
      for (const idChunk of expo.chunkPushNotificationReceiptIds(batch.map((p) => p.ticketId))) {
        try {
          const receipts = await expo.getPushNotificationReceiptsAsync(idChunk);
          for (const [id, receipt] of Object.entries(receipts)) {
            if (receipt.status === "error" && receipt.details?.error === "DeviceNotRegistered") {
              const entry = batch.find((p) => p.ticketId === id);
              if (entry) dead.push(entry.token);
            }
          }
        } catch {
          // receipts are best-effort; a missed poll self-heals on the next send
        }
      }
      return dead;
    },
  };
}
