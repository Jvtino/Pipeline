import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  detectStatus,
  resolveCompany,
  extractRole,
  companyFromDomain,
  companyFromSenderName,
  isLikelyApplication,
  threadsToApplications,
} from "./index";
import type { Thread } from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "../corpus/cases.json"), "utf8"));

type StatusCase = { text: string; expected: string | null };
type CompanyCase = { domain: string; from: string; subject: string; body: string; expected: string };

function thread(c: CompanyCase): Thread {
  return { threadId: "t", domain: c.domain, subject: c.subject, messages: [{ date: "2026-06-01", from: c.from, body: c.body }] };
}

describe("@pipeline/classify — detectStatus", () => {
  for (const c of corpus.status as StatusCase[]) {
    it(`→ ${c.expected} :: ${c.text.slice(0, 44)}…`, () => {
      expect(detectStatus(c.text)).toBe(c.expected);
    });
  }
});

describe("@pipeline/classify — resolveCompany (real employer behind ATS)", () => {
  for (const c of corpus.company as CompanyCase[]) {
    it(`${c.domain} → ${c.expected}`, () => {
      expect(resolveCompany(thread(c)).company).toBe(c.expected);
    });
  }

  it("two employers on the same platform resolve to different companies", () => {
    const a = resolveCompany({ threadId: "a", domain: "greenhouse.io", subject: "Update", messages: [{ date: "2026-06-01", from: "Acme via Greenhouse <x@greenhouse.io>", body: "" }] });
    const b = resolveCompany({ threadId: "b", domain: "greenhouse.io", subject: "Update", messages: [{ date: "2026-06-01", from: "Globex via Greenhouse <y@greenhouse.io>", body: "" }] });
    expect(a.company).not.toBe(b.company);
  });

  it("unidentifiable ATS mail falls back to a non-empty platform name", () => {
    const r = resolveCompany({ threadId: "c", domain: "greenhouse.io", subject: "Update on your application", messages: [{ date: "2026-06-01", from: "no-reply <no-reply@greenhouse.io>", body: "" }] });
    expect(typeof r.company).toBe("string");
    expect(r.company.length).toBeGreaterThan(0);
  });
});

describe("@pipeline/classify — companyFromDomain (ccTLD aware)", () => {
  for (const c of corpus.companyFromDomain as { domain: string; expected: string }[]) {
    it(`${c.domain} → ${c.expected}`, () => {
      expect(companyFromDomain(c.domain)).toBe(c.expected);
    });
  }
});

describe("@pipeline/classify — platform brand words are never a company", () => {
  for (const c of corpus.companyFromSenderName_null as { from: string }[]) {
    it(`${c.from} → null`, () => {
      expect(companyFromSenderName(c.from)).toBeNull();
    });
  }
});

describe("@pipeline/classify — extractRole", () => {
  for (const c of corpus.role as { subject: string; expected: string }[]) {
    it(`"${c.subject.slice(0, 40)}" → ${c.expected}`, () => {
      expect(extractRole(c.subject)).toBe(c.expected);
    });
  }
});

describe("@pipeline/classify — job-application gate (filters inbox noise)", () => {
  const mk = (domain: string, subject: string, body = ""): Thread => ({
    threadId: "t", domain, subject, messages: [{ date: "2026-06-01", from: "x <a@b.com>", body }],
  });

  it("keeps mail with a real application signal", () => {
    expect(isLikelyApplication(mk("acme.com", "Thank you for applying to Acme"))).toBe(true);
    expect(isLikelyApplication(mk("acme.com", "Interview invitation", "we'd like to schedule a call"))).toBe(true);
  });

  it("keeps anything from an ATS / job board even without a phrase", () => {
    expect(isLikelyApplication(mk("greenhouse.io", "Your update"))).toBe(true);
    expect(isLikelyApplication(mk("indeed.com", "New roles"))).toBe(true);
  });

  it("drops account-notification and marketing mail", () => {
    expect(isLikelyApplication(mk("accountprotection.microsoft.com", "New app(s) connected to your account"))).toBe(false);
    expect(isLikelyApplication(mk("microsoft.com", "Learn how to deploy virtual machines for any application"))).toBe(false);
    expect(isLikelyApplication(mk("google.com", "Get quickstart guides for popular products"))).toBe(false);
  });

  it("threadsToApplications filters noise out of the reduced set", () => {
    const threads = [
      mk("greenhouse.io", "Acme — application received", "thank you for applying"),
      mk("accountprotection.microsoft.com", "New sign-in to your account"),
      mk("azure.microsoft.com", "Deploy your application in minutes"),
    ];
    const apps = threadsToApplications(threads);
    expect(apps.length).toBe(1);
  });
});
