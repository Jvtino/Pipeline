import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyStatus, detectStatus, LOW_CONFIDENCE } from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "../corpus/cases.json"), "utf8"));

type StatusCase = { text: string; expected: string | null };
type ConfCase = { text: string; low: boolean; reason: string };

describe("@pipeline/classify — classifyStatus preserves the detectStatus label", () => {
  // The whole point of the wrapper: same label, extra signal. If this ever drifts,
  // confidence is being computed from a different decision than the board shows.
  const texts = [
    ...(corpus.status as StatusCase[]).map((c) => c.text),
    ...(corpus.confidence as ConfCase[]).map((c) => c.text),
    "We'd love to set up a quick chat about the Staff Engineer opening.",
    "Regrettably we are not able to offer you a role on this occasion.",
  ];
  for (const t of texts) {
    it(`status matches :: ${t.slice(0, 44)}…`, () => {
      expect(classifyStatus(t).status).toBe(detectStatus(t));
    });
  }
});

describe("@pipeline/classify — classifyStatus confidence + reasons", () => {
  for (const c of corpus.confidence as ConfCase[]) {
    it(`${c.low ? "low " : "high"} (${c.reason}) :: ${c.text.slice(0, 40)}…`, () => {
      const r = classifyStatus(c.text);
      expect(r.confidence < LOW_CONFIDENCE, `confidence=${r.confidence}`).toBe(c.low);
      expect(r.reasons).toContain(c.reason);
    });
  }

  it("returns null status + zero confidence when no cue fires", () => {
    const r = classifyStatus("Your package has shipped and will arrive tomorrow.");
    expect(r.status).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.reasons).toContain("no_signal");
  });

  it("a lone weak cue decides but stays low-confidence", () => {
    const r = classifyStatus("Thanks again for the interview.");
    expect(r.status).toBe("interview");
    expect(r.confidence).toBeLessThan(LOW_CONFIDENCE);
    expect(r.reasons).toContain("weak_cue_only");
  });

  it("a decisive rejection carrying interview language is flagged mixed_signal", () => {
    const r = classifyStatus("We enjoyed your interview, unfortunately we're moving forward with other candidates.");
    expect(r.status).toBe("rejected"); // label is correct…
    expect(r.confidence).toBeLessThan(LOW_CONFIDENCE); // …but ambiguous → review
    expect(r.reasons).toContain("mixed_signal");
  });

  it("a clean decisive phrase is high-confidence", () => {
    expect(classifyStatus("We are pleased to offer you the position.").confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE);
  });
});
