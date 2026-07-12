import { describe, expect, it } from "vitest";
import { applicationLearningFeatures, classifyApplicationExistence, learnedApplicationDecision } from "./index";
import type { Thread } from "./index";

const thread = (domain: string, subject: string, body: string, from = `mail@${domain}`): Thread => ({
  threadId:`${domain}:${subject}`, domain, subject,
  messages:[{ date:"2026-07-01", from, body }],
});

describe("application feedback learning", () => {
  it("learns a positive pattern without storing message bodies", () => {
    const approved = thread("careers.contoso.com", "Thanks for your interest in Platform Engineer", "We will be in touch soon.", "Contoso Careers <updates@careers.contoso.com>");
    const similar = thread("careers.contoso.com", "Thanks for your interest in Backend Engineer", "Our team will be in touch soon.", "Contoso Careers <updates@careers.contoso.com>");
    const features = applicationLearningFeatures(approved);
    expect(features).not.toHaveProperty("body");
    expect(learnedApplicationDecision(similar, [{ label:"application", features }]).decision).toBe("application");
  });

  it("learns a rejection but never trusts a shared ATS domain alone", () => {
    const alert = thread("myworkday.com", "New roles selected for you", "Review these roles.", "Workday <no-reply@myworkday.com>");
    const security = thread("myworkday.com", "Security code", "Use this code to sign in.", "Workday <no-reply@myworkday.com>");
    const features = applicationLearningFeatures(alert);
    expect(learnedApplicationDecision(alert, [{ label:"not_application", features }]).decision).toBe("not_application");
    expect(learnedApplicationDecision(security, [{ label:"not_application", features }]).decision).toBeNull();
  });
});

describe("classifyApplicationExistence — submitted applications vs advertising", () => {
  const cases: Array<[string, Thread, string, boolean, boolean]> = [
    ["genuine confirmation", thread("acme.com", "Application confirmation — Data Analyst at Acme", "Thank you for applying. We received your application."), "CONFIRMED_APPLICATION", true, false],
    ["job-board recommendation", thread("linkedin.com", "Jobs you may be interested in", "Recommended jobs based on your profile. Apply now."), "NOT_AN_APPLICATION", false, false],
    ["weekly multi-job alert", thread("indeed.com", "Weekly job alert", "12 new jobs match your saved search. Apply now. Unsubscribe."), "NOT_AN_APPLICATION", false, false],
    ["recruiter interest check", thread("agency.com", "Staff Engineer opportunity", "I came across your profile. Would you be interested in this role?"), "NOT_AN_APPLICATION", false, false],
    ["directed rejection without confirmation", thread("acme.com", "Application update", "We will not be moving forward with your application."), "LIKELY_APPLICATION", true, false],
    ["alternate rejection without confirmation", thread("acme.com", "An update", "We are unable to advance your candidacy to the next stage."), "LIKELY_APPLICATION", true, false],
    ["directed interview invitation", thread("acme.com", "Next step", "We'd like to schedule a technical interview. Please share your availability."), "LIKELY_APPLICATION", true, false],
    ["incomplete application reminder", thread("workday.com", "Complete your application", "Finish your application to be considered. Apply now."), "NOT_AN_APPLICATION", false, false],
    ["talent community invitation", thread("acme.com", "Join our talent community", "Hear about new openings and update email preferences."), "NOT_AN_APPLICATION", false, false],
    ["career newsletter", thread("acme.com", "Acme careers newsletter", "We're hiring for several roles. View each job description. Unsubscribe."), "NOT_AN_APPLICATION", false, false],
    ["ATS confirmation", thread("myworkday.com", "Acme — Application confirmation", "Application ID: APP-7788. Your application has been submitted.", "Workday <no-reply@myworkday.com>"), "CONFIRMED_APPLICATION", true, false],
    ["matching-title advertisement", thread("linkedin.com", "Senior Engineer at Acme", "Sponsored job based on your profile. Apply now."), "NOT_AN_APPLICATION", false, false],
    ["vague application reference", thread("acme.com", "Update", "There is an update regarding your application."), "LIKELY_APPLICATION", false, true],
    ["sent resume response", thread("acme.com", "Application for Designer", "Thank you for applying. We received your resume and application."), "CONFIRMED_APPLICATION", true, false],
    ["personal-looking campaign", thread("agency.com", "A role picked for you", "I came across your profile. This featured opportunity may interest you. Apply now. Unsubscribe."), "NOT_AN_APPLICATION", false, false],
    ["non-job mail", thread("store.com", "Order shipped", "Your order will arrive tomorrow."), "NOT_AN_APPLICATION", false, false],
  ];

  for (const [name, input, existence, create, review] of cases) {
    it(name, () => {
      const result = classifyApplicationExistence(input);
      expect(result.application_status).toBe(existence);
      expect(result.should_create_application).toBe(create);
      expect(result.manual_review_required).toBe(review);
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.reasoning_summary.length).toBeGreaterThan(20);
    });
  }

  it("returns schema-stable fields and extracts application identifiers", () => {
    const result = classifyApplicationExistence(thread("greenhouse.io", "Acme application", "Thank you for applying. Application ID: APP-1234; Req ID: REQ-8888."));
    expect(result.application_id).toBe("APP-1234");
    expect(result.requisition_id).toBe("REQ-8888");
    expect(Array.isArray(result.evidence_for)).toBe(true);
    expect(Array.isArray(result.evidence_against)).toBe(true);
  });
});
