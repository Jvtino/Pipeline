import { describe, it, expect } from "vitest";
import { looksLikeJobApplication } from "./index";
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
});
