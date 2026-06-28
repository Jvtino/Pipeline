import { describe, it, expect } from "vitest";
import type { Thread } from "@pipeline/contracts";
import {
  domainOf,
  header,
  isoFromInternal,
  isoDate,
  clean,
  mapGmailThread,
  mapGraphMessagesToThreads,
} from "./mappers";

// Every provider must emit exactly { threadId, domain, subject, messages:[{date,from,body}] }.
function assertThreadShape(t: Thread) {
  expect(typeof t.threadId).toBe("string");
  expect(t.threadId.length).toBeGreaterThan(0);
  expect(Array.isArray(t.messages) && t.messages.length > 0).toBe(true);
  for (const m of t.messages) {
    expect(m.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(m).sort()).toEqual(["body", "date", "from"]);
  }
}

describe("shared helpers", () => {
  it("domainOf lowercases and falls back to unknown", () => {
    expect(domainOf("Careers <Careers@Stripe.com>")).toBe("stripe.com");
    expect(domainOf("careers@stripe.com")).toBe("stripe.com");
    expect(domainOf("no-at-sign")).toBe("unknown");
    expect(domainOf("")).toBe("unknown");
  });
  it("clean collapses whitespace and truncates to 600", () => {
    expect(clean("  hello   world  ")).toBe("hello world");
    expect(clean("x".repeat(900)).length).toBe(600);
    expect(clean(undefined)).toBe("");
  });
});

describe("Gmail mapper", () => {
  it("header is case-insensitive and safe on missing headers", () => {
    const hs = [
      { name: "From", value: "a@b.com" },
      { name: "subject", value: "Hi" },
    ];
    expect(header(hs, "from")).toBe("a@b.com");
    expect(header(hs, "SUBJECT")).toBe("Hi");
    expect(header(hs, "Date")).toBe("");
    expect(header(undefined, "From")).toBe("");
  });

  it("isoFromInternal prefers internalDate ms, then header, then today", () => {
    expect(isoFromInternal("1717200000000", "anything")).toBe("2024-06-01");
    expect(isoFromInternal(null, "Sat, 01 Jun 2024 00:00:00 GMT")).toBe("2024-06-01");
    expect(isoFromInternal(null, "not-a-date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("mapGmailThread sorts oldest-first and derives meta from the earliest message", () => {
    const t = mapGmailThread({
      id: "thr1",
      messages: [
        {
          internalDate: "1718000000000",
          snippet: "we'd like to schedule a call",
          payload: { headers: [{ name: "From", value: "Recruiting <rec@acme.com>" }, { name: "Subject", value: "Re: Engineer" }] },
        },
        {
          internalDate: "1717200000000",
          snippet: "thank you for applying",
          payload: { headers: [{ name: "From", value: "Careers <careers@acme.com>" }, { name: "Subject", value: "Engineer" }] },
        },
      ],
    });
    assertThreadShape(t);
    expect(t.threadId).toBe("thr1");
    expect(t.domain).toBe("acme.com");
    expect(t.subject).toBe("Engineer");
    expect(t.messages.map((m) => m.date)).toEqual(["2024-06-01", "2024-06-10"]);
  });

  it("handles missing snippet/headers", () => {
    const t = mapGmailThread({ id: "x", messages: [{ internalDate: "1717200000000" }] });
    expect(t.messages[0]!.from).toBe("unknown");
    expect(t.messages[0]!.body).toBe("");
    expect(t.domain).toBe("unknown");
  });
});

describe("Microsoft Graph mapper", () => {
  it("isoDate", () => {
    expect(isoDate("2026-06-15T10:00:00Z")).toBe("2026-06-15");
    expect(isoDate("garbage")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("groups by conversationId, sorts, formats sender, newest-thread first", () => {
    const threads = mapGraphMessagesToThreads([
      {
        conversationId: "c1",
        subject: "Offer",
        receivedDateTime: "2026-06-15T10:00:00Z",
        from: { emailAddress: { name: "Talent", address: "talent@contoso.com" } },
        bodyPreview: "we are pleased to offer you",
      },
      {
        conversationId: "c1",
        subject: "Interview",
        receivedDateTime: "2026-06-10T10:00:00Z",
        from: { emailAddress: { name: "Rec", address: "rec@contoso.com" } },
        bodyPreview: "interview",
      },
      {
        conversationId: "c2",
        subject: "Other",
        receivedDateTime: "2026-06-12T10:00:00Z",
        from: { emailAddress: { address: "jobs@globex.io" } },
        bodyPreview: "thanks for applying",
      },
    ]);
    expect(threads.length).toBe(2);
    threads.forEach(assertThreadShape);
    expect(threads[0]!.threadId).toBe("c1"); // newest activity first
    const c1 = threads[0]!;
    expect(c1.messages.map((m) => m.date)).toEqual(["2026-06-10", "2026-06-15"]);
    expect(c1.messages[0]!.from).toBe("Rec <rec@contoso.com>");
    expect(threads[1]!.messages[0]!.from).toBe("jobs@globex.io");
  });

  it("tolerates empty input and missing from", () => {
    expect(mapGraphMessagesToThreads([])).toEqual([]);
    expect(mapGraphMessagesToThreads(null)).toEqual([]);
    const t = mapGraphMessagesToThreads([{ conversationId: "z", receivedDateTime: "2026-01-01T00:00:00Z" }]);
    expect(t[0]!.domain).toBe("unknown");
    expect(t[0]!.subject).toBe("(no subject)");
  });
});
