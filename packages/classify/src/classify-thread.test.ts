import { describe, it, expect } from "vitest";
import type { Thread } from "@pipeline/contracts";
import { classifyThread, statusForThread, threadToApplication } from "./aggregate";

const th = (subject: string, domain: string, msgs: { from?: string; body: string }[]): Thread => ({
  threadId: "t",
  domain,
  subject,
  messages: msgs.map((m, i) => ({ date: `2026-05-0${i + 1}`, from: m.from ?? `x@${domain}`, body: m.body })),
});

const CASES: Record<string, Thread> = {
  cleanOffer: th("Your application for Senior Software Engineer at Acme", "acme.com", [
    { from: "recruiting@acme.com", body: "We are pleased to offer you the position. Your start date is Monday." },
  ]),
  atsUnknown: th("Update on your application", "greenhouse.io", [
    { from: "no-reply <no-reply@greenhouse.io>", body: "We have an update on your application." },
  ]),
  genericRole: th("Thank you for your interest in Stripe", "stripe.com", [
    { from: "jobs@stripe.com", body: "We received your application." },
  ]),
  coldSourcing: th("Staff Engineer opportunity at Acme", "acme.com", [
    { from: "Jane <jane@acme.com>", body: "Hi! I'm a technical recruiter at Acme. I came across your profile and would love to set up a call about a Staff Engineer role." },
  ]),
  genuineInterview: th("Interview for Backend Engineer at Hooli", "greenhouse.io", [
    { from: "no-reply@greenhouse.io", body: "Thank you for applying. We'd like to schedule a technical interview. Please share your availability." },
  ]),
  mixed: th("Update", "acme.com", [
    { from: "team@acme.com", body: "We really enjoyed your interview, but unfortunately we're moving forward with other candidates." },
  ]),
  enriched: th("Interview scheduled — Data Scientist at Acme", "greenhouse.io", [
    { from: "Acme via Greenhouse <no-reply@greenhouse.io>", body: "Thank you for applying to Acme." },
    { from: "Jordan Lee <jordan.lee@acme.com>", body: "Your interview is confirmed for Tuesday, June 12 at 3:00pm PT. Join: https://calendly.com/acme/loop. This role is Remote (US) with a base salary range of $150,000–$180,000.\nBest,\nJordan Lee\nSenior Technical Recruiter\njordan.lee@acme.com" },
  ]),
};

describe("@pipeline/classify — classifyThread", () => {
  it("status always matches the persisted statusForThread label", () => {
    for (const t of Object.values(CASES)) {
      expect(classifyThread(t).status).toBe(statusForThread(t));
    }
  });

  it("a clean offer from a real employer is high-confidence", () => {
    const c = classifyThread(CASES.cleanOffer!);
    expect(c.status).toBe("offer");
    expect(c.confidence).toBeGreaterThanOrEqual(0.5);
    expect(c.company.isPlatformFallback).toBe(false);
    expect(c.reasons).not.toContain("company_platform_fallback");
  });

  it("an ATS with no recoverable employer is flagged, not shown as the platform confidently", () => {
    const c = classifyThread(CASES.atsUnknown!);
    expect(c.company.isPlatformFallback).toBe(true);
    expect(c.confidence).toBeLessThan(0.5);
    expect(c.reasons).toContain("company_platform_fallback");
  });

  it("a generic role fallback lowers confidence", () => {
    const c = classifyThread(CASES.genericRole!);
    expect(c.role.isGenericFallback).toBe(true);
    expect(c.confidence).toBeLessThan(0.5);
    expect(c.reasons).toContain("role_generic_fallback");
  });

  it("cold recruiter sourcing is NOT a confident interview", () => {
    const c = classifyThread(CASES.coldSourcing!);
    expect(c.status).toBe("applied");
    expect(c.confidence).toBeLessThan(0.5);
    expect(c.eventType).toBe("UNKNOWN");
    expect(c.requiresManualReview).toBe(true);
  });

  it("a genuine post-application interview is NOT mistaken for sourcing", () => {
    const c = classifyThread(CASES.genuineInterview!);
    expect(c.status).toBe("interview");
    expect(c.reasons).not.toContain("recruiter_sourcing_no_application");
  });

  it("an explicit rejection overrides historical interview wording", () => {
    const c = classifyThread(CASES.mixed!);
    expect(c.status).toBe("rejected");
    expect(c.confidence).toBeGreaterThanOrEqual(0.75);
    expect(c.eventType).toBe("REJECTION_RECEIVED");
    expect(c.requiresManualReview).toBe(false);
  });

  it("threadToApplication carries the classifier confidence (live path)", () => {
    for (const t of Object.values(CASES)) {
      const app = threadToApplication(t);
      expect(typeof app.confidence).toBe("number");
      expect(app.confidence).toBe(classifyThread(t).confidence);
    }
  });

  it("surfaces enrichment fields when clearly present", () => {
    const c = classifyThread(CASES.enriched!);
    expect(c.interview?.bookingLink).toBe("https://calendly.com/acme/loop");
    expect(c.interview?.dateTimeText).toContain("June 12");
    expect(c.compensation?.text).toBe("$150,000–$180,000");
    expect(c.location?.kind).toBe("remote");
    expect(c.recruiterContact?.name).toBe("Jordan Lee");
    expect(c.recruiterContact?.email).toBe("jordan.lee@acme.com");
  });

  it("persists BOTH the interview text as written and its normalized ISO twin", () => {
    // the raw prose stays the display truth; the ISO twin (resolved against
    // the email's date, PT → PDT in June) is what reminders compute with
    const app = threadToApplication(CASES.enriched!);
    expect(app.enrichment?.interviewDateTime).toBe("Tuesday, June 12 at 3:00pm PT");
    expect(app.enrichment?.interviewDateTimeIso).toBe("2026-06-12T15:00:00-07:00");
  });

  it("anchors the ISO twin to the message that NAMED the interview, not later replies", () => {
    // 2026-06-01 is a Monday → "Thursday" means June 4. A contentless reply
    // eleven days later must NOT re-derive it to the following week's Thursday
    // (that phantom future date would fire reminders for a past interview).
    const thread: Thread = {
      threadId: "t-anchor",
      domain: "acme.com",
      subject: "Interview — Platform Engineer at Acme",
      messages: [
        { date: "2026-06-01", from: "recruiting@acme.com", body: "Your interview is confirmed for Thursday at 3:00pm ET." },
        { date: "2026-06-12", from: "recruiting@acme.com", body: "Looking forward to speaking soon!" },
      ],
    };
    expect(threadToApplication(thread).enrichment?.interviewDateTimeIso).toBe("2026-06-04T15:00:00-04:00");
  });
});
