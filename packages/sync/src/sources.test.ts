import { describe, it, expect } from "vitest";
import type { HttpTransport } from "@pipeline/providers";
import { gmailSource, graphSource } from "./sources";

// A fake transport that records every requested URL and replies from a routing fn,
// so we can assert HOW graphSource queries Microsoft Graph without any network.
class FakeTransport implements HttpTransport {
  readonly urls: string[] = [];
  constructor(private readonly route: (url: string) => Record<string, unknown>) {}
  async postForm(): Promise<Record<string, unknown>> {
    return {};
  }
  async getJson(url: string): Promise<Record<string, unknown>> {
    this.urls.push(url);
    return this.route(url);
  }
}

const msg = (id: string, conv: string, subject: string, addr: string) => ({
  id,
  conversationId: conv,
  subject,
  from: { emailAddress: { name: subject, address: addr } },
  receivedDateTime: "2026-06-01T00:00:00Z",
  bodyPreview: subject,
});

describe("graphSource — Outlook fetch mirrors the desktop $search", () => {
  it("uses a keyword $search (not the whole-inbox delta), paginates, adds Junk, and dedupes", async () => {
    const transport = new FakeTransport((url) => {
      if (url.includes("junkemail")) return { value: [msg("4", "c4", "Offer letter", "x@acme.com")] };
      if (url.includes("SKIP2"))
        return { value: [msg("2", "c2", "dup thread", "x@hooli.com"), msg("3", "c3", "Your application", "x@lever.co")] };
      return {
        value: [msg("1", "c1", "Application received", "x@greenhouse.io"), msg("2", "c2", "Interview invite", "x@hooli.com")],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$search=x&$top=100&$skiptoken=SKIP2",
      };
    });

    const { threads, cursor } = await graphSource("tok", transport).fetch({});

    // It searches for job keywords rather than pulling the inbox delta.
    expect(transport.urls[0]).toContain("$search=");
    expect(transport.urls[0]).not.toContain("delta");
    expect(decodeURIComponent(transport.urls[0]!)).toContain("application OR applying OR interview");
    // It also searches the Junk folder (consumer accounts hide job mail there).
    expect(transport.urls.some((u) => u.includes("mailFolders/junkemail/messages"))).toBe(true);
    // Four unique message ids (the duplicate id "2" on page 2 is dropped) → four threads.
    expect(threads.length).toBe(4);
    expect(typeof cursor).toBe("string");
  });

  it("includes ATS from: terms so keyword-less ATS mail is fetched (parity with Gmail)", async () => {
    const transport = new FakeTransport((url) => (url.includes("junkemail") ? { value: [] } : { value: [] }));
    await graphSource("tok", transport).fetch({});
    const kql = decodeURIComponent(transport.urls[0]!);
    expect(kql).toContain("from:greenhouse.io");
    expect(kql).toContain("from:recruitee.com"); // one of the previously-missing platforms
  });

  it("date-bounds the search: 1y on backfill, from the saved cursor (minus overlap) after", async () => {
    const transport = new FakeTransport((url) => (url.includes("junkemail") ? { value: [] } : { value: [] }));
    const source = graphSource("tok", transport);

    await source.fetch({}); // backfill → some received>= bound exists
    expect(decodeURIComponent(transport.urls[0]!)).toMatch(/received>=\d{4}-\d{2}-\d{2}/);

    transport.urls.length = 0;
    await source.fetch({ cursor: "2026-06-15T12:00:00.000Z" }); // 7-day overlap behind the cursor
    expect(decodeURIComponent(transport.urls[0]!)).toContain("received>=2026-06-08");
  });

  it("retries once with a smaller page when the tenant rejects a large $top on $search", async () => {
    let firstCall = true;
    const transport = new FakeTransport((url) => {
      if (url.includes("junkemail")) return { value: [] };
      if (firstCall && url.includes("$top=100")) {
        firstCall = false;
        return { error: { message: "$top too large for $search" } };
      }
      return { value: [msg("1", "c1", "Your application to Acme", "x@greenhouse.io")] };
    });

    const { threads } = await graphSource("tok", transport).fetch({});

    expect(transport.urls.some((u) => u.includes("$top=100"))).toBe(true); // tried the big page
    expect(transport.urls.some((u) => u.includes("$top=25"))).toBe(true); // retried smaller
    expect(threads.length).toBe(1); // and still returned the results
  });
});

// Minimal Gmail API shapes for the fake transport.
const gmailThreadJson = (id: string) => ({
  id,
  messages: [
    {
      internalDate: "1748736000000", // 2025-06-01
      snippet: "thank you for applying",
      payload: { headers: [{ name: "From", value: "Acme via Greenhouse <x@greenhouse.io>" }, { name: "Subject", value: "Your application" }] },
    },
  ],
});

describe("gmailSource — error propagation and lossless deltas", () => {
  it("throws (instead of saving a cursor over nothing) when the backfill search errors", async () => {
    const transport = new FakeTransport((url) => {
      if (url.includes("/messages?q=")) return { error: { message: "rate limited", code: 429 } };
      return { historyId: "h1" };
    });
    await expect(gmailSource("tok", transport).fetch({})).rejects.toThrow(/gmail search failed/);
  });

  it("fetches EVERY changed thread on a delta — no 200-thread cap while the cursor advances", async () => {
    const changed = Array.from({ length: 250 }, (_, i) => ({ message: { threadId: `t${i}` } }));
    const transport = new FakeTransport((url) => {
      if (url.includes("/history?")) return { history: [{ messagesAdded: changed }], historyId: "h2" };
      const m = /\/threads\/([^?]+)/.exec(url);
      if (m) return gmailThreadJson(m[1]!);
      return {};
    });
    const { threads, cursor } = await gmailSource("tok", transport).fetch({ cursor: "h1" });
    expect(threads.length).toBe(250); // all 250, not the first 200
    expect(cursor).toBe("h2");
  });

  it("falls back to a fresh backfill when the saved history id has expired (404)", async () => {
    const transport = new FakeTransport((url) => {
      if (url.includes("/history?")) return { error: { message: "startHistoryId not found", code: 404 } };
      if (url.includes("/messages?q=")) return { messages: [{ threadId: "t1" }] };
      if (url.includes("/threads/")) return gmailThreadJson("t1");
      if (url.includes("/profile")) return { historyId: "h9" };
      return {};
    });
    const { threads, cursor } = await gmailSource("tok", transport).fetch({ cursor: "dead" });
    expect(transport.urls.some((u) => u.includes("/messages?q="))).toBe(true); // re-searched
    expect(threads.length).toBe(1);
    expect(cursor).toBe("h9"); // fresh cursor from the profile, not the dead one
  });
});
