import { describe, it, expect } from "vitest";
import { looksLikeJobApplication, isAtsDomain, ATS_SENDER_DOMAINS } from "./index";
import type { Thread } from "./index";

const thread = (domain: string, subject: string, ...bodies: string[]): Thread => ({
  threadId: "t",
  domain,
  subject,
  messages: bodies.map((body, i) => ({ date: `2026-0${i + 1}-01`, from: `x@${domain}`, body })),
});

describe("@pipeline/classify — looksLikeJobApplication", () => {
  it("keeps genuine application mail", () => {
    expect(looksLikeJobApplication(thread("stripe.com", "Your application for Backend Engineer at Stripe", "Thank you for applying."))).toBe(true);
    expect(looksLikeJobApplication(thread("figma.com", "We received your application", "We appreciate your interest and will review your application shortly."))).toBe(true);
  });

  it("keeps ATS senders even without obvious keywords in the body", () => {
    expect(looksLikeJobApplication(thread("greenhouse.io", "Update on your candidacy", "A short note from the team."))).toBe(true);
    expect(looksLikeJobApplication(thread("myworkday.com", "Initech", "An update."))).toBe(true);
  });

  it("keeps interview, offer and rejection threads", () => {
    expect(looksLikeJobApplication(thread("hooli.com", "Next steps", "We'd like to schedule a technical interview — what is your availability?"))).toBe(true);
    expect(looksLikeJobApplication(thread("acme.com", "Good news", "We are pleased to offer you the position. Your offer letter is attached."))).toBe(true);
    expect(looksLikeJobApplication(thread("initech.com", "An update", "Unfortunately, after careful consideration we've decided to move forward with other candidates."))).toBe(true);
  });

  it("drops ordinary non-job mail (newsletters, receipts, personal)", () => {
    expect(looksLikeJobApplication(thread("news.substack.com", "This week in tech", "Here are the top 10 stories you missed."))).toBe(false);
    expect(looksLikeJobApplication(thread("amazon.com", "Your order has shipped", "Your package will arrive Tuesday. Track your order here."))).toBe(false);
    expect(looksLikeJobApplication(thread("gmail.com", "Dinner Saturday?", "Hey, are we still on for dinner this weekend?"))).toBe(false);
    expect(looksLikeJobApplication(thread("promos.store.com", "50% off everything — limited time offer", "Shop our biggest sale of the year."))).toBe(false);
  });

  // Regression: ordinary mail that merely CONTAINS an ambient status word
  // ("declined", "welcome aboard", "congratulations", "received", "availability",
  // "unfortunately") used to flood a whole-inbox (Outlook/Graph) sync, because the
  // status classifier was trusted on its own. It must not, unless the mail also
  // names the hiring context.
  it("drops non-job mail that only contains ambient status words (flood regression)", () => {
    expect(looksLikeJobApplication(thread("paypal.com", "Your payment was declined", "Unfortunately your payment could not be processed."))).toBe(false);
    expect(looksLikeJobApplication(thread("slack.com", "Welcome to the team on Acme's Slack", "Welcome aboard! Here are your next steps to get started."))).toBe(false);
    expect(looksLikeJobApplication(thread("grammarly.com", "Congratulations! You wrote 12,000 words", "You're on a roll this week."))).toBe(false);
    expect(looksLikeJobApplication(thread("apple.com", "Your receipt from Apple", "Thank you for your purchase. Your subscription has been received."))).toBe(false);
    expect(looksLikeJobApplication(thread("zoom.us", "Meeting invitation: Team standup", "You are invited to schedule a call. Please confirm your availability."))).toBe(false);
    expect(looksLikeJobApplication(thread("ticketmaster.com", "Your event has been rescheduled", "Unfortunately, after review the venue changed the date. We wish you the best."))).toBe(false);
  });

  // The sync sources build their provider prefilter queries from ATS_SENDER_DOMAINS.
  // Every listed sender must be one the gate keeps (via isAtsDomain), or the two
  // lists have drifted and the prefilter excludes mail the gate would keep.
  it("ATS_SENDER_DOMAINS stays aligned with the ATS domains the gate keeps", () => {
    for (const domain of ATS_SENDER_DOMAINS) {
      expect(isAtsDomain(domain), `${domain} is not an ATS domain the gate recognises`).toBe(true);
    }
  });

  // Job boards (LinkedIn, Indeed, …) email heavy NON-application content — profile
  // views, saved-search digests — so their domain alone can't imply an application;
  // a real application through them must still qualify on its content.
  it("separates job-board applications from job-board social noise", () => {
    expect(looksLikeJobApplication(thread("linkedin.com", "You appeared in 9 searches this week", "See who's viewing your profile. Congratulations on your growing network!"))).toBe(false);
    expect(looksLikeJobApplication(thread("indeed.com", "12 new jobs for Software Engineer", "New jobs matching your saved search are available."))).toBe(false);
    expect(looksLikeJobApplication(thread("linkedin.com", "Your application was sent to Acme Corp", "Your application was sent to Acme Corp for the Software Engineer role."))).toBe(true);
    expect(looksLikeJobApplication(thread("indeed.com", "Application submitted", "You applied to Senior Data Engineer at Globex on Indeed."))).toBe(true);
  });
});
