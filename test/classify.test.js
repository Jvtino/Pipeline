// Tests for the "brain" — status classification + real-employer resolution
// across shared hiring platforms (Workday, Greenhouse, Lever, LinkedIn, Indeed).
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../classify");

// ---------------------------------------------------------------------------
// Status classifier
// ---------------------------------------------------------------------------
const STATUS_CASES = [
  // applied / received
  ["Thank you for applying to the Backend Engineer role. We've received your application.", "applied"],
  ["Your application has been received and is currently under review.", "applied"],
  ["We appreciate your interest and will review your application shortly.", "applied"],
  // interview
  ["We'd like to schedule a phone screen — please share your availability.", "interview"],
  ["Good news! We'd love to invite you for a first interview next week.", "interview"],
  ["The next step is a technical assessment / coding challenge. Here's the link.", "interview"],
  ["Our hiring manager would like to set up a call. Are you available Thursday?", "interview"],
  ["We're moving you forward to the next round — please book a time via Calendly.", "interview"],
  // offer
  ["We are pleased to offer you the position of Data Scientist at Acme.", "offer"],
  ["Congratulations! We'd like to extend an offer of employment. Your start date is Monday.", "offer"],
  ["Please find your offer letter attached. Welcome to the team!", "offer"],
  // rejected
  ["Unfortunately, after careful consideration we've decided to move forward with other candidates.", "rejected"],
  ["We regret to inform you that you have not been selected for this role.", "rejected"],
  ["The position has been filled. We wish you the best in your search.", "rejected"],
  ["We won't be progressing your application further at this time.", "rejected"],
  ["Thank you for applying. Unfortunately the role has been filled.", "rejected"], // mixed → rejected
  ["After your interview, we have decided to go in a different direction.", "rejected"], // mixed → rejected
  ["We are unable to offer you the position at this time.", "rejected"],              // negated offer
  // none
  ["Here's our company newsletter for June.", null],
  ["Your package has shipped and will arrive tomorrow.", null],
];

for (const [text, expected] of STATUS_CASES) {
  test(`detectStatus → ${expected} :: ${text.slice(0, 48)}…`, () => {
    assert.equal(C.detectStatus(text), expected);
  });
}

// ---------------------------------------------------------------------------
// Real-employer resolution across shared platforms
// ---------------------------------------------------------------------------
function thread(domain, from, subject, body) {
  return { domain, subject, messages: [{ date: "2026-06-01", from, body: body || "" }] };
}

test("normal domain → company from domain", () => {
  assert.equal(C.resolveCompany(thread("careers.stripe.com", "Stripe <jobs@stripe.com>",
    "Your application for Engineer at Stripe")).company, "Stripe");
});

test("Greenhouse → employer from sender display name", () => {
  const r = C.resolveCompany(thread("greenhouse.io", "Acme Robotics via Greenhouse <no-reply@greenhouse.io>",
    "Thank you for applying", "Thanks for applying."));
  assert.equal(r.company, "Acme Robotics");
});

test("Lever → employer from 'Careers' sender name", () => {
  const r = C.resolveCompany(thread("hire.lever.co", "Globex Careers <postings@hire.lever.co>",
    "Application confirmation"));
  assert.equal(r.company, "Globex");
});

test("Workday → employer from subject 'interest in'", () => {
  const r = C.resolveCompany(thread("myworkday.com", "Workday Recruiting <noreply@myworkday.com>",
    "Thank you for your interest in Initech"));
  assert.equal(r.company, "Initech");
});

test("LinkedIn → employer from 'your application was sent to'", () => {
  const r = C.resolveCompany(thread("linkedin.com", "LinkedIn <jobs-noreply@linkedin.com>",
    "Your application was sent to Umbrella Corp"));
  assert.equal(r.company, "Umbrella Corp");
});

test("Indeed → employer from body when subject lacks it", () => {
  const r = C.resolveCompany(thread("indeed.com", "Indeed Apply <donotreply@indeed.com>",
    "Indeed Application: Software Engineer",
    "You applied to Hooli has been submitted via Indeed."));
  assert.equal(r.company, "Hooli");
});

test("two employers on the SAME platform resolve to DIFFERENT companies", () => {
  const a = C.resolveCompany(thread("greenhouse.io", "Acme via Greenhouse <x@greenhouse.io>", "Update"));
  const b = C.resolveCompany(thread("greenhouse.io", "Globex via Greenhouse <y@greenhouse.io>", "Update"));
  assert.notEqual(a.company, b.company);
  assert.equal(a.company, "Acme");
  assert.equal(b.company, "Globex");
});

test("same employer via different formats normalizes to one name (groups together)", () => {
  const a = C.resolveCompany(thread("greenhouse.io", "Acme, Inc. via Greenhouse <x@greenhouse.io>", "Update"));
  const b = C.resolveCompany(thread("greenhouse.io", "Acme Talent Acquisition <y@greenhouse.io>", "Update"));
  assert.equal(a.company, b.company);   // both → "Acme"
  assert.equal(a.company, "Acme");
});

test("unidentifiable ATS mail falls back to platform name (does not crash)", () => {
  const r = C.resolveCompany(thread("greenhouse.io", "no-reply <no-reply@greenhouse.io>", "Update on your application"));
  assert.equal(typeof r.company, "string");
  assert.ok(r.company.length > 0);
});

test("platform brand words are never returned as the company", () => {
  assert.equal(C.companyFromSenderName("Greenhouse <no-reply@greenhouse.io>"), null);
  assert.equal(C.companyFromSenderName("LinkedIn Job Alerts <x@linkedin.com>"), null);
  assert.equal(C.companyFromSenderName("Indeed Apply <x@indeed.com>"), null);
});

// ---------------------------------------------------------------------------
// ccTLD / role extraction (regression guards)
// ---------------------------------------------------------------------------
test("ccTLD company naming", () => {
  assert.equal(C.companyFromDomain("careers.acme.co.uk"), "Acme");
  assert.equal(C.companyFromDomain("jobs.acme.com.au"), "Acme");
  assert.equal(C.companyFromDomain("mail.notion.so"), "Notion");
});

test("role extraction", () => {
  assert.equal(C.extractRole("Your application for Senior Software Engineer at Acme Corp"), "Senior Software Engineer");
  assert.equal(C.extractRole("Application — Data Analyst at Globex"), "Data Analyst");
  assert.equal(C.extractRole("Indeed Application: Data Analyst"), "Data Analyst");
  assert.equal(C.extractRole("Your application was sent to Initech"), "Application");  // no role in subject
  assert.equal(C.extractRole("Thank you for your interest in Initech"), "Application");
  assert.equal(C.extractRole("Software Engineer"), "Software Engineer");  // bare role preserved
});
