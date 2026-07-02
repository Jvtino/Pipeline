// Pure provider → unified-thread mappers. Behaviour matches the desktop
// gmail.js / msgraph.js (see the legacy test/mappers.test.js corpus): every
// provider emits the SAME { threadId, domain, subject, messages:[{date,from,body}] }
// shape so the classifier and UI consume them uniformly.
import type { Thread, Message } from "@pipeline/contracts";

const BODY_CHARS = 600;

export function clean(text: string | null | undefined): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, BODY_CHARS);
}

/** Lowercased sender domain; "unknown" when there's no parseable address. */
export function domainOf(addr: string | null | undefined): string {
  const m = /@([^>\s]+)/.exec(String(addr ?? ""));
  return m ? m[1]!.toLowerCase() : "unknown";
}

function isoFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* -------------------------------------- Gmail -------------------------------------- */

/** Case-insensitive header lookup over Gmail's [{name,value}] list; "" when absent. */
export function header(headers: { name?: string; value?: string }[] | undefined, name: string): string {
  for (const h of headers ?? []) {
    if ((h.name ?? "").toLowerCase() === name.toLowerCase()) return h.value ?? "";
  }
  return "";
}

/** Prefer Gmail's internalDate (ms epoch), fall back to a Date header, then today. */
export function isoFromInternal(ms: string | number | null | undefined, fallbackHeader?: string): string {
  if (ms !== null && ms !== undefined && `${ms}`.length > 0) {
    const n = Number(ms);
    if (Number.isFinite(n)) return isoFromDate(new Date(n));
  }
  if (fallbackHeader) {
    const d = new Date(fallbackHeader);
    if (!Number.isNaN(d.getTime())) return isoFromDate(d);
  }
  return isoFromDate(new Date());
}

interface GmailPart {
  filename?: string;
  mimeType?: string;
  headers?: { name?: string; value?: string }[];
  body?: { size?: number; attachmentId?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id?: string;
  internalDate?: string | number;
  snippet?: string;
  payload?: GmailPart;
}

/** Walk the MIME tree for real attachments (named, non-inline). METADATA only —
 *  filename/type/size; the content is never requested. */
function gmailAttachments(part: GmailPart | undefined, out: NonNullable<Message["attachments"]> = []): Message["attachments"] {
  if (!part) return out.length ? out : undefined;
  const disposition = (part.headers ?? []).find((h) => (h.name ?? "").toLowerCase() === "content-disposition")?.value ?? "";
  if (part.filename && part.body?.attachmentId && !/^\s*inline/i.test(disposition)) {
    out.push({ name: part.filename, contentType: part.mimeType ?? null, size: part.body.size ?? null });
  }
  for (const p of part.parts ?? []) gmailAttachments(p, out);
  return out.length ? out : undefined;
}
interface GmailThread {
  id?: string;
  messages?: GmailMessage[];
}

export function mapGmailThread(thread: GmailThread): Thread {
  const rows = (thread.messages ?? []).map((m) => {
    const hs = m.payload?.headers ?? [];
    const frm = header(hs, "From");
    return {
      id: m.id,
      date: isoFromInternal(m.internalDate, header(hs, "Date")),
      from: frm || "unknown",
      domain: domainOf(frm),
      subject: header(hs, "Subject") || "(no subject)",
      body: clean(m.snippet),
      attachments: gmailAttachments(m.payload),
    };
  });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const first = rows[0];
  // The Gmail web UI addresses a message directly by its id under #all/.
  const messages: Message[] = rows.map((r) => ({
    date: r.date,
    from: r.from,
    body: r.body,
    ...(r.id ? { id: r.id, webLink: `https://mail.google.com/mail/u/0/#all/${r.id}` } : {}),
    ...(r.attachments ? { attachments: r.attachments } : {}),
  }));
  return {
    threadId: thread.id ?? "",
    domain: first?.domain ?? "unknown",
    subject: first?.subject ?? "(no subject)",
    messages,
  };
}

/* -------------------------------------- Microsoft Graph -------------------------------------- */

export function isoDate(s: string | null | undefined): string {
  const d = new Date(String(s ?? ""));
  return Number.isNaN(d.getTime()) ? isoFromDate(new Date()) : isoFromDate(d);
}

interface GraphAttachment {
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
}
interface GraphMessage {
  id?: string;
  conversationId?: string;
  subject?: string;
  receivedDateTime?: string;
  bodyPreview?: string;
  webLink?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  attachments?: GraphAttachment[];
}

/** Attachment METADATA only; unnamed and inline (signature images…) parts are dropped. */
function mapAttachments(list: GraphAttachment[] | undefined): Message["attachments"] {
  const named = (list ?? []).filter((a) => a.name && !a.isInline);
  if (!named.length) return undefined;
  return named.map((a) => ({ name: a.name!, contentType: a.contentType ?? null, size: a.size ?? null }));
}

export function mapGraphMessagesToThreads(messages: GraphMessage[] | null | undefined): Thread[] {
  type Row = { date: string; from: string; domain: string; subject: string; body: string; id?: string; attachments?: Message["attachments"]; webLink?: string };
  const groups = new Map<string, Row[]>();
  let counter = 0;
  for (const m of messages ?? []) {
    const conv = m.conversationId || m.id || `g${counter++}`;
    const ea = m.from?.emailAddress ?? {};
    const addr = ea.address ?? "";
    const name = ea.name ?? addr;
    const from = addr && name && name !== addr ? `${name} <${addr}>` : addr || name || "unknown";
    const attachments = mapAttachments(m.attachments);
    const row: Row = {
      date: isoDate(m.receivedDateTime),
      from,
      domain: domainOf(addr),
      subject: m.subject || "(no subject)",
      body: clean(m.bodyPreview),
      ...(m.id ? { id: m.id } : {}),
      ...(attachments ? { attachments } : {}),
      ...(m.webLink ? { webLink: m.webLink } : {}),
    };
    const arr = groups.get(conv);
    if (arr) arr.push(row);
    else groups.set(conv, [row]);
  }

  const threads: Thread[] = [];
  for (const [conv, rows] of groups) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const first = rows[0]!;
    threads.push({
      threadId: conv,
      domain: first.domain,
      subject: first.subject,
      messages: rows.map((r) => ({
        date: r.date,
        from: r.from,
        body: r.body,
        ...(r.id ? { id: r.id } : {}),
        ...(r.attachments ? { attachments: r.attachments } : {}),
        ...(r.webLink ? { webLink: r.webLink } : {}),
      })),
    });
  }
  threads.sort((a, b) => {
    const al = a.messages[a.messages.length - 1]?.date ?? "";
    const bl = b.messages[b.messages.length - 1]?.date ?? "";
    return bl.localeCompare(al); // newest activity first
  });
  return threads;
}
