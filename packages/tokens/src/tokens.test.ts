// The tokens' one hard contract: every classifier status has a color and a
// label — a status added to @pipeline/contracts without design support must
// fail HERE, at build time in CI, not as a gray dot in production.
import { describe, it, expect } from "vitest";
import { STATUSES } from "@pipeline/contracts";
import { statusColor, statusLabel, color } from "./index";

describe("@pipeline/tokens", () => {
  it("covers every status with a color and a label", () => {
    for (const s of STATUSES) {
      expect(statusColor[s]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(statusLabel[s].length).toBeGreaterThan(0);
    }
  });

  it("matches the desktop theme's anchor values", () => {
    expect(color.bg).toBe("#07090e");
    expect(color.blue).toBe("#2f81f7");
    expect(statusColor.interview).toBe("#f5c542");
  });
});
