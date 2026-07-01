import { describe, it, expect } from "vitest";
import type { HttpTransport } from "@pipeline/providers";
import { graphSource } from "./sources";

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
