import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractInterview, extractCompensation, extractLocation, extractRecruiterContact } from "./extract";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "../corpus/cases.json"), "utf8"));

describe("@pipeline/classify — extractInterview", () => {
  for (const c of corpus.interview as any[]) {
    it(`${c.null ? "null" : "value"} :: ${c.text.slice(0, 40)}…`, () => {
      const r = extractInterview(c.text);
      if (c.null) return expect(r).toBeNull();
      expect(r).not.toBeNull();
      if (c.link) expect(r!.bookingLink).toBe(c.link);
      if (c.hasLink === false) expect(r!.bookingLink).toBeNull();
      expect(r!.dateTimeText != null).toBe(!!c.hasDateTime);
    });
  }
});

describe("@pipeline/classify — extractCompensation", () => {
  for (const c of corpus.compensation as any[]) {
    it(`${c.null ? "null" : c.expect} :: ${c.text.slice(0, 40)}…`, () => {
      const r = extractCompensation(c.text);
      if (c.null) return expect(r).toBeNull();
      expect(r?.text).toBe(c.expect);
    });
  }
});

describe("@pipeline/classify — extractLocation", () => {
  for (const c of corpus.location as any[]) {
    it(`${c.null ? "null" : c.kind} :: ${c.text.slice(0, 40)}…`, () => {
      const r = extractLocation(c.text);
      if (c.null) return expect(r).toBeNull();
      expect(r?.kind).toBe(c.kind);
      if (c.contains) expect(r?.value).toContain(c.contains);
    });
  }
});

describe("@pipeline/classify — extractRecruiterContact", () => {
  for (const c of corpus.recruiterContact as any[]) {
    it(`${c.null ? "null" : c.name} :: ${c.text.slice(0, 40)}…`, () => {
      const r = extractRecruiterContact(c.text);
      if (c.null) return expect(r).toBeNull();
      expect(r).not.toBeNull();
      if (c.name) expect(r!.name).toBe(c.name);
      if (c.titleContains) expect(r!.title ?? "").toContain(c.titleContains);
      if (c.email) expect(r!.email).toBe(c.email);
    });
  }

  it("never treats a platform/no-reply address as a human contact", () => {
    expect(extractRecruiterContact("Reply to no-reply@lever.co")).toBeNull();
    expect(extractRecruiterContact("The Recruiting Team")).toBeNull();
  });
});
