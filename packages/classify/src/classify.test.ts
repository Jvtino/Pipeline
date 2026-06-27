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
