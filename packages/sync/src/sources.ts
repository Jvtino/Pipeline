// Concrete MailSources for Gmail (history API) and Microsoft Graph (delta query).
//
// These hit the live provider APIs, so they are exercised with real tokens, not
// in CI (the engine's semantics are unit-tested with a fake source). They are
// structured to match providers.py / the desktop fetchers. A token is passed in;
// the caller refreshes via @pipeline/providers.validAccessToken first.
import { mapGmailThread, mapGraphMessagesToThreads, fetchTransport, type HttpTransport } from "@pipeline/providers";
import { ATS_SENDER_DOMAINS } from "@pipeline/classify";
import type { Thread } from "@pipeline/contracts";
import type { MailSource, FetchResult } from "./engine";

/* eslint-disable @typescript-eslint/no-explicit-any */

const DAY_MS = 86_400_000;

// A generous SUPERSET query — it only narrows what we fetch (so we don't pull the
// whole mailbox). The authoritative relevance decision is the shared
// looksLikeJobApplication() gate in the engine, identical for every provider, so
// this must not pre-exclude anything that gate would keep. Covers ATS senders
// (which carry no keywords — the from: list is generated from the same
// ATS_SENDER_DOMAINS the gate's isAtsDomain() recognises, so the two can't drift)
// plus application-context phrases, including the offer/position-filled wording
// the gate keeps (JOB_APPLICATION_RE has "offer letter" / "pleased to offer" /
// "position has been filled").
const GMAIL_FROM = ATS_SENDER_DOMAINS.map((d) => `from:${d}`).join(" OR ");
const GMAIL_Q =
  "in:anywhere newer_than:1y (" +
  GMAIL_FROM + " OR " +
  '"thank you for applying" OR "your application" OR "received your application" OR ' +
  '"application has been" OR "applying for" OR "applying to" OR "applied to" OR ' +
  '"your candidacy" OR "schedule an interview" OR "interview invitation" OR ' +
  '"offer of employment" OR "offer letter" OR "pleased to offer" OR "your offer from" OR ' +
  '"position has been filled" OR "move forward with your application" OR "unfortunately, after" OR ' +
  'subject:(application OR applying OR interview OR candidacy OR recruiting OR "job application")' +
  ")";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
// First-import safety cap. Applies ONLY to the backfill search (bounded, newest
// mailbox slice); the delta path must never cap — its cursor advances past every
// reported change, so anything not fetched would be lost for good, not deferred.
const GMAIL_BACKFILL_THREADS = 200;

/** Gmail API error surfaced from the error envelope (fetchTransport never throws on HTTP status). */
export class GmailApiError extends Error {
  readonly code: number | undefined;
  constructor(what: string, err: { message?: string; code?: number }) {
    super(`gmail ${what} failed: ${err.message ?? JSON.stringify(err)}`);
    this.code = err.code;
  }
}

// fetchTransport returns Gmail's error envelope instead of throwing — without
// this check a failed call reads as "zero results", the sync reports success,
// and (on the backfill) the cursor is saved anyway, silently skipping the
// entire first import.
function gmailOk(data: Record<string, unknown>, what: string): Record<string, unknown> {
  const err = data?.error as { message?: string; code?: number } | undefined;
  if (err) throw new GmailApiError(what, err);
  return data;
}

async function gmailThreadIdsFromSearch(token: string, t: HttpTransport): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken = "";
  do {
    const url =
      `${GMAIL}/messages?q=${encodeURIComponent(GMAIL_Q)}&maxResults=100` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const data = gmailOk(await t.getJson(url, token), "search");
    for (const m of (data.messages as any[]) ?? []) if (m.threadId) ids.add(m.threadId);
    pageToken = (data.nextPageToken as string) ?? "";
  } while (pageToken && ids.size < 500);
  return [...ids];
}

async function gmailFetchThreads(ids: string[], token: string, t: HttpTransport, limit: number): Promise<Thread[]> {
  const out: Thread[] = [];
  for (const id of ids.slice(0, limit)) {
    try {
      const data = await t.getJson(
        `${GMAIL}/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        token,
      );
      if ((data as any).error) continue; // skip a thread we couldn't fetch
      out.push(mapGmailThread(data as any));
    } catch {
      /* skip a thread we couldn't fetch */
    }
  }
  return out;
}

async function gmailCurrentHistoryId(token: string, t: HttpTransport): Promise<string> {
  const p = gmailOk(await t.getJson(`${GMAIL}/profile`, token), "profile");
  return String(p.historyId ?? "");
}

async function gmailChangedThreadIds(
  token: string,
  cursor: string,
  t: HttpTransport,
): Promise<{ ids: string[]; historyId: string }> {
  const ids = new Set<string>();
  let pageToken = "";
  let latest = cursor;
  do {
    const url =
      `${GMAIL}/history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded&maxResults=100` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const data = gmailOk(await t.getJson(url, token), "history");
    for (const h of (data.history as any[]) ?? [])
      for (const ma of (h.messagesAdded as any[]) ?? []) {
        const tid = ma?.message?.threadId;
        if (tid) ids.add(tid);
      }
    if (data.historyId) latest = String(data.historyId);
    pageToken = (data.nextPageToken as string) ?? "";
  } while (pageToken);
  return { ids: [...ids], historyId: latest };
}

export function gmailSource(token: string, transport: HttpTransport = fetchTransport): MailSource {
  const backfill = async (): Promise<FetchResult> => {
    const ids = await gmailThreadIdsFromSearch(token, transport);
    const threads = await gmailFetchThreads(ids, token, transport, GMAIL_BACKFILL_THREADS);
    return { threads, cursor: await gmailCurrentHistoryId(token, transport) };
  };
  return {
    async fetch({ cursor }): Promise<FetchResult> {
      if (!cursor) return backfill();
      let changed: { ids: string[]; historyId: string };
      try {
        changed = await gmailChangedThreadIds(token, cursor, transport);
      } catch (e) {
        // Gmail expires old history ids (404): the saved cursor is dead, so a
        // fresh backfill is the only way forward — erroring would wedge the
        // connection on the same dead cursor every sync.
        if (e instanceof GmailApiError && e.code === 404) return backfill();
        throw e;
      }
      // No cap here: the cursor advances past every change (see above).
      const threads = await gmailFetchThreads(changed.ids, token, transport, Infinity);
      return { threads, cursor: changed.historyId || cursor };
    },
  };
}

// Microsoft Graph's inbox delta hands back the WHOLE mailbox, which floods the
// board with non-application mail. The desktop app (msgraph.js) never does that —
// it uses a Graph $search KEYWORD query, so only job-related mail is ever fetched.
// We mirror the desktop: the keyword $search across the mailbox plus the Junk
// folder, paged to a safety cap — widened with the shared ATS from: terms so
// keyword-less ATS mail (a Greenhouse rejection, a Workday update) is fetched
// for Outlook exactly like it is for Gmail.
//
// A $search has no delta token, so instead the query is DATE-BOUNDED via KQL:
// the first sync backfills the last year (mirroring Gmail's newer_than:1y), and
// every later sync re-searches only from the saved last-synced marker (minus a
// small overlap). That keeps steady-state rounds O(recent mail) and stops years
// of old keyword matches from crowding new mail out of the result cap.
const GRAPH_KEYWORDS =
  "application OR applying OR interview OR candidacy OR candidate OR recruiting OR position OR offer";
const GRAPH_FROM = ATS_SENDER_DOMAINS.map((d) => `from:${d}`).join(" OR ");
const GRAPH_SELECT = "subject,from,receivedDateTime,bodyPreview,conversationId";
const GRAPH_MAX_MESSAGES = 1000;
const GRAPH_BACKFILL_DAYS = 365;
const GRAPH_OVERLAP_DAYS = 7; // re-search window behind the cursor (late arrivals, clock skew)

/** KQL received>= lower bound: the saved cursor (minus overlap), else a 1-year backfill. */
function graphSinceIso(cursor: string | undefined, nowMs: number): string {
  const parsed = cursor ? Date.parse(cursor) : NaN;
  const since = Number.isNaN(parsed) ? nowMs - GRAPH_BACKFILL_DAYS * DAY_MS : parsed - GRAPH_OVERLAP_DAYS * DAY_MS;
  return new Date(since).toISOString().slice(0, 10);
}

function graphKql(sinceIso: string): string {
  return `received>=${sinceIso} AND (${GRAPH_KEYWORDS} OR ${GRAPH_FROM})`;
}

function graphSearchUrl(kql: string, top: number, folderPrefix: string): string {
  const search = encodeURIComponent(`"${kql}"`);
  return `https://graph.microsoft.com/v1.0/me/${folderPrefix}messages?$search=${search}&$select=${GRAPH_SELECT}&$top=${top}`;
}

async function graphSearchMessages(token: string, t: HttpTransport, kql: string): Promise<any[]> {
  const all: any[] = [];
  const seen = new Set<string>();
  const add = (data: Record<string, unknown>): void => {
    for (const m of (data.value as any[]) ?? []) {
      const id = m?.id as string | undefined;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      all.push(m);
    }
  };
  // Whole mailbox, paged via @odata.nextLink.
  let url = graphSearchUrl(kql, 100, "");
  let smalledTop = false;
  while (url && all.length < GRAPH_MAX_MESSAGES) {
    const data = await t.getJson(url, token);
    // Some tenants reject a large $top on $search — retry the page once smaller.
    // (fetchTransport doesn't throw on HTTP errors; it returns the error envelope.)
    if (data.error) {
      if (!smalledTop) { smalledTop = true; url = graphSearchUrl(kql, 25, ""); continue; }
      break; // return what we have rather than fail the whole sync
    }
    add(data);
    url = (data["@odata.nextLink"] as string) ?? "";
  }
  // Junk folder — consumer (Outlook.com / live / hotmail) accounts often miss it
  // in the main search. Well-known folder id "junkemail" works for personal mailboxes.
  try {
    const junk = await t.getJson(graphSearchUrl(kql, 50, "mailFolders/junkemail/"), token);
    if (!junk.error) add(junk);
  } catch {
    /* non-fatal — junk folder unavailable */
  }
  return all;
}

export function graphSource(token: string, transport: HttpTransport = fetchTransport): MailSource {
  return {
    async fetch({ cursor }): Promise<FetchResult> {
      const kql = graphKql(graphSinceIso(cursor, Date.now()));
      const messages = await graphSearchMessages(token, transport, kql);
      // The cursor is the last-synced marker that bounds the NEXT round's
      // received>= restriction (a $search has no real delta token).
      return { threads: mapGraphMessagesToThreads(messages), cursor: new Date().toISOString() };
    },
  };
}
