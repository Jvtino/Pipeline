import type { Status } from "@pipeline/contracts";

export const EMAIL_EVENT_TYPES = [
  "APPLICATION_RECEIVED",
  "APPLICATION_UNDER_REVIEW",
  "ASSESSMENT_REQUESTED",
  "ASSESSMENT_COMPLETED",
  "RECRUITER_CONTACT",
  "INTERVIEW_REQUESTED",
  "INTERVIEW_SCHEDULED",
  "INTERVIEW_COMPLETED",
  "INTERVIEW_CANCELLED",
  "ADDITIONAL_INFORMATION_REQUESTED",
  "BACKGROUND_CHECK",
  "OFFER_RECEIVED",
  "OFFER_ACCEPTED",
  "REJECTION_RECEIVED",
  "WITHDRAWN",
  "POSITION_CLOSED",
  "ON_HOLD",
  "UNKNOWN",
] as const;

export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];

export interface EmailEventInput {
  subject?: string | null;
  body?: string | null;
  from?: string | null;
  attachments?: Array<{ name?: string | null; contentType?: string | null }> | null;
}

export interface EmailEventClassification {
  eventType: EmailEventType;
  suggestedStatus: Status | null;
  confidence: number;
  evidence: string[];
  negativeEvidence: string[];
  requiresManualReview: boolean;
  classificationReason: string;
}

export interface EventTransition {
  from: Status;
  to: Status;
  eventType: EmailEventType;
  applied: boolean;
  reason: string;
}

export interface StatusResolution {
  status: Status;
  currentEvent: EmailEventClassification | null;
  transitions: EventTransition[];
}

export const REJECTION_EVENT_RE = /\b(?:regret to inform|not (?:been )?(?:selected|shortlisted|chosen|successful|retained|invited to (?:the )?next (?:stage|round))|unable to offer you (?:an? |the )?(?:interview|position|role|job)|(?:will not|won't|cannot|can't|unable to)(?: be)? (?:move|moving|advance|advancing|proceed|proceeding|progress|progressing|continue|continuing)(?: you| with you| your (?:application|candidacy))?(?: forward| further| to (?:the )?next (?:stage|round))?|not be moving forward|decided (?:not to (?:proceed|continue|advance)|to (?:move forward|proceed|continue|pursue) with (?:another|other|different)|to pursue other)|(?:moving|proceeding|continuing|pressing|going) (?:forward|ahead) with (?:another|other) (?:candidates?|applicants?)|pursu(?:e|ing) other (?:candidates|applicants)|(?:selected|chosen) (?:another|other) (?:candidate|applicant)|(?:experience|background|qualifications|skills) (?:more )?closely (?:match|align)|(?:application|candidacy) (?:will|does) not (?:advance|progress|continue|proceed|move forward)|no longer (?:under consideration|being considered)|removed from consideration|application (?:has been |was |is )?(?:declined|rejected|unsuccessful)|unable to proceed with your (?:application|candidacy)|go in a different direction|not (?:the right |a strong )?(?:fit|match) for (?:this|the) (?:role|position)|will not be considered further)\b/i;

const RULES: Array<{
  eventType: EmailEventType;
  suggestedStatus: Status | null;
  confidence: number;
  reason: string;
  re: RegExp;
}> = [
  {
    eventType: "POSITION_CLOSED", suggestedStatus: "rejected", confidence: 0.97,
    reason: "The position or requisition is explicitly closed, cancelled, or filled.",
    re: /\b(?:(?:position|role|requisition|opening|vacancy)(?:\s+\w+){0,8}\s+(?:has been |is |was )?(?:closed|cancelled|canceled|filled|eliminated|no longer available)|hiring (?:for )?(?:this|the) (?:position|role) (?:has been )?(?:cancelled|canceled|paused))\b/i,
  },
  {
    eventType: "WITHDRAWN", suggestedStatus: "rejected", confidence: 0.98,
    reason: "The message explicitly records withdrawal of the application.",
    re: /\b(?:withdraw(?:n|ing)? (?:my|your|the) application|application (?:has been |was )?withdrawn|received your (?:request to )?withdraw|candidacy (?:has been |was )?withdrawn)\b/i,
  },
  {
    eventType: "REJECTION_RECEIVED", suggestedStatus: "rejected", confidence: 0.97,
    reason: "The latest message contains an explicit negative hiring decision.",
    re: REJECTION_EVENT_RE,
  },
  {
    eventType: "OFFER_ACCEPTED", suggestedStatus: "offer", confidence: 0.98,
    reason: "The message explicitly confirms acceptance of an employment offer.",
    re: /\b(?:offer (?:has been |was )?accepted|accepted (?:your|the|our) (?:job |employment )?offer|welcome aboard|acceptance of (?:your|the) offer|signed offer (?:letter|agreement))\b/i,
  },
  {
    eventType: "OFFER_RECEIVED", suggestedStatus: "offer", confidence: 0.97,
    reason: "The message explicitly extends or attaches an employment offer.",
    re: /\b(?:pleased|happy|delighted|excited) to offer\b|\b(?:extend(?:ing)? (?:you )?(?:an|a formal) offer|offer of employment|formal (?:job )?offer|offer letter (?:is )?attached|attached (?:is )?(?:your|the) offer letter|employment agreement|written offer)\b/i,
  },
  {
    eventType: "INTERVIEW_CANCELLED", suggestedStatus: null, confidence: 0.94,
    reason: "An interview was cancelled without evidence of a final application decision.",
    re: /\b(?:(?:cancel|cancell)(?:ed|ing)? (?:your|the|our) (?:interview|phone screen|meeting)|(?:interview|phone screen) (?:has been |was |is )?cancel(?:led|ed))\b/i,
  },
  {
    eventType: "INTERVIEW_SCHEDULED", suggestedStatus: "interview", confidence: 0.97,
    reason: "The message explicitly confirms interview scheduling or provides interview joining details.",
    re: /\b(?:(?:interview|phone screen|technical screen|recruiter screen)(?:\s+\w+){0,10}\s+(?:is |has been |was )?(?:confirmed|scheduled)|(?:confirmed|scheduled)(?:\s+\w+){0,10}\s+(?:interview|phone screen|technical screen|recruiter screen)|calendar (?:invitation|invite)(?:\s+\w+){0,8}\s+(?:interview|screen)|(?:zoom|google meet|microsoft teams|teams) (?:link|meeting)(?:\s+\w+){0,12}\s+(?:interview|screen))\b/i,
  },
  {
    eventType: "INTERVIEW_REQUESTED", suggestedStatus: "interview", confidence: 0.95,
    reason: "The message explicitly requests, invites, or asks for availability for an interview or screening call.",
    re: /\b(?:(?:invite|inviting|invited|love to invite) you (?:to|for) (?:an? |the )?(?:first |second |final )?(?:interview|phone screen|technical screen|recruiter screen)|selected (?:you )?for (?:an? |the )?(?:first |second |final )?interview|(?:schedule|book|select|choose|pick|set up|arrange)[^.]{0,80}(?:interview|phone screen|technical screen|recruiter screen)|(?:interview|phone screen|technical screen|recruiter screen)(?:\s+\w+){0,8}\s+(?:availability|schedule|time|slot)|(?:share|send|provide|confirm|let us know) your availability(?:\s+\w+){0,10}\s+(?:interview|phone screen|technical screen|recruiter screen)|mov(?:e|ing) (?:you )?forward to (?:the )?next round[^.]{0,100}(?:book a time|calendly|scheduling link))\b/i,
  },
  {
    eventType: "INTERVIEW_COMPLETED", suggestedStatus: "interview", confidence: 0.9,
    reason: "The message refers to a completed interview as the latest hiring event.",
    re: /\b(?:thank you for (?:taking the time to |meeting with us for |completing (?:your|the) )?(?:interview|phone screen)|following (?:your|the) (?:interview|phone screen)|after (?:your|the) interview)\b/i,
  },
  {
    eventType: "ASSESSMENT_COMPLETED", suggestedStatus: "applied", confidence: 0.92,
    reason: "The message confirms completion or receipt of an assessment.",
    re: /\b(?:(?:assessment|coding challenge|take[- ]home|test) (?:has been |was )?(?:completed|submitted|received)|received your (?:completed )?(?:assessment|coding challenge|test))\b/i,
  },
  {
    eventType: "ASSESSMENT_REQUESTED", suggestedStatus: "applied", confidence: 0.94,
    reason: "The message explicitly requests a hiring assessment, which is tracked separately from interviews.",
    re: /\b(?:(?:complete|take|begin|start|submit) (?:the|this|our|your|an?) (?:online |technical |skills? |coding )?(?:assessment|coding challenge|test|take[- ]home)|invited to complete (?:an? |the )?(?:assessment|coding challenge|test)|(?:next step is|please complete) (?:an? |the )?(?:technical |online |coding )?(?:assessment|coding challenge|test)|assessment (?:link|deadline|due date))\b/i,
  },
  {
    eventType: "BACKGROUND_CHECK", suggestedStatus: "applied", confidence: 0.94,
    reason: "The message explicitly requests or reports a background screening step.",
    re: /\b(?:background (?:check|screening)|pre-employment screening|criminal history check|employment verification)\b/i,
  },
  {
    eventType: "ADDITIONAL_INFORMATION_REQUESTED", suggestedStatus: "applied", confidence: 0.88,
    reason: "The hiring team explicitly asks for additional application information.",
    re: /\b(?:provide|send|submit|need|request(?:ing)?) (?:us )?(?:additional|more|the following) (?:information|documents?|details)|\badditional information (?:is )?required\b/i,
  },
  {
    eventType: "ON_HOLD", suggestedStatus: "applied", confidence: 0.9,
    reason: "The application or hiring process is explicitly paused or on hold.",
    re: /\b(?:(?:application|hiring process|requisition|position) (?:is |has been |was )?(?:put )?(?:on hold|paused)|put (?:your|the) application on hold|hiring pause)\b/i,
  },
  {
    eventType: "APPLICATION_UNDER_REVIEW", suggestedStatus: "applied", confidence: 0.94,
    reason: "The message explicitly says the application is under review.",
    re: /\b(?:application (?:is |has been |was )?(?:under review|being reviewed|in review)|reviewing your application|(?:will|we will) review your application|application (?:has been )?forwarded to (?:the )?hiring (?:team|manager))\b/i,
  },
  {
    eventType: "APPLICATION_RECEIVED", suggestedStatus: "applied", confidence: 0.96,
    reason: "The message confirms receipt or submission of the application.",
    re: /\b(?:thank(?:s| you) for applying|received your application|application (?:has been |was |is )?(?:received|submitted|registered)|successfully submitted your application|application confirmation|your application was sent|you applied (?:to|for))\b/i,
  },
  {
    eventType: "RECRUITER_CONTACT", suggestedStatus: "applied", confidence: 0.82,
    reason: "A recruiter made application-related contact without explicit interview evidence.",
    re: /\b(?:(?:recruiter|talent partner|talent acquisition)(?:\s+\w+){0,10}\s+(?:reaching out|contacting you|following up)|following up (?:on|regarding) your application|have (?:a few|some) questions about your (?:application|background)|hiring manager would like to (?:set up|have) a call)\b/i,
  },
];

const CONDITIONAL_INTERVIEW_RE =
  /\b(?:if|should) (?:you are|you're|your application is|we) (?:selected|move forward|proceed)(?:\s+\w+){0,10}\s+(?:interview|contact|reach out)|\b(?:contact|reach out to) you if (?:you are |you're )?selected|\bnot selected for (?:an? |the )?interview\b/i;
const QUOTE_BOUNDARY_RE = /^(?:on .+wrote:|from:\s|sent:\s|subject:\s|-----original message-----|begin forwarded message:)/i;

export function stripQuotedText(body: string | null | undefined): string {
  const lines = String(body ?? "").replace(/\r/g, "").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (QUOTE_BOUNDARY_RE.test(line.trim())) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

function evidenceFor(text: string, re: RegExp): string[] {
  const match = re.exec(text);
  return match?.[0] ? [match[0].replace(/\s+/g, " ").trim().slice(0, 180)] : [];
}

export function classifyEmailEvent(input: EmailEventInput | string | null | undefined): EmailEventClassification {
  const obj: EmailEventInput = typeof input === "string" || input == null ? { body: input ?? "" } : input;
  const subject = String(obj.subject ?? "").replace(/\s+/g, " ").trim();
  const body = stripQuotedText(obj.body);
  const attachmentText = (obj.attachments ?? []).map((a) => `${a.name ?? ""} ${a.contentType ?? ""}`).join(" ");
  const text = `${subject} ${body} ${attachmentText}`.replace(/\s+/g, " ").trim();

  const rejectionEvidence = evidenceFor(text, RULES[2]!.re);
  const interviewRule = RULES.find((r) => r.eventType === "INTERVIEW_REQUESTED")!;
  const interviewEvidence = CONDITIONAL_INTERVIEW_RE.test(text) ? [] : evidenceFor(text, interviewRule.re);

  for (const rule of RULES) {
    if (rule.eventType === "INTERVIEW_REQUESTED" && CONDITIONAL_INTERVIEW_RE.test(text)) continue;
    const evidence = evidenceFor(text, rule.re);
    if (!evidence.length) continue;
    const negativeEvidence = rule.eventType === "REJECTION_RECEIVED" ? interviewEvidence :
      rule.eventType.startsWith("INTERVIEW_") ? rejectionEvidence : [];
    return {
      eventType: rule.eventType,
      suggestedStatus: rule.suggestedStatus,
      confidence: rule.confidence,
      evidence,
      negativeEvidence,
      requiresManualReview: false,
      classificationReason: rule.reason,
    };
  }

  const conditional = evidenceFor(text, CONDITIONAL_INTERVIEW_RE);
  return {
    eventType: "UNKNOWN",
    suggestedStatus: null,
    confidence: conditional.length ? 0.45 : 0.25,
    evidence: [],
    negativeEvidence: conditional,
    requiresManualReview: true,
    classificationReason: conditional.length
      ? "Interview language is conditional or negated and does not prove an interview event."
      : "The message does not contain enough explicit evidence for an automatic status change.",
  };
}

export function applyEventTransition(current: Status, event: EmailEventClassification): EventTransition {
  const target = event.suggestedStatus;
  if (!target) return { from: current, to: current, eventType: event.eventType, applied: false, reason: "The event does not imply a visible status change." };
  if (event.confidence < 0.75 || event.requiresManualReview) {
    return { from: current, to: current, eventType: event.eventType, applied: false, reason: "Confidence is below the automatic-update threshold." };
  }
  if (current === "offer" && target !== "offer" && target !== "rejected") {
    return { from: current, to: current, eventType: event.eventType, applied: false, reason: "A later low-stage event cannot downgrade an offer." };
  }
  if (current === "interview" && target === "applied") {
    return { from: current, to: current, eventType: event.eventType, applied: false, reason: "An early-stage event cannot downgrade an interview." };
  }
  if (current === "rejected" && target === "applied") {
    return { from: current, to: current, eventType: event.eventType, applied: false, reason: "An early-stage event cannot reopen a rejected application." };
  }
  return { from: current, to: target, eventType: event.eventType, applied: target !== current, reason: target === current ? "The event confirms the existing status." : "Explicit evidence permits this chronological transition." };
}

export function resolveApplicationStatus(events: EmailEventClassification[], initial: Status = "applied"): StatusResolution {
  let status = initial;
  let currentEvent: EmailEventClassification | null = null;
  const transitions: EventTransition[] = [];
  for (const event of events) {
    const transition = applyEventTransition(status, event);
    transitions.push(transition);
    if (transition.applied || (event.suggestedStatus === status && event.confidence >= 0.75)) currentEvent = event;
    status = transition.to;
  }
  return { status, currentEvent, transitions };
}
