// Headless unit tests for the pure provider-mapping functions.
// Zero dependencies: Node's built-in test runner + assert. The provider modules
// only need `https`/`crypto` (built in); imap.js wraps its imapflow/mailparser
// require in try/catch, so these run with no `npm install`.
//
//   node --test        (or: npm test)
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const gmail = require("../gmail");
const msgraph = require("../msgraph");
const imap = require("../imap");

// Every provider must emit this exact shape so the UI can consume it uniformly.
function assertThreadShape(t) {
  assert.ok(typeof t.threadId === "string" && t.threadId.length, "threadId");
  assert.ok(typeof t.domain === "string", "domain");
  assert.ok(typeof t.subject === "string", "subject");
  assert.ok(Array.isArray(t.messages) && t.messages.length, "messages[]");
  for (const m of t.messages) {
    assert.match(m.date, /^\d{4}-\d{2}-\d{2}$/, "message.date is ISO yyyy-mm-dd");
    assert.equal(typeof m.from, "string");
    assert.equal(typeof m.body, "string");
    // the unified message shape is exactly {date, from, body}
    assert.deepEqual(Object.keys(m).sort(), ["body", "date", "from"]);
  }
}

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------
test("gmail.domainOf extracts lowercased domain, falls back to 'unknown'", () => {
  assert.equal(gmail.domainOf("Careers <Careers@Stripe.com>"), "stripe.com");
  assert.equal(gmail.domainOf("careers@stripe.com"), "stripe.com");
  assert.equal(gmail.domainOf("no-at-sign"), "unknown");
  assert.equal(gmail.domainOf(""), "unknown");
});

test("gmail.header is case-insensitive and safe on missing headers", () => {
  const hs = [{ name: "From", value: "a@b.com" }, { name: "subject", value: "Hi" }];
  assert.equal(gmail.header(hs, "from"), "a@b.com");
  assert.equal(gmail.header(hs, "SUBJECT"), "Hi");
  assert.equal(gmail.header(hs, "Date"), "");
  assert.equal(gmail.header(undefined, "From"), "");
});

test("gmail.isoFromInternal prefers internalDate ms, falls back to header, then today", () => {
  assert.equal(gmail.isoFromInternal("1717200000000", "anything"), "2024-06-01");
  assert.equal(gmail.isoFromInternal(null, "Sat, 01 Jun 2024 00:00:00 GMT"), "2024-06-01");
  assert.match(gmail.isoFromInternal(null, "not-a-date"), /^\d{4}-\d{2}-\d{2}$/);
});

test("gmail.mapGmailThread sorts messages oldest-first and derives meta from earliest", () => {
  const t = gmail.mapGmailThread({
    id: "thr1",
    messages: [
      { internalDate: "1718000000000", snippet: "we'd like to schedule a call",
        payload: { headers: [{ name: "From", value: "Recruiting <rec@acme.com>" }, { name: "Subject", value: "Re: Engineer" }] } },
      { internalDate: "1717200000000", snippet: "thank you for applying",
        payload: { headers: [{ name: "From", value: "Careers <careers@acme.com>" }, { name: "Subject", value: "Engineer" }] } },
    ],
  });
  assertThreadShape(t);
  assert.equal(t.threadId, "thr1");
  assert.equal(t.domain, "acme.com");
  assert.equal(t.subject, "Engineer");                 // earliest message's subject
  assert.deepEqual(t.messages.map((m) => m.date), ["2024-06-01", "2024-06-10"]);
});

test("gmail.mapGmailThread handles missing snippet/headers without throwing", () => {
  const t = gmail.mapGmailThread({ id: "x", messages: [{ internalDate: "1717200000000" }] });
  assert.equal(t.messages[0].from, "unknown");
  assert.equal(t.messages[0].body, "");
  assert.equal(t.domain, "unknown");
});

// ---------------------------------------------------------------------------
// Microsoft Graph
// ---------------------------------------------------------------------------
test("msgraph.domainOf / isoDate", () => {
  assert.equal(msgraph.domainOf("Rec <rec@Contoso.com>"), "contoso.com");
  assert.equal(msgraph.isoDate("2026-06-15T10:00:00Z"), "2026-06-15");
  assert.match(msgraph.isoDate("garbage"), /^\d{4}-\d{2}-\d{2}$/);
});

test("msgraph.mapMessagesToThreads groups by conversationId, sorts, formats sender", () => {
  const threads = msgraph.mapMessagesToThreads([
    { conversationId: "c1", subject: "Offer", receivedDateTime: "2026-06-15T10:00:00Z",
      from: { emailAddress: { name: "Talent", address: "talent@contoso.com" } }, bodyPreview: "we are pleased to offer you" },
    { conversationId: "c1", subject: "Interview", receivedDateTime: "2026-06-10T10:00:00Z",
      from: { emailAddress: { name: "Rec", address: "rec@contoso.com" } }, bodyPreview: "interview" },
    { conversationId: "c2", subject: "Other", receivedDateTime: "2026-06-12T10:00:00Z",
      from: { emailAddress: { address: "jobs@globex.io" } }, bodyPreview: "thanks for applying" },
  ]);
  assert.equal(threads.length, 2);
  threads.forEach(assertThreadShape);
  // newest-activity thread first
  assert.equal(threads[0].threadId, "c1");
  const c1 = threads[0];
  assert.deepEqual(c1.messages.map((m) => m.date), ["2026-06-10", "2026-06-15"]);
  assert.equal(c1.messages[0].from, "Rec <rec@contoso.com>");        // name <addr>
  assert.equal(threads[1].messages[0].from, "jobs@globex.io");        // addr only when no name
});

test("msgraph.mapMessagesToThreads tolerates empty input and missing from", () => {
  assert.deepEqual(msgraph.mapMessagesToThreads([]), []);
  assert.deepEqual(msgraph.mapMessagesToThreads(null), []);
  const t = msgraph.mapMessagesToThreads([{ conversationId: "z", receivedDateTime: "2026-01-01T00:00:00Z" }]);
  assert.equal(t[0].domain, "unknown");
  assert.equal(t[0].subject, "(no subject)");
});

// ---------------------------------------------------------------------------
// Generic IMAP (mailparser shape)
// ---------------------------------------------------------------------------
test("imap.hostFor resolves presets and returns '' for unknown", () => {
  assert.equal(imap.hostFor("me@gmail.com"), "imap.gmail.com");
  assert.equal(imap.hostFor("me@outlook.com"), "outlook.office365.com");
  assert.equal(imap.hostFor("me@FASTMAIL.com"), "imap.fastmail.com");
  assert.equal(imap.hostFor("me@unknown.example"), "");
  assert.equal(imap.hostFor("not-an-email"), "");
});

test("imap.normSubject strips Re/Fwd prefixes and [external], lowercases", () => {
  assert.equal(imap.normSubject("Re: Fwd: Hello"), "hello");
  assert.equal(imap.normSubject("[EXTERNAL] FW: Your Application"), "your application");
  assert.equal(imap.normSubject("  Multiple   Spaces "), "multiple spaces");
});

test("imap.bodyText prefers text, strips html, collapses ws, truncates to 600", () => {
  assert.equal(imap.bodyText({ text: "  hello   world  " }), "hello world");
  assert.equal(imap.bodyText({ html: "<p>hi <b>there</b></p>" }), "hi there");
  assert.equal(imap.bodyText({ text: "x".repeat(900) }).length, 600);
  assert.equal(imap.bodyText({}), "");
});

test("imap.mapParsedToThreads groups by domain+subject, sorts, dedups threads", () => {
  const threads = imap.mapParsedToThreads([
    { from: { value: [{ address: "careers@acme.com" }], text: "Acme <careers@acme.com>" },
      subject: "Your application for Engineer", date: "2026-06-01", text: "thanks for applying" },
    { from: { value: [{ address: "careers@acme.com" }], text: "Acme <careers@acme.com>" },
      subject: "RE: Your application for Engineer", date: "2026-06-10", text: "schedule a call" },
    { from: { value: [{ address: "jobs@globex.io" }], text: "jobs@globex.io" },
      subject: "Interview", date: "2026-06-12", html: "<p>phone screen</p>" },
  ]);
  // the two Acme messages collapse into one thread (Re: normalized away)
  assert.equal(threads.length, 2);
  threads.forEach(assertThreadShape);
  assert.equal(threads[0].domain, "globex.io");   // newest activity first
  const acme = threads.find((t) => t.domain === "acme.com");
  assert.equal(acme.messages.length, 2);
  assert.deepEqual(acme.messages.map((m) => m.date), ["2026-06-01", "2026-06-10"]);
  assert.ok(acme.threadId.startsWith("imap-"));
});

test("imap.mapParsedToThreads handles missing sender/subject/date", () => {
  const t = imap.mapParsedToThreads([{ subject: undefined, text: "hi" }]);
  assert.equal(t.length, 1);
  assert.equal(t[0].domain, "unknown");
  assert.equal(t[0].subject, "(no subject)");
  assert.match(t[0].messages[0].date, /^\d{4}-\d{2}-\d{2}$/);
});

// Shared-ATS mail must never thread on domain+subject alone (two employers,
// one platform, identical boilerplate subject = distinct applications), and
// each ATS thread must carry the id it had BEFORE that fix so the app can
// re-key manual status overrides (MIGRATION_PLAN.md).
test("imap.mapParsedToThreads separates ATS tenants and exposes legacyThreadId", () => {
  const mail = (addr, body) => ({
    from: { value: [{ address: addr }], text: `Workday <${addr}>` },
    subject: "Application Update", date: "2026-06-01", body, text: body,
  });
  const threads = imap.mapParsedToThreads([
    mail("initech@myworkday.com", "Initech has an update on your application."),
    mail("hooli@myworkday.com", "Hooli has an update on your application."),
  ]);
  assert.equal(threads.length, 2); // NOT bundled into one "Myworkday" thread
  threads.forEach(assertThreadShape);
  // Both descend from the same pre-fix id — exactly the ambiguity the
  // renderer's override repair refuses to guess about.
  assert.equal(typeof threads[0].legacyThreadId, "string");
  assert.equal(threads[0].legacyThreadId, threads[1].legacyThreadId);
  assert.notEqual(threads[0].threadId, threads[1].threadId);
  assert.ok(threads.every((t) => t.threadId !== t.legacyThreadId));
});

test("imap.mapParsedToThreads: legacyThreadId equals the historical derivation", () => {
  const threads = imap.mapParsedToThreads([
    { from: { value: [{ address: "careers@acme.com" }], text: "Acme <careers@acme.com>" },
      subject: "Your application for Engineer", date: "2026-06-01", text: "thanks for applying" },
  ]);
  assert.equal(threads.length, 1);
  // the exact id the pre-fix scheme produced for this thread's domain|subject key
  const legacy = "imap-" + Buffer.from("acme.com|your application for engineer")
    .toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  assert.equal(threads[0].legacyThreadId, legacy);
  assert.notEqual(threads[0].threadId, legacy);
});

// Regression: the old ids truncated to ~the first 12 bytes of domain|subject,
// so any two same-domain threads collided (one id, overrides bleeding across
// unrelated applications). The hashed ids must be distinct.
test("imap.mapParsedToThreads: same-domain different-subject threads get distinct ids", () => {
  const threads = imap.mapParsedToThreads([
    { from: { value: [{ address: "careers@acme.com" }], text: "Acme <careers@acme.com>" },
      subject: "Your application for Engineer", date: "2026-06-01", text: "thanks" },
    { from: { value: [{ address: "careers@acme.com" }], text: "Acme <careers@acme.com>" },
      subject: "Your interview details", date: "2026-06-02", text: "details inside" },
  ]);
  assert.equal(threads.length, 2);
  assert.notEqual(threads[0].threadId, threads[1].threadId);
  // ...whereas the OLD derivation collided on these two (why the fix exists):
  assert.equal(threads[0].legacyThreadId, threads[1].legacyThreadId);
});
