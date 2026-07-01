import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cleanRole } from "./aggregate";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "../corpus/cases.json"), "utf8"));

type RoleCleanCase = { raw: string; company?: string; clean: string };

describe("@pipeline/classify — cleanRole (display polish over extractRole)", () => {
  for (const c of corpus.roleClean as RoleCleanCase[]) {
    it(`"${c.raw.slice(0, 46)}" → ${c.clean}`, () => {
      expect(cleanRole(c.raw, c.company)).toBe(c.clean);
    });
  }

  it("is idempotent", () => {
    for (const c of corpus.roleClean as RoleCleanCase[]) {
      const once = cleanRole(c.raw, c.company);
      expect(cleanRole(once, c.company)).toBe(once);
    }
  });

  it("never empties a title or invents 'Application'", () => {
    expect(cleanRole("Req #778")).toBe("Req #778"); // nothing real left → keep input
    expect(cleanRole("(Remote)")).toBe("(Remote)"); // would-be-empty → keep input
    expect(cleanRole("")).toBe("");
  });

  it("keeps a meaningful parenthetical", () => {
    expect(cleanRole("Engineer (Platform)")).toBe("Engineer (Platform)");
    expect(cleanRole("Analyst (FP&A)")).toBe("Analyst (FP&A)");
  });
});
