// classify.js — the "brain": turn raw email text into (a) a status and (b) the
// real employer, even when mail comes through a shared hiring platform (Workday,
// Greenhouse, Lever, LinkedIn, Indeed…). Pure, dependency-free, and shared by the
// web app (index.html), the desktop app, and the Node unit tests (test/classify.test.js).
//
// Works in the browser (functions become globals) AND in Node (module.exports at
// the bottom). Keep it pure — no DOM, no network — so it stays testable.
"use strict";

/* ============================================================================
   STATUS CLASSIFIER
   ----------------------------------------------------------------------------
   Scored, not first-match: every cue adds points to a status; the highest score
   wins (ties broken by precedence). This is far more robust than "first regex
   that matches", because real emails mix signals ("after your interview …
   unfortunately"). Strong, decisive phrases score high; weak single-word cues
   score low so they only matter when nothing stronger is present.
   ========================================================================== */

// rank = how "advanced"/decisive a status is (used when blending subject + body)
const STATUS_RANK = { applied: 1, interview: 2, offer: 3, rejected: 3 };

const OFFER_RE = /\b(pleased to offer|happy to offer|delighted to offer|excited to offer|we(?:'?d| would) like to offer|extend(?:ing)? (?:to )?you (?:an|our|a formal) offer|extend(?:ing)? an offer|offer of employment|formal (?:job )?offer|verbal offer|offer letter|employment agreement|appointment letter|official offer|written offer|offer package|acceptance deadline|review and sign|attached offer|offer (?:letter )?(?:is )?attached|(?:contingent|conditional) offer|(?:preparing|drafting) (?:your|an|the) offer|offer is (?:in|pending) approval|moving to (?:the )?offer stage|new hire paperwork|onboarding (?:documents|portal|paperwork|process)|benefits enrollment|i-9|w-4|we(?:'?re| are) (?:thrilled|excited|pleased|delighted) to extend|congratulations[^.]{0,40}\b(offer|join|aboard|team)\b|welcome (?:to the team|aboard)|your (?:start date|compensation package|signing bonus))\b/;
// rejection that contains the word "offer" in a NEGATED form ("unable to offer", "cannot offer you")
const NEG_OFFER_RE = /\b(cannot|can'?t|could ?n'?t|unable to|not able to|won'?t be able to|will not be able to|regret(?:tably)?[^.]{0,20})\b[^.]{0,25}\boffer\b/;

const REJECT_RE = /\b(unfortunately|we regret|regret to inform|with (?:great |deep |sincere )?regret|we(?:'?ve| have) decided (?:not to|against)|we(?:'?ve| have) decided to (?:move|proceed|go)(?: forward| ahead)? with (?:(?:an)?other|a different)|(?:not|won'?t) be (?:moving|proceeding|progressing) (?:forward|ahead|further)|will not be (?:moving|proceeding|progressing)|mov(?:e|ing) forward with other|other (?:candidates|applicants)|pursu(?:e|ing) other (?:candidates|applicants)|(?:chose(?:n)?|selected|pursu(?:e|ed|ing)) another (?:candidate|applicant)|not (?:be )?(?:selected|shortlisted|successful|progressing|chosen)|not (?:been )?retained|declined your application|application (?:was|has been) declined|removed from consideration|(?:role|position) is no longer available|(?:position|role) has been (?:cancelled|canceled|closed)|unable to proceed|will not proceed|hiring needs have changed|more closely (?:match|align)|position (?:has been|is now) filled|role (?:has been|is now) filled|filled (?:the|this) (?:position|role)|no longer (?:moving|being considered|under consideration)|not (?:to )?(?:proceed|progress) (?:with|further)|different direction|unsuccessful (?:on this occasion|at this time|this time)|wish you (?:the best|well|success|luck)|keep your (?:details|resume|cv) on file|decided to go (?:with|in)|not a (?:fit|match) (?:at this|for this)|won'?t be (?:taking|progressing) your application)\b/;

const INTERVIEW_RE = /\b(phone (?:screen|interview|call)|technical (?:screen|interview|phone)|video (?:screen|interview|call)|first (?:round|interview)|final (?:round|interview|stage)|next (?:round|step|steps|stage)|coding (?:challenge|assessment|test|exercise|interview)|(?:online|technical|skills?|hackerrank|codility) assessment|take[- ]?home|invite(?:d|s)? you (?:to|for)|(?:would|we(?:'?d| would)) (?:like|love) to (?:schedule|set up|arrange|invite|meet|speak|chat|connect|talk|have)|schedule (?:a|an|some|your) (?:call|interview|meeting|screen|chat|conversation|time)|set up (?:a|an|some) (?:call|interview|meeting|time|chat)|book (?:a|some) time|find a time|(?:share|provide|confirm|send|let us know) (?:your )?availability|(?:are you|when are you) available|move (?:you )?(?:forward|to the next|ahead)|advanc(?:e|ing) (?:your|to)|progress(?:ing)? (?:your|to the next)|speak (?:with|to) (?:you|the)|meet (?:with )?(?:the|our) (?:team|hiring|manager)|hiring manager|meet the team|on-?site|panel interview|interview (?:invitation|invite|request)|calendly|book (?:a )?(?:slot|call)|calendar invite|invite has been sent|joining details|zoom link|google meet|microsoft teams|teams (?:link|meeting)|dial-?in|conference link|self-?schedul(?:e|ing)|scheduling link|(?:recruiter|talent) screen)\b/;

const APPLIED_RE = /\b(thank(?:s| you) for (?:applying|your application|submitting|your interest)|appreciate your (?:interest|application)|application (?:has been |was )?(?:received|submitted|registered)|received your application|we(?:'?ve| have) received your|successfully (?:submitted|applied|received)|your application (?:is|has been|was) (?:received|submitted|under review|being reviewed|in)|(?:currently |now )?(?:under|in) review|reviewing your application|will (?:review|be in touch|get back)|in our (?:system|database)|has been received)\b/;

// Reschedule logistics — an interview being MOVED, not ended. Without this,
// "Unfortunately, we need to reschedule your interview" reads as a rejection
// (lone "unfortunately" is decisive and wins the tie-break). Scored a notch
// ABOVE a lone soft rejection cue; a real rejection in the same mail still wins
// through its own decisive phrase ("position has been filled", …). Bare
// CANCELLATION is deliberately excluded: it isn't progress, and when it comes
// with a closure phrase the rejection must win.
const RESCHEDULE_RE = /\b(?:reschedul(?:e|ing|ed)|find (?:another|a new) time|(?:another|an alternative|a new) time for (?:our|your|the)|conflict (?:has )?c[ao]me up|no longer works for (?:us|me)|does .{0,30} work instead|(?:updated|revised) (?:calendar )?invite)\b/;
// Refusing to reschedule is not rescheduling ("we will not be rescheduling").
const NEG_RESCHEDULE_RE = /\b(?:not|won'?t|will not|unable to|cannot|can'?t)(?: be)? reschedul/;

/* Turkish job-mail phrasings — high-precision renderings of the standard
   ATS/LinkedIn/kurumsal templates ("maalesef … olumsuz", "başvurunuz alınmıştır",
   "mülakata davet", "iş teklifi"). Substring-matched: \b is unreliable next to
   non-ASCII letters in JS regex. Kept deliberately small; negation handling and
   broader coverage wait for real misclassified mail in the corpus. */
const TR_REJECT_RE = /(maalesef|ne yazık ki|olumsuz (?:bir karar|sonuçlan|değerlendir)|olumlu sonuçlanmad|başka bir aday)/;
const TR_INTERVIEW_RE = /(mülakat|görüşmeye davet|telefon görüşmesi|değerlendirme merkezi)/;
const TR_APPLIED_RE = /(başvurunuz (?:başarıyla )?(?:alınmış|alındı|iletil)|başvurunuzu aldık|değerlendirmeye alınmış|başvurunuz için teşekkür)/;
const TR_OFFER_RE = /(i̇?ş teklifi|teklif mektubu)/;

function detectStatus(text) {
  const t = " " + String(text || "").toLowerCase().replace(/\s+/g, " ") + " ";
  const score = { offer: 0, rejected: 0, interview: 0, applied: 0 };

  const negOffer = NEG_OFFER_RE.test(t);
  if (OFFER_RE.test(t) && !negOffer) score.offer += 10;
  if (REJECT_RE.test(t)) score.rejected += 10;
  if (negOffer) score.rejected += 10;          // "unable to offer you the role" = rejection
  if (INTERVIEW_RE.test(t)) score.interview += 8;
  if (APPLIED_RE.test(t)) score.applied += 5;
  if (RESCHEDULE_RE.test(t) && !NEG_RESCHEDULE_RE.test(t)) score.interview += 10;

  // Turkish templates — same weights as their English counterparts.
  if (TR_OFFER_RE.test(t)) score.offer += 10;
  if (TR_REJECT_RE.test(t)) score.rejected += 10;
  if (TR_INTERVIEW_RE.test(t)) score.interview += 8;
  if (TR_APPLIED_RE.test(t)) score.applied += 5;

  // weak single-word cues — only decide when no stronger phrase fired
  if (/\b(interview|assessment|availability|next steps)\b/.test(t)) score.interview += 2;
  if (/\b(rejected|declined|not selected|competitive applicant pool|difficult decision)\b/.test(t)) score.rejected += 2;
  // "after careful consideration" is a rejection PREAMBLE, not a decision — real
  // rejections carry a decisive phrase of their own, while interview invitations
  // also open with it ("After careful consideration, we'd like to invite you…").
  if (/\bafter (?:careful|much|thorough) (?:consideration|thought|review|deliberation)\b/.test(t)) score.rejected += 2;
  // Background screening is usually POST-offer, but sometimes pre-offer — weak cue only.
  if (/\b(background (?:check|screening)|pre-employment screening)\b/.test(t)) score.offer += 2;
  if (/\b(congratulations|congrats)\b/.test(t)) score.offer += 1;

  // pick the highest; precedence offer > rejected > interview > applied on ties
  let best = null, bestScore = 0;
  for (const k of ["offer", "rejected", "interview", "applied"]) {
    if (score[k] > bestScore) { best = k; bestScore = score[k]; }
  }
  return best;   // null when nothing matched (caller keeps the prior status)
}

/* ============================================================================
   EVIDENCE-BASED EMAIL EVENTS
   Extract a specific event first; visible status is derived later through the
   controlled transition function. These rules intentionally reject conditional
   or negated interview language instead of treating isolated keywords as proof.
   ========================================================================== */
const REJECTION_EVENT_RE = /\b(?:regret to inform|not (?:been )?(?:selected|shortlisted|chosen|successful|retained|invited to (?:the )?next (?:stage|round))|unable to offer you (?:an? |the )?(?:interview|position|role|job)|(?:will not|won't|cannot|can't|unable to)(?: be)? (?:move|moving|advance|advancing|proceed|proceeding|progress|progressing|continue|continuing)(?: you| with you| your (?:application|candidacy))?(?: forward| further| to (?:the )?next (?:stage|round))?|not be moving forward|decided (?:not to (?:proceed|continue|advance)|to (?:move forward|proceed|continue|pursue) with (?:another|other|different)|to pursue other)|(?:moving|proceeding|continuing|pressing|going) (?:forward|ahead) with (?:another|other) (?:candidates?|applicants?)|pursu(?:e|ing) other (?:candidates|applicants)|(?:selected|chosen) (?:another|other) (?:candidate|applicant)|(?:experience|background|qualifications|skills) (?:more )?closely (?:match|align)|(?:application|candidacy) (?:will|does) not (?:advance|progress|continue|proceed|move forward)|no longer (?:under consideration|being considered)|removed from consideration|application (?:has been |was |is )?(?:declined|rejected|unsuccessful)|unable to proceed with your (?:application|candidacy)|go in a different direction|not (?:the right |a strong )?(?:fit|match) for (?:this|the) (?:role|position)|will not be considered further)\b/i;
const EMAIL_EVENT_RULES = [
  ["POSITION_CLOSED", "rejected", .97, "The position or requisition is explicitly closed, cancelled, or filled.", /\b(?:(?:position|role|requisition|opening|vacancy)(?:\s+\w+){0,8}\s+(?:has been |is |was )?(?:closed|cancelled|canceled|filled|eliminated|no longer available)|hiring (?:for )?(?:this|the) (?:position|role) (?:has been )?(?:cancelled|canceled|paused))\b/i],
  ["WITHDRAWN", "rejected", .98, "The message explicitly records withdrawal of the application.", /\b(?:withdraw(?:n|ing)? (?:my|your|the) application|application (?:has been |was )?withdrawn|received your (?:request to )?withdraw|candidacy (?:has been |was )?withdrawn)\b/i],
  ["REJECTION_RECEIVED", "rejected", .97, "The latest message contains an explicit negative hiring decision.", REJECTION_EVENT_RE],
  ["OFFER_ACCEPTED", "offer", .98, "The message explicitly confirms acceptance of an employment offer.", /\b(?:offer (?:has been |was )?accepted|accepted (?:your|the|our) (?:job |employment )?offer|welcome aboard|acceptance of (?:your|the) offer|signed offer (?:letter|agreement))\b/i],
  ["OFFER_RECEIVED", "offer", .97, "The message explicitly extends or attaches an employment offer.", /\b(?:pleased|happy|delighted|excited) to offer\b|\b(?:extend(?:ing)? (?:you )?(?:an|a formal) offer|offer of employment|formal (?:job )?offer|offer letter (?:is )?attached|attached (?:is )?(?:your|the) offer letter|employment agreement|written offer)\b/i],
  ["INTERVIEW_CANCELLED", null, .94, "An interview was cancelled without evidence of a final application decision.", /\b(?:(?:cancel|cancell)(?:ed|ing)? (?:your|the|our) (?:interview|phone screen|meeting)|(?:interview|phone screen) (?:has been |was |is )?cancel(?:led|ed))\b/i],
  ["INTERVIEW_SCHEDULED", "interview", .97, "The message explicitly confirms interview scheduling or provides interview joining details.", /\b(?:(?:interview|phone screen|technical screen|recruiter screen)(?:\s+\w+){0,10}\s+(?:is |has been |was )?(?:confirmed|scheduled)|(?:confirmed|scheduled)(?:\s+\w+){0,10}\s+(?:interview|phone screen|technical screen|recruiter screen)|calendar (?:invitation|invite)(?:\s+\w+){0,8}\s+(?:interview|screen)|(?:zoom|google meet|microsoft teams|teams) (?:link|meeting)(?:\s+\w+){0,12}\s+(?:interview|screen))\b/i],
  ["INTERVIEW_REQUESTED", "interview", .95, "The message explicitly requests, invites, or asks for availability for an interview or screening call.", /\b(?:(?:invite|inviting|invited|love to invite) you (?:to|for) (?:an? |the )?(?:first |second |final )?(?:interview|phone screen|technical screen|recruiter screen)|selected (?:you )?for (?:an? |the )?(?:first |second |final )?interview|(?:schedule|book|select|choose|pick|set up|arrange)[^.]{0,80}(?:interview|phone screen|technical screen|recruiter screen)|(?:interview|phone screen|technical screen|recruiter screen)(?:\s+\w+){0,8}\s+(?:availability|schedule|time|slot)|(?:share|send|provide|confirm|let us know) your availability(?:\s+\w+){0,10}\s+(?:interview|phone screen|technical screen|recruiter screen)|mov(?:e|ing) (?:you )?forward to (?:the )?next round[^.]{0,100}(?:book a time|calendly|scheduling link))\b/i],
  ["INTERVIEW_COMPLETED", "interview", .90, "The message refers to a completed interview as the latest hiring event.", /\b(?:thank you for (?:taking the time to |meeting with us for |completing (?:your|the) )?(?:interview|phone screen)|following (?:your|the) (?:interview|phone screen)|after (?:your|the) interview)\b/i],
  ["ASSESSMENT_COMPLETED", "applied", .92, "The message confirms completion or receipt of an assessment.", /\b(?:(?:assessment|coding challenge|take[- ]home|test) (?:has been |was )?(?:completed|submitted|received)|received your (?:completed )?(?:assessment|coding challenge|test))\b/i],
  ["ASSESSMENT_REQUESTED", "applied", .94, "The message explicitly requests a hiring assessment, which is tracked separately from interviews.", /\b(?:(?:complete|take|begin|start|submit) (?:the|this|our|your|an?) (?:online |technical |skills? |coding )?(?:assessment|coding challenge|test|take[- ]home)|invited to complete (?:an? |the )?(?:assessment|coding challenge|test)|(?:next step is|please complete) (?:an? |the )?(?:technical |online |coding )?(?:assessment|coding challenge|test)|assessment (?:link|deadline|due date))\b/i],
  ["BACKGROUND_CHECK", "applied", .94, "The message explicitly requests or reports a background screening step.", /\b(?:background (?:check|screening)|pre-employment screening|criminal history check|employment verification)\b/i],
  ["ADDITIONAL_INFORMATION_REQUESTED", "applied", .88, "The hiring team explicitly asks for additional application information.", /\b(?:provide|send|submit|need|request(?:ing)?) (?:us )?(?:additional|more|the following) (?:information|documents?|details)|\badditional information (?:is )?required\b/i],
  ["ON_HOLD", "applied", .90, "The application or hiring process is explicitly paused or on hold.", /\b(?:(?:application|hiring process|requisition|position) (?:is |has been |was )?(?:put )?(?:on hold|paused)|put (?:your|the) application on hold|hiring pause)\b/i],
  ["APPLICATION_UNDER_REVIEW", "applied", .94, "The message explicitly says the application is under review.", /\b(?:application (?:is |has been |was )?(?:under review|being reviewed|in review)|reviewing your application|(?:will|we will) review your application|application (?:has been )?forwarded to (?:the )?hiring (?:team|manager))\b/i],
  ["APPLICATION_RECEIVED", "applied", .96, "The message confirms receipt or submission of the application.", /\b(?:thank(?:s| you) for applying|received your application|application (?:has been |was |is )?(?:received|submitted|registered)|successfully submitted your application|application confirmation|your application was sent|you applied (?:to|for))\b/i],
  ["RECRUITER_CONTACT", "applied", .82, "A recruiter made application-related contact without explicit interview evidence.", /\b(?:(?:recruiter|talent partner|talent acquisition)(?:\s+\w+){0,10}\s+(?:reaching out|contacting you|following up)|following up (?:on|regarding) your application|have (?:a few|some) questions about your (?:application|background)|hiring manager would like to (?:set up|have) a call)\b/i],
];
const CONDITIONAL_INTERVIEW_RE = /\b(?:if|should) (?:you are|you're|your application is|we) (?:selected|move forward|proceed)(?:\s+\w+){0,10}\s+(?:interview|contact|reach out)|\b(?:contact|reach out to) you if (?:you are |you're )?selected|\bnot selected for (?:an? |the )?interview\b/i;
const QUOTE_BOUNDARY_RE = /^(?:on .+wrote:|from:\s|sent:\s|subject:\s|-----original message-----|begin forwarded message:)/i;

function stripQuotedText(body) {
  const kept = [];
  for (const line of String(body || "").replace(/\r/g, "").split("\n")) {
    if (QUOTE_BOUNDARY_RE.test(line.trim())) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim();
}
function eventEvidence(text, re) {
  const m = re.exec(text);
  return m && m[0] ? [m[0].replace(/\s+/g, " ").trim().slice(0, 180)] : [];
}
function classifyEmailEvent(input) {
  const obj = typeof input === "string" || input == null ? { body:input || "" } : input;
  const subject = String(obj.subject || "").replace(/\s+/g, " ").trim();
  const body = stripQuotedText(obj.body);
  const attachmentText = (obj.attachments || []).map(a => `${a.name || ""} ${a.contentType || ""}`).join(" ");
  const text = `${subject} ${body} ${attachmentText}`.replace(/\s+/g, " ").trim();
  const rejectionRule = EMAIL_EVENT_RULES.find(r => r[0] === "REJECTION_RECEIVED");
  const interviewRule = EMAIL_EVENT_RULES.find(r => r[0] === "INTERVIEW_REQUESTED");
  const rejectionEvidence = eventEvidence(text, rejectionRule[4]);
  const interviewEvidence = CONDITIONAL_INTERVIEW_RE.test(text) ? [] : eventEvidence(text, interviewRule[4]);
  for (const rule of EMAIL_EVENT_RULES) {
    if (rule[0] === "INTERVIEW_REQUESTED" && CONDITIONAL_INTERVIEW_RE.test(text)) continue;
    const evidence = eventEvidence(text, rule[4]);
    if (!evidence.length) continue;
    return {
      eventType:rule[0], suggestedStatus:rule[1], confidence:rule[2], evidence,
      negativeEvidence:rule[0] === "REJECTION_RECEIVED" ? interviewEvidence : (String(rule[0]).startsWith("INTERVIEW_") ? rejectionEvidence : []),
      requiresManualReview:false, classificationReason:rule[3],
    };
  }
  const conditional = eventEvidence(text, CONDITIONAL_INTERVIEW_RE);
  return {
    eventType:"UNKNOWN", suggestedStatus:null, confidence:conditional.length ? .45 : .25,
    evidence:[], negativeEvidence:conditional, requiresManualReview:true,
    classificationReason:conditional.length ? "Interview language is conditional or negated and does not prove an interview event." : "The message does not contain enough explicit evidence for an automatic status change.",
  };
}
function applyEventTransition(current, event) {
  const target = event.suggestedStatus;
  if (!target) return { from:current, to:current, eventType:event.eventType, applied:false, reason:"The event does not imply a visible status change." };
  if (event.confidence < .75 || event.requiresManualReview) return { from:current, to:current, eventType:event.eventType, applied:false, reason:"Confidence is below the automatic-update threshold." };
  if (current === "offer" && target !== "offer" && target !== "rejected") return { from:current, to:current, eventType:event.eventType, applied:false, reason:"A later low-stage event cannot downgrade an offer." };
  if (current === "interview" && target === "applied") return { from:current, to:current, eventType:event.eventType, applied:false, reason:"An early-stage event cannot downgrade an interview." };
  if (current === "rejected" && target === "applied") return { from:current, to:current, eventType:event.eventType, applied:false, reason:"An early-stage event cannot reopen a rejected application." };
  return { from:current, to:target, eventType:event.eventType, applied:target !== current, reason:target === current ? "The event confirms the existing status." : "Explicit evidence permits this chronological transition." };
}
function resolveApplicationStatus(events, initial) {
  let status = initial || "applied", currentEvent = null;
  const transitions = [];
  for (const event of events) {
    const transition = applyEventTransition(status, event);
    transitions.push(transition);
    if (transition.applied || (event.suggestedStatus === status && event.confidence >= .75)) currentEvent = event;
    status = transition.to;
  }
  return { status, currentEvent, transitions };
}

const EXIST_RECOMMENDATION_RE = /\b(?:jobs? (?:you may be interested in|for you|matching your profile|you may like)|recommended jobs?|based on your profile|saved (?:job )?search|new jobs? matching|weekly job alert)\b/i;
const EXIST_AD_RE = /\b(?:apply now|we(?:'re| are) hiring|featured opportunity|sponsored job|new openings?|complete your profile to apply|start (?:your|an) application|your next career opportunity|view (?:the )?job description)\b/i;
const EXIST_NEWSLETTER_RE = /\b(?:newsletter|talent community|career newsletter|email preferences?|unsubscribe|you are receiving this because you subscribed|promotional email)\b/i;
const EXIST_OUTREACH_RE = /\b(?:came across your (?:profile|resume|background)|found your (?:profile|resume)|would you be interested in|are you interested in|opportunity (?:that|I think) may interest you|reaching out about (?:an?|this) (?:role|opportunity))\b/i;
const EXIST_INCOMPLETE_RE = /\b(?:finish|complete|continue|resume) your application\b|\bapplication is incomplete\b/i;
const EXIST_DIRECT_RE = /\b(?:your application|your candidacy|thank(?:s| you) for applying|you applied (?:to|for)|application (?:has been |was |is )?(?:received|submitted|under review)|following (?:your|the) (?:application|interview))\b/i;
const EXIST_DIRECT_OUTCOME_RE = /\b(?:you (?:were|have been|are) not selected|we (?:will not|won't) be moving forward|mov(?:e|ing) forward with other (?:candidates|applicants)|(?:invite|invited|inviting) you (?:to|for) (?:an? |the )?interview|we(?:'d| would) like to schedule (?:an? |the )?(?:technical )?(?:interview|phone screen|technical screen)|please (?:schedule|select|book|complete) [^.]{0,60}(?:interview|phone screen|assessment|coding challenge)|(?:offer|extend) you (?:an? |the )?(?:position|role|offer)|your interview (?:is|has been|was)|after your interview)\b/i;
const EXIST_APP_ID_RE = /\b(?:application|candidate|applicant)\s*(?:id|number|reference|ref|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})\b/i;
const EXIST_REQ_ID_RE = /\b(?:requisition|req|job)\s*(?:id|number|reference|ref|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})\b/i;
const EXIST_MULTIPLE_RE = /\b(?:\d{1,3}\s+(?:new |recommended |matching )?jobs?|multiple (?:jobs?|openings?|opportunities)|top job picks)\b/i;
const EXIST_JOBISH_RE = /\b(?:job|role|position|career|recruiter|hiring|application|candidate|interview|assessment|offer)\b/i;
function existenceEvidence(text, re) { const m = re.exec(text); return m && m[0] ? m[0].replace(/\s+/g," ").trim().slice(0,180) : null; }
function existenceEmailType(event) {
  if (!event) return "UNCERTAIN";
  if (["APPLICATION_RECEIVED","APPLICATION_UNDER_REVIEW"].includes(event.eventType)) return "APPLICATION_CONFIRMATION";
  if (/^(INTERVIEW|ASSESSMENT)_/.test(event.eventType)) return "INTERVIEW_OR_ASSESSMENT";
  if (event.eventType === "REJECTION_RECEIVED") return "REJECTION";
  if (/^OFFER_/.test(event.eventType)) return "OFFER";
  if (["WITHDRAWN","POSITION_CLOSED"].includes(event.eventType)) return "WITHDRAWAL_OR_CLOSURE";
  if (event.eventType === "RECRUITER_CONTACT") return "RECRUITER_OUTREACH";
  return event.eventType === "UNKNOWN" ? "UNCERTAIN" : "APPLICATION_STATUS_UPDATE";
}
function classifyApplicationExistence(thread) {
  const subject = String(thread && thread.subject || "");
  const sorted = [...(thread && thread.messages || [])].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const combined = [subject, ...sorted.map(m=>stripQuotedText(m.body))].join(" ").replace(/\s+/g," ").trim();
  const events = sorted.map((m,i)=>classifyEmailEvent({subject:i===0?subject:"",body:m.body,from:m.from,attachments:m.attachments}));
  const meaningful = events.filter(e=>e.eventType!=="UNKNOWN");
  const latestEvent = meaningful[meaningful.length-1] || events[events.length-1] || null;
  const appId = (EXIST_APP_ID_RE.exec(combined)||[])[1] || null;
  const reqId = (EXIST_REQ_ID_RE.exec(combined)||[])[1] || null;
  const direct = existenceEvidence(combined, EXIST_DIRECT_RE);
  const directedOutcome = existenceEvidence(combined, EXIST_DIRECT_OUTCOME_RE) || existenceEvidence(combined, REJECTION_EVENT_RE);
  const recommendation = existenceEvidence(combined, EXIST_RECOMMENDATION_RE);
  const advertisement = existenceEvidence(combined, EXIST_AD_RE);
  const newsletter = existenceEvidence(combined, EXIST_NEWSLETTER_RE);
  const outreach = existenceEvidence(combined, EXIST_OUTREACH_RE);
  const incomplete = existenceEvidence(combined, EXIST_INCOMPLETE_RE);
  const multiple = existenceEvidence(combined, EXIST_MULTIPLE_RE);
  const against = [recommendation&&"Recommendation or saved-search language",advertisement&&"The message encourages the recipient to apply",newsletter&&"Newsletter, campaign, or unsubscribe language",outreach&&"Unsolicited recruiter outreach",incomplete&&"The message asks the recipient to finish an unsubmitted application",multiple&&"Multiple jobs are promoted in one message"].filter(Boolean);
  const confirmation = meaningful.find(e=>["APPLICATION_RECEIVED","APPLICATION_UNDER_REVIEW"].includes(e.eventType));
  const downstreamCandidate = meaningful.find(e=>!["APPLICATION_RECEIVED","APPLICATION_UNDER_REVIEW","RECRUITER_CONTACT","POSITION_CLOSED","ON_HOLD"].includes(e.eventType));
  const downstream = direct||directedOutcome ? downstreamCandidate : undefined;
  const resolved = resolveCompany(thread);
  const role = extractRole(subject);
  const company = resolved.company && (!isAtsDomain(thread.domain) || resolved.company !== companyFromDomain(thread.domain)) ? resolved.company : null;
  const position = role && !/^application$/i.test(role) ? role : null;
  const forEvidence = [...(confirmation&&confirmation.evidence||[]),...(downstream&&downstream.evidence||[]),...(direct?[direct]:[]),...(directedOutcome?[directedOutcome]:[]),...(appId?[`Application ID ${appId}`]:[]),...(reqId?[`Requisition ID ${reqId}`]:[])].filter((v,i,a)=>a.indexOf(v)===i);
  if (confirmation || (direct && (appId || reqId))) return {email_type:existenceEmailType(confirmation||latestEvent),application_status:"CONFIRMED_APPLICATION",confidence:.98,should_create_application:true,should_update_existing_application:meaningful.length>1,company,position_title:position,requisition_id:reqId,application_id:appId,evidence_for:forEvidence,evidence_against:against,reasoning_summary:"The thread contains explicit evidence that the user's application was submitted or received.",manual_review_required:false};
  if (downstream) return {email_type:existenceEmailType(downstream),application_status:"LIKELY_APPLICATION",confidence:.92,should_create_application:true,should_update_existing_application:true,company,position_title:position,requisition_id:reqId,application_id:appId,evidence_for:forEvidence,evidence_against:against,reasoning_summary:"A directed hiring outcome or next-stage event strongly implies an existing application.",manual_review_required:false};
  if (recommendation||advertisement||newsletter||multiple||incomplete) return {email_type:recommendation||multiple?"JOB_RECOMMENDATION":newsletter?"NEWSLETTER_OR_PROMOTION":"JOB_ADVERTISEMENT",application_status:"NOT_AN_APPLICATION",confidence:.97,should_create_application:false,should_update_existing_application:false,company:null,position_title:null,requisition_id:reqId,application_id:appId,evidence_for:[],evidence_against:against,reasoning_summary:"This message promotes jobs or asks the recipient to begin or finish applying; it does not prove submission.",manual_review_required:false};
  if (outreach || latestEvent&&latestEvent.eventType==="RECRUITER_CONTACT") return {email_type:"RECRUITER_OUTREACH",application_status:"NOT_AN_APPLICATION",confidence:.95,should_create_application:false,should_update_existing_application:false,company:null,position_title:null,requisition_id:reqId,application_id:appId,evidence_for:[],evidence_against:[...against,"No submitted-application evidence"],reasoning_summary:"This is recruiter outreach about an opportunity, not evidence that the user applied.",manual_review_required:false};
  if (direct) return {email_type:"APPLICATION_STATUS_UPDATE",application_status:"LIKELY_APPLICATION",confidence:.82,should_create_application:false,should_update_existing_application:true,company,position_title:position,requisition_id:reqId,application_id:appId,evidence_for:forEvidence,evidence_against:against,reasoning_summary:"The thread refers to an application but lacks enough independent evidence for automatic creation.",manual_review_required:true};
  const jobish = EXIST_JOBISH_RE.test(combined)||isAtsDomain(thread.domain);
  return {email_type:"UNCERTAIN",application_status:jobish?"INSUFFICIENT_EVIDENCE":"NOT_AN_APPLICATION",confidence:jobish ? .55 : .98,should_create_application:false,should_update_existing_application:false,company:null,position_title:null,requisition_id:reqId,application_id:appId,evidence_for:[],evidence_against:[jobish?"Job-related wording without submission evidence":"No application evidence"],reasoning_summary:jobish?"The message is job-related, but there is not enough evidence that the user submitted an application.":"The message is unrelated to a submitted job application.",manual_review_required:jobish};
}

// Compact, local-only features used by the desktop feedback learner. The model
// stores patterns rather than message bodies, and deliberately avoids treating a
// shared ATS domain as evidence by itself.
const LEARN_STOP = new Set("a an and application applying at candidate career for from in is job of on or position role the to update with your you".split(" "));
function applicationLearningFeatures(thread) {
  const messages = [...(thread && thread.messages || [])].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const latest = messages[messages.length - 1] || {};
  const sender = String(latest.from || "").match(/<?([^<>\s]+@[^<>\s]+)>?/)?.[1]?.toLowerCase() || "";
  const tokens = String(thread && thread.subject || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  return {
    domain:String(thread && thread.domain || "").toLowerCase(),
    sender,
    subject_tokens:[...new Set(tokens.filter(t=>!LEARN_STOP.has(t)))].slice(0,18),
    email_type:classifyApplicationExistence(thread).email_type,
  };
}
function learnedApplicationDecision(thread, examples) {
  const target = applicationLearningFeatures(thread);
  let positive = 0, negative = 0, matches = 0;
  for (const example of examples || []) {
    const f = example && example.features;
    if (!f || (example.label !== "application" && example.label !== "not_application")) continue;
    const a = new Set(target.subject_tokens), b = new Set(f.subject_tokens || []);
    const overlap = [...a].filter(t=>b.has(t)).length;
    const union = new Set([...a,...b]).size || 1;
    const similarity = overlap / union;
    let weight = 0;
    if (target.sender && target.sender === f.sender) weight += isAtsDomain(target.domain) ? 1.4 : 3.2;
    if (target.domain && target.domain === f.domain && !isAtsDomain(target.domain)) weight += 1.2;
    if (similarity >= .34) weight += similarity * 3;
    if (target.email_type === f.email_type) weight += .35;
    if (weight < 1.75) continue;
    matches++;
    if (example.label === "application") positive += weight; else negative += weight;
  }
  const total = positive + negative;
  const score = total ? (positive - negative) / total : 0;
  const decision = positive >= 2.8 && score >= .58 ? "application"
    : negative >= 2.8 && score <= -.58 ? "not_application" : null;
  return { decision, score, matches, positive_weight:positive, negative_weight:negative, features:target };
}


/* ============================================================================
   COMPANY RESOLUTION
   ----------------------------------------------------------------------------
   For normal mail the sender domain names the company. For Applicant Tracking
   Systems (Greenhouse, Lever, Workday, LinkedIn, Indeed…) the domain names the
   PLATFORM, not the employer — so every company collapses into one. We recover
   the real employer from the sender display-name, the subject, then the body.
   ========================================================================== */

const NAME_MAP = { datadoghq: "Datadog", notion: "Notion", spotify: "Spotify", figma: "Figma",
  vercel: "Vercel", airbnb: "Airbnb", amazon: "Amazon", google: "Google", stripe: "Stripe",
  roberthalf: "Robert Half", rhi: "Robert Half", teksystems: "TEKsystems", kellyservices: "Kelly Services",
  insightglobal: "Insight Global", michaelpage: "Michael Page", pagegroup: "PageGroup", manpowergroup: "ManpowerGroup",
  ms: "Morgan Stanley", morganstanley: "Morgan Stanley", americanexpress: "American Express",
  openai: "OpenAI", blackrock: "BlackRock", brownadvisory: "Brown Advisory", fanaticsinc: "Fanatics",
  mckinsey: "McKinsey", generalatlantic: "General Atlantic", td: "TD", rsm: "RSM", rsmus: "RSM",
  dhs: "DHS", jetblue: "JetBlue", lvmh: "LVMH", adp: "ADP", beamliving: "Beam Living",
  bestfriends: "Best Friends Animal Society", busancapital: "Busan Capital",
  welcometothejungle: "Welcome to the Jungle", capitalone: "Capital One", eliseai: "EliseAI",
  usastaffing: "USA Staffing", mokahr: "Moka" };

// Two-level public suffixes, so the registrable label is taken correctly for
// ccTLDs (e.g. "acme.co.uk" → "acme", not "co"; "acme.com.au" → "acme").
const MULTI_TLDS = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "co.nz", "org.nz", "co.za", "co.in", "co.kr",
  "co.jp", "or.jp", "ne.jp", "com.br", "com.mx", "com.sg", "com.hk", "com.tr", "com.cn", "com.tw",
]);
function rootName(domain) {
  const parts = String(domain || "").toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts[0] || String(domain || "");
  const lastTwo = parts.slice(-2).join(".");
  return MULTI_TLDS.has(lastTwo) ? parts[parts.length - 3] : parts[parts.length - 2];
}
function companyFromDomain(domain) {
  const root = rootName(domain);
  return NAME_MAP[root] || root.charAt(0).toUpperCase() + root.slice(1);
}

// ATS / recruiting platforms — mail from these has the real company in the
// sender name / subject / body, NOT in the sender domain.
const ATS_DOMAINS = new Set([
  "greenhouse", "greenhouse-mail", "lever", "workday", "myworkday", "myworkdaysite", "workdayjobs", "myworkdayjobs",
  "linkedin", "jobvite", "icims", "taleo", "oraclecloud", "oracle", "clearcompany", "smartrecruiters", "ashbyhq",
  "adp", "csod", "mokahr", "usastaffing",
  "breezy", "recruitee", "workable", "bamboohr", "personio",
  "jazzhr", "successfactors", "dayforce", "rippling", "teamtailor",
  "comeet", "dover", "gem", "jobscore", "freshteam", "zohorecruit",
  "indeed", "glassdoor", "ziprecruiter", "wellfound", "angellist", "hire", "applytojob", "lever-mail",
]);
function isAtsDomain(domain) {
  return ATS_DOMAINS.has(rootName(domain));
}
// Freemail + meeting platforms: never the employer — the text cascade decides.
const NON_EMPLOYER_DOMAINS = new Set([
  "gmail", "googlemail", "outlook", "hotmail", "live", "yahoo", "ymail",
  "icloud", "aol", "protonmail", "proton", "gmx", "msn", "mail",
  "zoom", "calendly",
]);
function isNonEmployerDomain(domain) {
  return NON_EMPLOYER_DOMAINS.has(rootName(domain));
}
// Platform brand words that must never be returned as a company name.
const PLATFORM_WORDS = new Set([...ATS_DOMAINS, ...NON_EMPLOYER_DOMAINS, "workday", "greenhouse", "lever", "linkedin",
  "indeed", "glassdoor", "ashby", "smartrecruiters", "icims", "taleo", "jobvite", "myworkday",
  "oracle"]); // "Oracle Recruiting" sender on oraclecloud.com mail is the platform, not the employer

function tidy(s) { return String(s || "").replace(/\s+/g, " ").replace(/[\s,;:–—\-]+$/, "").trim(); }

// Strip legal suffixes + recruiting words so the same employer always normalizes
// to the same display name (so its mail groups into one card).
function cleanCompanyName(raw) {
  let s = tidy(raw).replace(/[‘’'"]/g, "");
  // ATS tenant slugs: underscores become spaces ("deutsche_bank_workday"), and a
  // camelCase platform suffix is dropped ("CapitalOneHRWorkday" → "CapitalOne").
  s = s.replace(/_+/g, " ").trim();
  s = s.replace(/(?:HR)?(?:Workday|Greenhouse|Taleo|Icims)$/, "");
  // Strip only unambiguous legal forms (keep "Corp"/"Company"/"Co" — they're often
  // part of the brand, e.g. "Umbrella Corp", "Trader Joe's Company").
  s = s.replace(/\b(inc|incorporated|llc|l\.l\.c|ltd|limited|gmbh|plc|s\.?a\.?|pty|ag|b\.?v\.?|n\.?v\.?|s\.?r\.?l)\.?\b/ig, " ");
  s = s.replace(/\b(workday|myworkday|greenhouse|lever|taleo|icims|smartrecruiters)\b/ig, " ");
  s = s.replace(/\b(careers?|recruit(?:ing|ment)?|talent(?: acquisition)?|hiring(?: team)?|jobs?|people(?: team| ops)?|human resources|hr|team|notifications?|no[- ]?reply|do[- ]?not[- ]?reply)\b/ig, " ");
  s = s.replace(/[|•·]+/g, " ").replace(/\s{2,}/g, " ").trim();
  s = s.replace(/^[\s.,'"&|•·\-]+|[\s.,'"&|•·\-]+$/g, "");   // trim stray edge punctuation ("Acme, Inc." → "Acme")
  return s.replace(/\s{2,}/g, " ").trim();
}
function isPlatformWord(s) {
  return String(s || "").toLowerCase().split(/\s+/).some(tok => PLATFORM_WORDS.has(tok));
}
const STOP_COMPANY_RE = /^(the|a|an|us|our|you|your|we|i|me|my|this|that|here|hi|hello|team|info|support|admin|mailer|mail|system|automated|notification|recruiter|recruiting|talent|careers?|jobs?|apply|application|do not reply|donotreply)$/i;
function isStopCompany(s) { return STOP_COMPANY_RE.test(String(s || "").trim()); }

function acceptCompany(s) {
  const c = cleanCompanyName(s);
  if (!c || c.length < 2) return null;
  if (isStopCompany(c) || isPlatformWord(c)) return null;
  return c;
}

// 1) Sender display name — strongest for Greenhouse/Lever/Workday ("Acme via
//    Greenhouse", "Acme Careers", "Acme Talent Acquisition").
function companyFromSenderName(fromName) {
  let s = String(fromName || "").replace(/<[^>]*>/g, " ").trim();   // drop the <email> part
  if (!s) return null;
  if (/@/.test(s)) return null;                                     // bare address, no display name — never a company
  const m = s.match(/^(.+?)\s*[\(\[|]?\s*\bvia\s+\w+/i);            // "Acme via Greenhouse"
  if (m) s = m[1];
  return acceptCompany(s);
}

// 1b) Tenant slug in the from-address LOCAL PART — Workday-family platforms
// address mail per employer ("initech@myworkday.com"), so the local part IS the
// company identity even when the display name is just "Workday". Restricted to
// that family: broad platforms (LinkedIn, Indeed, …) use functional mailboxes
// ("jobs-noreply@") that must never be read as an employer.
const TENANT_LOCAL_ROOTS = new Set(["workday", "myworkday", "myworkdayjobs", "myworkdaysite", "workdayjobs"]);
const GENERIC_LOCAL_RE = /^(?:no-?reply|do-?not-?reply|noreply|donotreply|notifications?|notify|mailer(?:-daemon)?|postmaster|jobs?|careers?|talent|recruiting|recruitment|hr|info|hello|support|admin|apply|applications?|system|messages?|mail|team|updates?|alerts?|news(?:letter)?|invitations?|security|workday)$/i;

function companyFromAtsLocalPart(from) {
  const m = String(from || "").match(/([A-Za-z0-9][A-Za-z0-9._+-]*)@([A-Za-z0-9.-]+)/);
  if (!m) return null;
  if (!TENANT_LOCAL_ROOTS.has(rootName(m[2]))) return null;
  // Strip a trailing platform suffix and split camelCase BEFORE case folding —
  // tenant slugs ("CapitalOneHRWorkday", "deutsche_bank_workday") carry their
  // word boundaries in the casing.
  let local = m[1].replace(/\+.*$/, "").replace(/[._-]*(?:hr)?(?:workday|greenhouse|taleo|icims)$/i, "");
  if (GENERIC_LOCAL_RE.test(local.toLowerCase()) || /\d{4,}/.test(local)) return null; // mailbox role or an id, not a name
  local = local.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const words = local.toLowerCase().replace(/[._-]+/g, " ").trim();
  if (!words) return null;
  const pretty = words.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return acceptCompany(pretty);
}

// 2) Subject — handles LinkedIn ("…sent to Acme"), "…at Acme", "…to Acme",
//    "interest in Acme", etc. Only unambiguous, preposition-anchored patterns
//    (so we don't mistake the job title for the company).
const SUBJECT_PATS = [
  /\bsent to\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|]|\s+(?:for|via|was|has|on)\b|[.!]|\s*$)/,
  /\bat\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|]|\s+via\b|[.!]|\s*$)/,
  /\b(?:to|with)\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s+for\b|\s*[-–—(|]|[.!]|\s*$)/,
  /\binterest in (?:working (?:at|for) |joining )?([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|.!]|\s+(?:for|as|has|team)\b|\s*$)/,
  /\b(?:viewed|reviewed) by\s+([A-Z][A-Za-z0-9&.'\- ]+?)(?:\s*[-–—(|]|[.!]|\s*$)/,
  // LinkedIn Turkish: "Başvurunuz Acme şirketine gönderildi / iletildi"
  /başvurunuz\s+(.{1,40}?)\s+(?:şirketine|firmasına)\s+(?:gönderildi|iletildi)/i,
];
function extractCompanyFromSubject(subject) {
  const s = String(subject || "");
  for (const re of SUBJECT_PATS) {
    const m = s.match(re);
    if (m) { const c = acceptCompany(m[1]); if (c) return c; }
  }
  return null;
}

// 3) Body — last resort, for boards like Indeed that keep the employer out of
//    the subject ("You applied to Acme", "your application to Acme").
const BODY_PATS = [
  /\b(?:applying to|apply to|application (?:to|with)|your application (?:to|with)|applied (?:to|for the .*? at)|thank you for (?:your interest in|applying to)|interested in (?:joining|working at))\s+([A-Z][A-Za-z0-9&.'\- ]{1,40})/,
  /\bat\s+([A-Z][A-Za-z0-9&.'\- ]{1,40}?)\s+(?:has been|have|on indeed|team|appreciates|received your)/,
  /\b(?:viewed|reviewed) by (?:the (?:hiring )?(?:team|recruiter|manager|employer)(?: at)? )?([A-Z][A-Za-z0-9&.'\- ]{1,40})/,
  /\b(?:application|cv|resume) (?:was |has been )?(?:sent|forwarded|submitted) to\s+([A-Z][A-Za-z0-9&.'\- ]{1,40})/,
];
function companyFromBody(body) {
  const b = String(body || "");
  for (const re of BODY_PATS) {
    const m = b.match(re);
    if (m) {
      // cut trailing clause words the greedy match may have grabbed
      const raw = m[1].replace(/\b(for|as|the|role|position|team|and|we|has|have|is|to|on|was|were|will|are|been|being|would|could|should|does|did|do|you|your|our|via|regarding)\b.*$/i, "");
      const c = acceptCompany(raw);
      if (c) return c;
    }
  }
  return null;
}

// Best-effort domain guess for logos/grouping when the real domain is an ATS.
function guessCompanyDomain(company) {
  return String(company || "").toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
}

// Resolve the employer for a whole thread → { company, domain }.
function resolveCompany(th) {
  const domain = (th && th.domain) || "";
  // ATS platforms AND non-employer senders (freemail, meeting platforms) route
  // through the text cascade — their domain name is never the employer.
  if (!isAtsDomain(domain) && !isNonEmployerDomain(domain)) {
    return { company: companyFromDomain(domain), domain };
  }
  const msgs = (th && th.messages) || [];
  let company = null;
  for (const m of msgs) { company = companyFromSenderName(m.from); if (company) break; }
  if (!company) company = extractCompanyFromSubject(th.subject);
  if (!company) for (const m of msgs) { company = companyFromAtsLocalPart(m.from); if (company) break; }
  if (!company) for (const m of msgs) { company = companyFromBody(m.body); if (company) break; }
  if (company) return { company, domain: guessCompanyDomain(company) };
  // Couldn't identify the employer — fall back to the platform name (rare now).
  return { company: companyFromDomain(domain), domain };
}


/* ============================================================================
   ROLE EXTRACTION  (pull a job title out of a subject line)
   ========================================================================== */
const ROLE_PATS = [
  /application for (?:the )?(.+?) at .+/i,
  /applying (?:to|for) (?:the )?(.+?) at .+/i,
  /application[\s—–-]+(.+?) at .+/i,
  /applying[\s—–-]+(.+?) at .+/i,
  /your application (?:to|for) (?:the )?(.+?) (?:at|was|has|position|role)/i,
];
function extractRole(subject) {
  const s = String(subject || "");
  for (const re of ROLE_PATS) { const m = s.match(re); if (m && m[1]) return tidy(m[1]); }
  // "Indeed Application: Data Analyst" / "Application - Software Engineer"
  const mApp = s.match(/\bapplication(?:\s+(?:received|submitted|confirmation|update))?\s*[:\-–—]\s*(.+?)(?:\s+(?:at|with|on)\b.*)?$/i);
  if (mApp && mApp[1]) return tidy(mApp[1]);
  const m2 = s.match(/(.+?) at .+/i);
  if (m2) return tidy(m2[1]);
  // Confirmation-style subjects with no role (e.g. "Your application was sent to
  // Acme", "Thank you for your interest in Acme") — show a clean generic label
  // instead of echoing the whole sentence.
  if (/\b(application|thank you for|interest in|we (?:have )?received)\b/i.test(s)) return "Application";
  return tidy(s);
}


// ---- exports (Node) / globals (browser) ----
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STATUS_RANK, detectStatus, classifyEmailEvent, applyEventTransition, resolveApplicationStatus, stripQuotedText, classifyApplicationExistence,
    applicationLearningFeatures, learnedApplicationDecision,
    rootName, companyFromDomain, isAtsDomain, cleanCompanyName,
    companyFromSenderName, companyFromAtsLocalPart, extractCompanyFromSubject, companyFromBody,
    resolveCompany, guessCompanyDomain, extractRole, tidy,
  };
}
