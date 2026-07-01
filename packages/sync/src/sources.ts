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

// Microsoft Graph's inbox delta hands back the WHOLE mailbox, which floods the
// board with non-application mail. The desktop app (msgraph.js) never does that —
// it uses a Graph $search KEYWORD query, so only job-related mail is ever fetched.
// We mirror the desktop exactly so hosted Outlook results match it: the same
// keyword $search across the mailbox plus the Junk folder, paged to a safety cap.
//
// A $search has no delta token, so this re-searches each sync rather than fetching
// a delta — cheap for one mailbox, and the shared relevance gate still runs over
// the results in the engine. (Matching the desktop's proven behaviour is the point;
// an incremental $search can come later if sync volume ever demands it.)
const GRAPH_SEARCH_KQL =
  "application OR applying OR interview OR candidacy OR candidate OR recruiting OR position OR offer";
const GRAPH_SELECT = "subject,from,receivedDateTime,bodyPreview,conversationId";
const GRAPH_MAX_MESSAGES = 1000;

function graphSearchUrl(top: number, folderPrefix: string): string {
  const search = encodeURIComponent(`"${GRAPH_SEARCH_KQL}"`);
  return `https://graph.microsoft.com/v1.0/me/${folderPrefix}messages?$search=${search}&$select=${GRAPH_SELECT}&$top=${top}`;
}

async function graphSearchMessages(token: string, t: HttpTransport): Promise<any[]> {
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
  let url = graphSearchUrl(100, "");
  let smalledTop = false;
  while (url && all.length < GRAPH_MAX_MESSAGES) {
    const data = await t.getJson(url, token);
    // Some tenants reject a large $top on $search — retry the page once smaller.
    // (fetchTransport doesn't throw on HTTP errors; it returns the error envelope.)
    if (data.error) {
      if (!smalledTop) { smalledTop = true; url = graphSearchUrl(25, ""); continue; }
      break; // return what we have rather than fail the whole sync
    }
    add(data);
    url = (data["@odata.nextLink"] as string) ?? "";
  }
  // Junk folder — consumer (Outlook.com / live / hotmail) accounts often miss it
  // in the main search. Well-known folder id "junkemail" works for personal mailboxes.
  try {
    const junk = await t.getJson(graphSearchUrl(50, "mailFolders/junkemail/"), token);
    if (!junk.error) add(junk);
  } catch {
    /* non-fatal — junk folder unavailable */
  }
  return all;
}

export function graphSource(token: string, transport: HttpTransport = fetchTransport): MailSource {
  return {
    async fetch(): Promise<FetchResult> {
      const messages = await graphSearchMessages(token, transport);
      // No delta token for a $search; the cursor is just a last-synced marker and
      // is ignored on the next round (each sync re-searches, like the desktop).
      return { threads: mapGraphMessagesToThreads(messages), cursor: new Date().toISOString() };
    },
  };
}
