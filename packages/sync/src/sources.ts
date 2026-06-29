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

const GMAIL_Q =
  'in:anywhere newer_than:1y (subject:(application OR applying OR interview OR ' +
  'candidacy OR recruiting OR position OR offer) OR "thank you for applying" ' +
  'OR "your application" OR "received your application")';

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

// Outlook fetch — a faithful port of the desktop msgraph.js. A keyword $search
// (relevance-ranked, server-side) over /me/messages + the junk folder, NOT a raw
// inbox delta: the delta pulled the whole mailbox and a regex gate over-matched
// every "position/offer/application" substring, tripling the count vs the desktop.
// Re-searching each sync (no incremental cursor) matches the desktop exactly.
const GRAPH_SEARCH_KQL = "application OR applying OR interview OR candidacy OR candidate OR recruiting OR position OR offer";
const GRAPH_SELECT = "$select=subject,from,receivedDateTime,bodyPreview,conversationId";
const GRAPH_MAX = 1000;

async function graphSearchMessages(token: string, t: HttpTransport): Promise<any[]> {
  const search = encodeURIComponent(`"${GRAPH_SEARCH_KQL}"`);
  const mkUrl = (top: number) =>
    `https://graph.microsoft.com/v1.0/me/messages?$search=${search}&${GRAPH_SELECT}&$top=${top}`;
  const all: any[] = [];
  const seen = new Set<string>();
  let url: string | null = mkUrl(100);
  let firstPage = true;
  while (url && all.length < GRAPH_MAX) {
    let data: Record<string, unknown>;
    try {
      data = await t.getJson(url, token);
    } catch (e) {
      if (firstPage) { firstPage = false; url = mkUrl(25); continue; } // some tenants cap $top on $search
      throw e;
    }
    firstPage = false;
    for (const m of (data.value as any[]) ?? []) {
      if (m.id && seen.has(m.id)) continue;
      if (m.id) seen.add(m.id);
      all.push(m);
    }
    url = (data["@odata.nextLink"] as string) ?? null;
  }
  // Personal mailboxes often hide application mail in Junk; search it too.
  try {
    const junkUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/junkemail/messages?$search=${search}&${GRAPH_SELECT}&$top=50`;
    const junk = await t.getJson(junkUrl, token);
    for (const m of (junk.value as any[]) ?? []) {
      if (m.id && seen.has(m.id)) continue;
      if (m.id) seen.add(m.id);
      all.push(m);
    }
  } catch {
    /* non-fatal — junk folder unavailable */
  }
  return all;
}

export function graphSource(token: string, transport: HttpTransport = fetchTransport): MailSource {
  return {
    async fetch(): Promise<FetchResult> {
      const messages = await graphSearchMessages(token, transport);
      return { threads: mapGraphMessagesToThreads(messages), cursor: "search" };
    },
  };
}
