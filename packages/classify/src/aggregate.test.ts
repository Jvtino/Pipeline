import { describe, it, expect } from "vitest";
import { boardFromApplications } from "@pipeline/contracts";
import type { Thread } from "@pipeline/contracts";
import { resolveCompanySmart, statusForThread, threadsToApplications } from "./aggregate";

const thread = (over: Partial<Thread> & { subject: string }): Thread => ({
  threadId: over.threadId ?? over.subject,
  domain: over.domain ?? "example.com",
  subject: over.subject,
  messages: over.messages ?? [{ date: "2026-05-01", from: "noreply@myworkday.com", body: "" }],
});

describe("resolveCompanySmart — recover the employer behind a shared ATS", () => {
  it("reads the company from a Workday subject when the base resolver can't", () => {
    const t = thread({ domain: "myworkday.com", subject: "Acme — Application Received", messages: [{ date: "2026-05-01", from: "Workday <noreply@myworkday.com>", body: "Your application has been received." }] });
    expect(resolveCompanySmart(t).company).toBe("Acme");
  });

  it("reads the company from an apply URL (Workday tenant / Greenhouse / Lever)", () => {
    const wd = thread({ domain: "myworkday.com", subject: "Application Received", messages: [{ date: "2026-05-01", from: "Workday <noreply@myworkday.com>", body: "Track it at https://acme.wd5.myworkdayjobs.com/en-US/acme_careers" }] });
    expect(resolveCompanySmart(wd).company).toBe("Acme");

    const gh = thread({ domain: "greenhouse.io", subject: "Application confirmation", messages: [{ date: "2026-05-01", from: "no-reply@greenhouse.io", body: "Apply here: https://boards.greenhouse.io/globex/jobs/123" }] });
    expect(resolveCompanySmart(gh).company).toBe("Globex");

    const lv = thread({ domain: "hire.lever.co", subject: "Thanks", messages: [{ date: "2026-05-01", from: "postings@hire.lever.co", body: "See https://jobs.lever.co/initech/abc" }] });
    expect(resolveCompanySmart(lv).company).toBe("Initech");
  });

  it("leaves non-ATS and already-resolved threads alone", () => {
    expect(resolveCompanySmart(thread({ domain: "stripe.com", subject: "Your application" })).company).toBe("Stripe");
    // base already resolves the sender name through Greenhouse:
    const t = thread({ domain: "greenhouse.io", subject: "Update", messages: [{ date: "2026-05-01", from: "Acme Robotics via Greenhouse <x@greenhouse.io>", body: "An update." }] });
    expect(resolveCompanySmart(t).company).toBe("Acme Robotics");
  });

  it("never returns the platform's own name or a subject-noise word as the company", () => {
    const t = thread({ domain: "myworkday.com", subject: "Update — Application Received", messages: [{ date: "2026-05-01", from: "Workday <noreply@myworkday.com>", body: "no company here" }] });
    // "Update" must not be taken as the company; falls back to the platform name.
    expect(resolveCompanySmart(t).company).not.toBe("Update");
  });
});

describe("Workday separation — two employers on one ATS domain become two companies", () => {
  it("groups each position under its real employer, not under Workday", () => {
    const mk = (co: string): Thread => ({
      threadId: co,
      domain: "myworkday.com",
      subject: `${co} — Application Received`,
      messages: [{ date: "2026-05-01", from: "Workday <noreply@myworkday.com>", body: "Your application has been received." }],
    });
    const apps = threadsToApplications([mk("Acme"), mk("Globex"), mk("Initech")]);
    const board = boardFromApplications(apps, "live");
    const companies = board.groups.map((g) => g.company).sort();
    expect(companies).toEqual(["Acme", "Globex", "Initech"]);
    expect(companies).not.toContain("Myworkday");
  });
});

describe("statusForThread — recognises moving forward and rejection", () => {
  const t = (...bodies: string[]): Thread => ({
    threadId: "t",
    domain: "greenhouse.io",
    subject: "Application for Engineer at Acme",
    messages: bodies.map((body, i) => ({ date: `2026-0${i + 1}-01`, from: "x@greenhouse.io", body })),
  });

  it("advances applied → interview → offer across a thread", () => {
    expect(statusForThread(t("Thank you for applying."))).toBe("applied");
    expect(statusForThread(t("Thank you for applying.", "We'd like to schedule a technical interview."))).toBe("interview");
    expect(statusForThread(t("Thank you for applying.", "We'd like to schedule an interview.", "We are pleased to offer you the position."))).toBe("offer");
  });

  it("recognises a rejection even after earlier progress", () => {
    expect(statusForThread(t("Thank you for applying.", "Let's set up an interview.", "Unfortunately we've decided to move forward with other candidates."))).toBe("rejected");
  });
});
