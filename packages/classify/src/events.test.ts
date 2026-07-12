import { describe, expect, it } from "vitest";
import { classifyEmailEvent, resolveApplicationStatus, type EmailEventType } from "./events";

const classify = (body: string, subject = "Application update") => classifyEmailEvent({ subject, body });

const CASES: Array<[string, string, EmailEventType, string | null, boolean]> = [
  ["application received", "Thank you for applying. We received your application.", "APPLICATION_RECEIVED", "applied", false],
  ["application under review", "Your application is under review by our hiring team.", "APPLICATION_UNDER_REVIEW", "applied", false],
  ["conditional interview language", "We will contact you if you are selected for an interview.", "UNKNOWN", null, true],
  ["explicit interview request", "We would like to invite you for a first interview.", "INTERVIEW_REQUESTED", "interview", false],
  ["interview scheduling link", "Move forward to the next round; use this Calendly scheduling link to book a time.", "INTERVIEW_REQUESTED", "interview", false],
  ["interview confirmation", "Your interview is confirmed for Monday at 2:00 PM.", "INTERVIEW_SCHEDULED", "interview", false],
  ["interview cancellation", "Your interview has been cancelled. We will follow up later.", "INTERVIEW_CANCELLED", null, false],
  ["rejection before interview", "We regret to inform you that you were not selected.", "REJECTION_RECEIVED", "rejected", false],
  ["not selected for interview", "Unfortunately, you were not selected for an interview.", "REJECTION_RECEIVED", "rejected", false],
  ["not advancing", "We are unable to advance your application to the next stage.", "REJECTION_RECEIVED", "rejected", false],
  ["not continuing", "We have decided not to continue with your candidacy.", "REJECTION_RECEIVED", "rejected", false],
  ["another candidate", "We have chosen another candidate for this position.", "REJECTION_RECEIVED", "rejected", false],
  ["closer qualifications", "We are proceeding with applicants whose qualifications more closely align with our needs.", "REJECTION_RECEIVED", "rejected", false],
  ["application unsuccessful", "Your application was unsuccessful on this occasion.", "REJECTION_RECEIVED", "rejected", false],
  ["not the right fit", "We determined that your background is not the right fit for this role.", "REJECTION_RECEIVED", "rejected", false],
  ["not considered further", "Your candidacy will not be considered further.", "REJECTION_RECEIVED", "rejected", false],
  ["assessment request", "Please complete the technical assessment by Friday.", "ASSESSMENT_REQUESTED", "applied", false],
  ["assessment completed", "Your coding assessment has been completed and received.", "ASSESSMENT_COMPLETED", "applied", false],
  ["recruiter question", "I have a few questions about your application.", "RECRUITER_CONTACT", "applied", false],
  ["unrelated recruiter marketing", "I came across your profile and have a different contract opportunity.", "UNKNOWN", null, true],
  ["offer letter", "We are pleased to offer you the position. Your offer letter is attached.", "OFFER_RECEIVED", "offer", false],
  ["position cancelled", "The position has been cancelled due to changing needs.", "POSITION_CLOSED", "rejected", false],
  ["position filled", "The position has been filled.", "POSITION_CLOSED", "rejected", false],
  ["withdrawn", "Your application has been withdrawn as requested.", "WITHDRAWN", "rejected", false],
  ["ambiguous", "We have an update about the next steps for candidates.", "UNKNOWN", null, true],
  ["rejection mentions interview", "After your interview, we will not be moving forward with your application.", "REJECTION_RECEIVED", "rejected", false],
  ["background check", "Please complete the background check through our screening partner.", "BACKGROUND_CHECK", "applied", false],
  ["additional information", "Please provide additional documents for your application.", "ADDITIONAL_INFORMATION_REQUESTED", "applied", false],
  ["on hold", "The hiring process has been put on hold.", "ON_HOLD", "applied", false],
];

describe("classifyEmailEvent — explicit evidence, confidence, and review state", () => {
  for (const [name, body, eventType, status, review] of CASES) {
    it(name, () => {
      const result = classify(body);
      expect(result.eventType).toBe(eventType);
      expect(result.suggestedStatus).toBe(status);
      expect(result.requiresManualReview).toBe(review);
      expect(result.confidence).toBeGreaterThanOrEqual(review ? 0.25 : 0.75);
      if (!review) expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.classificationReason.length).toBeGreaterThan(10);
    });
  }

  it("ignores an older quoted interview invitation in a new neutral message", () => {
    const result = classifyEmailEvent({
      subject: "Re: Interview",
      body: "Thanks, I received your note.\n\nOn Monday, Recruiter wrote:\n> We invite you to an interview.",
    });
    expect(result.eventType).toBe("UNKNOWN");
    expect(result.requiresManualReview).toBe(true);
  });
});

describe("resolveApplicationStatus — chronology and controlled transitions", () => {
  it("progresses application → interview → rejection and preserves each event", () => {
    const events = [
      classify("We received your application."),
      classify("Please select a time for your interview."),
      classify("After your interview, we will not be moving forward with your application."),
    ];
    const result = resolveApplicationStatus(events);
    expect(result.status).toBe("rejected");
    expect(result.transitions).toHaveLength(3);
    expect(result.transitions[1]?.applied).toBe(true);
    expect(result.transitions[2]?.applied).toBe(true);
  });

  it("does not let an older application confirmation downgrade an offer", () => {
    const result = resolveApplicationStatus([
      classify("We are pleased to offer you the position."),
      classify("We received your application."),
    ]);
    expect(result.status).toBe("offer");
    expect(result.transitions[1]?.applied).toBe(false);
  });

  it("does not let low-confidence conditional language change status", () => {
    const result = resolveApplicationStatus([
      classify("We received your application."),
      classify("We will contact you if selected for an interview."),
    ]);
    expect(result.status).toBe("applied");
    expect(result.transitions[1]?.applied).toBe(false);
  });
});
