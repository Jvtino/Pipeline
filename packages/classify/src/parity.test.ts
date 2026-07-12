// Parity gate: the frozen legacy root classify.js (CommonJS, used by the local
// web/desktop build) MUST agree with this TS port on every input. This is the
// safety net that lets two source copies coexist without silent drift, per the
// plan §6 (Decision #5) and §14. If this test fails, the two classifiers have
// diverged — reconcile before shipping.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as ts from "./index";
import type { Thread } from "./index";

const require = createRequire(import.meta.url);
// repo root is three levels up from packages/classify/src
const legacy = require("../../../classify.js") as typeof ts;

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(here, "../corpus/cases.json"), "utf8"));

// Extra unlabeled inputs to widen drift detection beyond the labeled corpus.
const EXTRA_TEXTS: string[] = [
  "Hi there — just confirming we received your CV and will be in touch.",
  "We'd love to set up a quick chat about the Staff Engineer opening.",
  "Regrettably we are not able to offer you a role on this occasion.",
  "Your interview is confirmed for 3pm; please join the panel via this link.",
  "Reminder: your subscription renews next week.",
  "We have moved your application to the next stage and will share availability options.",
  "Congratulations on joining the team — welcome aboard!",
  "Thanks again; we've decided to pursue other applicants whose experience is a closer match.",
];

const EXTRA_SUBJECTS: string[] = [
  "Application for Principal Designer at Globex Ltd",
  "Re: Fwd: Your application to Hooli",
  "Software Engineer II",
  "Indeed Application: Senior Data Engineer",
  "Your application was sent to Stark Industries",
];

describe("parity: legacy classify.js === @pipeline/classify", () => {
  it("detectStatus agrees on the labeled corpus + extra texts", () => {
    const texts = [...(corpus.status as { text: string }[]).map((c) => c.text), ...EXTRA_TEXTS];
    for (const t of texts) {
      expect(legacy.detectStatus(t), `detectStatus drift on: ${t}`).toBe(ts.detectStatus(t));
    }
  });

  it("evidence events and transitions agree across desktop and shared runtimes", () => {
    const texts = [
      "We received your application and it is under review.",
      "We will contact you if selected for an interview.",
      "Please select a time for your first interview.",
      "After your interview, we will not be moving forward with your application.",
      "Please complete the technical assessment by Friday.",
      "The position has been filled.",
      "We are pleased to offer you the position.",
      "Thanks for the update.\nOn Monday, Recruiter wrote:\n> Please book your interview.",
    ];
    const legacyEvents = texts.map((body) => legacy.classifyEmailEvent({ subject:"Application update", body }));
    const sharedEvents = texts.map((body) => ts.classifyEmailEvent({ subject:"Application update", body }));
    expect(legacyEvents).toEqual(sharedEvents);
    expect(legacy.resolveApplicationStatus(legacyEvents)).toEqual(ts.resolveApplicationStatus(sharedEvents));
  });

  it("application-existence decisions agree across desktop and shared runtimes", () => {
    const cases: Thread[] = [
      { threadId:"a", domain:"acme.com", subject:"Application confirmation", messages:[{date:"2026-01-01",from:"jobs@acme.com",body:"Thank you for applying. We received your application."}] },
      { threadId:"b", domain:"linkedin.com", subject:"Jobs for you", messages:[{date:"2026-01-01",from:"jobs@linkedin.com",body:"12 recommended jobs based on your profile. Apply now. Unsubscribe."}] },
      { threadId:"c", domain:"agency.com", subject:"Opportunity", messages:[{date:"2026-01-01",from:"jane@agency.com",body:"I came across your profile. Would you be interested in this role?"}] },
      { threadId:"d", domain:"acme.com", subject:"Update", messages:[{date:"2026-01-01",from:"jobs@acme.com",body:"We will not be moving forward with your application."}] },
    ];
    for (const input of cases) expect(legacy.classifyApplicationExistence(input)).toEqual(ts.classifyApplicationExistence(input));
  });

  it("resolveCompany agrees on the labeled corpus", () => {
    for (const c of corpus.company as { domain: string; from: string; subject: string; body: string }[]) {
      const th: Thread = { threadId: "t", domain: c.domain, subject: c.subject, messages: [{ date: "2026-06-01", from: c.from, body: c.body }] };
      expect(legacy.resolveCompany(th), `resolveCompany drift on: ${c.from}`).toEqual(ts.resolveCompany(th));
    }
  });

  it("companyFromDomain agrees", () => {
    for (const c of corpus.companyFromDomain as { domain: string }[]) {
      expect(legacy.companyFromDomain(c.domain)).toBe(ts.companyFromDomain(c.domain));
    }
  });

  it("companyFromSenderName agrees (incl. null platform cases)", () => {
    const froms = [
      ...(corpus.company as { from: string }[]).map((c) => c.from),
      ...(corpus.companyFromSenderName_null as { from: string }[]).map((c) => c.from),
    ];
    for (const f of froms) {
      expect(legacy.companyFromSenderName(f), `companyFromSenderName drift on: ${f}`).toBe(ts.companyFromSenderName(f));
    }
  });

  it("extractRole agrees on the labeled corpus + extra subjects", () => {
    const subjects = [...(corpus.role as { subject: string }[]).map((c) => c.subject), ...EXTRA_SUBJECTS];
    for (const s of subjects) {
      expect(legacy.extractRole(s), `extractRole drift on: ${s}`).toBe(ts.extractRole(s));
    }
  });
});
