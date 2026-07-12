"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../classify");

const CASES = [
  ["confirmation stays applied", "We received your application.", "APPLICATION_RECEIVED", "applied"],
  ["conditional interview is unknown", "We will contact you if selected for an interview.", "UNKNOWN", null],
  ["explicit interview request", "Please select a time for your interview.", "INTERVIEW_REQUESTED", "interview"],
  ["not selected for interview is rejection", "You were not selected for an interview.", "REJECTION_RECEIVED", "rejected"],
  ["unable to advance is rejection", "We are unable to advance your application to the next stage.", "REJECTION_RECEIVED", "rejected"],
  ["chosen another candidate is rejection", "We have chosen another candidate for this position.", "REJECTION_RECEIVED", "rejected"],
  ["closer qualifications is rejection", "We are proceeding with applicants whose qualifications more closely align with our needs.", "REJECTION_RECEIVED", "rejected"],
  ["unsuccessful application is rejection", "Your application was unsuccessful on this occasion.", "REJECTION_RECEIVED", "rejected"],
  ["assessment is not interview", "Please complete the technical assessment by Friday.", "ASSESSMENT_REQUESTED", "applied"],
  ["rejection overrides interview wording", "After your interview, we will not be moving forward with your application.", "REJECTION_RECEIVED", "rejected"],
  ["position filled is closed", "The position has been filled.", "POSITION_CLOSED", "rejected"],
  ["position cancelled is not rejection", "The requisition has been cancelled due to changing business needs.", "POSITION_CANCELLED", "cancelled"],
  ["offer is explicit", "We are pleased to offer you the position.", "OFFER_RECEIVED", "offer"],
];

for (const [name, body, eventType, status] of CASES) {
  test(name, () => {
    const result = C.classifyEmailEvent({ subject:"Application update", body });
    assert.equal(result.eventType, eventType);
    assert.equal(result.suggestedStatus, status);
    assert.ok(result.classificationReason);
  });
}

test("quoted older interview text does not change the newest message", () => {
  const result = C.classifyEmailEvent({ subject:"Re: Interview", body:"Thanks for the note.\nOn Monday, Recruiter wrote:\n> Please select a time for your interview." });
  assert.equal(result.eventType, "UNKNOWN");
});

test("state machine preserves chronology and rejects downgrades", () => {
  const events = [
    C.classifyEmailEvent("We are pleased to offer you the position."),
    C.classifyEmailEvent("We received your application."),
  ];
  const result = C.resolveApplicationStatus(events);
  assert.equal(result.status, "offer");
  assert.equal(result.transitions[1].applied, false);
});
