// Concrete MailSources for Gmail (history API) and Microsoft Graph (delta query).
//
// These hit the live provider APIs, so they are exercised with real tokens, not
// in CI (the engine's semantics are unit-tested with a fake source). They are
// structured to match providers.py / the desktop fetchers. A token is passed in;
// the caller refreshes via @pipeline/providers.validAccessToken first.
import { mapGmailThread, mapGraphMessagesToThreads, fetchTransport, type HttpTransport } from "@pipeline/providers";
import type { Thread } from "@pipeline/contracts";
import type { MailSource, FetchResult } from "./engine";

/* eslint-disable @typescript-eslint/no-explicit-any */

// A generous SUPERSET query — it only narrows what we fetch (so we don't pull the
// whole mailbox). The authoritative relevance decision is the shared
// looksLikeJobApplication() gate in the engine, identical for every provider, so
// this must not pre-exclude anything that gate would keep. Covers ATS senders
// (which carry no keywords) plus application-context phrases.
const GMAIL_Q =
  "in:anywhere newer_than:1y (" +
  "from:greenhouse.io OR from:greenhouse-mail.io OR from:hire.lever.co OR from:lever.co OR " +
  "from:myworkday.com OR from:myworkdayjobs.com OR from:workday.com OR from:icims.com OR " +
  "from:ashbyhq.com OR from:smartrecruiters.com OR from:workable.com OR from:jobvite.com OR " +
  "from:bamboohr.com OR from:taleo.net OR from:successfactors.com OR from:indeed.com OR " +
  "from:linkedin.com OR from:ziprecruiter.com OR from:glassdoor.com OR " +
  '"thank you for applying" OR "your application" OR "received your application" OR ' +
  '"application has been" OR "applying for" OR "applying to" OR "applied to" OR ' +
  '"your candidacy" OR "schedule an interview" OR "interview invitation" OR ' +
  '"offer of employment" OR "move forward with your application" OR "unfortunately, after" OR ' +
  'subject:(application OR applying OR interview OR candidacy OR recruiting OR "job application")' +
  ")";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailThreadIdsFromSearch(token: string, t: HttpTransport): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken = "";
  do {
    const url =
      `${GMAIL}/messages?q=${encodeURIComponent(GMAIL_Q)}&maxResults=100` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const data = await t.getJson(url, token);
    for (const m of (data.messages as any[]) ?? []) if (m.threadId) ids.add(m.threadId);
    pageToken = (data.nextPageToken as string) ?? "";
  } while (pageToken && ids.size < 500);
  return [...ids];
}

async function gmailFetchThreads(ids: string[], token: string, t: HttpTransport): Promise<Thread[]> {
  const out: Thread[] = [];
  for (const id of ids.slice(0, 200)) {
    try {
      const data = await t.getJson(
        `${GMAIL}/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        token,
      );
      out.push(mapGmailThread(data as any));
    } catch {
      /* skip a thread we couldn't fetch */
    }
  }
  return out;
}

async function gmailCurrentHistoryId(token: string, t: HttpTransport): Promise<string> {
  const p = await t.getJson(`${GMAIL}/profile`, token);
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
    const data = await t.getJson(url, token);
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
  return {
    async fetch({ cursor }): Promise<FetchResult> {
      if (!cursor) {
        const ids = await gmailThreadIdsFromSearch(token, transport);
        const threads = await gmailFetchThreads(ids, token, transport);
        return { threads, cursor: await gmailCurrentHistoryId(token, transport) };
      }
      const { ids, historyId } = await gmailChangedThreadIds(token, cursor, transport);
      const threads = await gmailFetchThreads(ids, token, transport);
      return { threads, cursor: historyId || cursor };
    },
  };
}

const GRAPH_SELECT = "$select=subject,from,receivedDateTime,bodyPreview,conversationId";
const GRAPH_DELTA_START = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?${GRAPH_SELECT}`;

async function graphCollect(startUrl: string, token: string, t: HttpTransport): Promise<{ messages: any[]; deltaLink: string }> {
  const messages: any[] = [];
  let next: string | "" = startUrl;
  let deltaLink = "";
  while (next) {
    const data = await t.getJson(next, token);
    for (const m of (data.value as any[]) ?? []) messages.push(m);
    deltaLink = (data["@odata.deltaLink"] as string) ?? deltaLink;
    next = (data["@odata.nextLink"] as string) ?? "";
    if (messages.length >= 1000) break;
  }
  return { messages, deltaLink };
}

export function graphSource(token: string, transport: HttpTransport = fetchTransport): MailSource {
  return {
    async fetch({ cursor }): Promise<FetchResult> {
      const start = cursor || GRAPH_DELTA_START;
      const { messages, deltaLink } = await graphCollect(start, token, transport);
      return { threads: mapGraphMessagesToThreads(messages), cursor: deltaLink || cursor || "" };
    },
  };
}
