// The normalizer turns extract.ts's raw matches — the email's own words — into
// something reminders and calendars can compute with. Every shape here is one
// the extractor actually emits (its DATETIME_RES list), plus the refusals.
import { describe, it, expect } from "vitest";
import { normalizeInterviewDateTime } from "./normalize-datetime";

// Calendar facts used below (verifiable by hand): 2026-03-08 is the second
// Sunday of March and 2026-11-01 the first Sunday of November — the US DST
// bounds. 2026-06-08 is a Monday.
describe("normalizeInterviewDateTime", () => {
  it("passes machine-shaped input through, canonicalizing the separator", () => {
    expect(normalizeInterviewDateTime("2026-06-12", "2026-06-01")).toEqual({ iso: "2026-06-12", hasTime: false, zone: null });
    expect(normalizeInterviewDateTime("2026-06-12 14:00", "2026-06-01")).toEqual({ iso: "2026-06-12T14:00:00", hasTime: true, zone: null });
    expect(normalizeInterviewDateTime("2026-06-12T14:00", "2026-06-01")).toEqual({ iso: "2026-06-12T14:00:00", hasTime: true, zone: null });
  });

  it("reads US prose with a floating zone, resolving DST by the interview's own date", () => {
    // June is inside US DST → ET means EDT (-04:00)
    expect(normalizeInterviewDateTime("Tuesday, June 12 at 2:30 PM ET", "2026-06-01")).toEqual({
      iso: "2026-06-12T14:30:00-04:00",
      hasTime: true,
      zone: "ET",
    });
    // November 2 is past the DST end → PT means PST (-08:00)
    expect(normalizeInterviewDateTime("November 2 at 9am PT", "2026-10-01")?.iso).toBe("2026-11-02T09:00:00-08:00");
  });

  it("reads European day-month order and 24h time", () => {
    expect(normalizeInterviewDateTime("12 June at 14:00 CET", "2026-06-01")).toEqual({
      iso: "2026-06-12T14:00:00+01:00",
      hasTime: true,
      zone: "CET",
    });
    expect(normalizeInterviewDateTime("3rd March 2026 at 09:15", "2026-02-20")?.iso).toBe("2026-03-03T09:15:00");
  });

  it("honors an explicit year and explicit standard-time zones as written", () => {
    expect(normalizeInterviewDateTime("March 5, 2026 at 10:00 AM PST", "2026-02-01")).toEqual({
      iso: "2026-03-05T10:00:00-08:00",
      hasTime: true,
      zone: "PST",
    });
  });

  it("rolls a missing year forward when the plain reading is far in the past", () => {
    // a December email about "January 5" means NEXT January
    expect(normalizeInterviewDateTime("January 5 at 9am ET", "2026-12-20")?.iso).toBe("2027-01-05T09:00:00-05:00"); // winter → EST
    // ...but a date a few days back keeps its year (recap emails about a
    // just-passed interview must not leap 12 months into the future)
    expect(normalizeInterviewDateTime("June 12", "2026-06-20")?.iso).toBe("2026-06-12");
  });

  it("lands a bare weekday on that weekday ON or AFTER the email date", () => {
    // 2026-06-08 is a Monday → "Thursday" is June 11
    expect(normalizeInterviewDateTime("Thursday at 3pm ET", "2026-06-08")?.iso).toBe("2026-06-11T15:00:00-04:00");
    // same weekday as the email → the email's own day, not next week
    expect(normalizeInterviewDateTime("Monday at 10am", "2026-06-08")?.iso).toBe("2026-06-08T10:00:00");
    expect(normalizeInterviewDateTime("Fri at 09:45 CET", "2026-06-08")?.iso).toBe("2026-06-12T09:45:00+01:00");
  });

  it("handles ordinals, noon and midnight", () => {
    expect(normalizeInterviewDateTime("Jun 3rd, 2:00pm", "2026-06-01")?.iso).toBe("2026-06-03T14:00:00");
    expect(normalizeInterviewDateTime("June 3 at 12pm", "2026-06-01")?.iso).toBe("2026-06-03T12:00:00");
    expect(normalizeInterviewDateTime("June 3 at 12am", "2026-06-01")?.iso).toBe("2026-06-03T00:00:00");
  });

  it("refuses what it cannot place on a calendar", () => {
    // time-only: a reminder on an invented day is worse than none
    expect(normalizeInterviewDateTime("at 3:00pm PT", "2026-06-01")).toBeNull();
    expect(normalizeInterviewDateTime("at 14:00 CET", "2026-06-01")).toBeNull();
    // weekday without a time is not a meeting
    expect(normalizeInterviewDateTime("Monday", "2026-06-01")).toBeNull();
    expect(normalizeInterviewDateTime("", "2026-06-01")).toBeNull();
    expect(normalizeInterviewDateTime(null, "2026-06-01")).toBeNull();
    expect(normalizeInterviewDateTime("sometime next week", "2026-06-01")).toBeNull();
    // impossible calendar dates must not become NaN-parsing ISO strings
    expect(normalizeInterviewDateTime("June 31 at 2pm", "2026-06-01")).toBeNull();
    expect(normalizeInterviewDateTime("30 February at 10:00", "2026-02-01")).toBeNull();
    // an unreadable reference date can't resolve prose
    expect(normalizeInterviewDateTime("June 12 at 2pm", "not-a-date")).toBeNull();
  });

  it("keeps an unrecognized zone abbreviation out of the offset but visible", () => {
    const r = normalizeInterviewDateTime("June 12 at 2:30 PM AEST", "2026-06-01");
    expect(r?.iso).toBe("2026-06-12T14:30:00"); // no invented offset
    expect(r?.zone).toBeNull(); // AEST is not in the recognized set
  });
});
