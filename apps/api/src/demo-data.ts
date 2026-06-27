// Demo threads in the unified contract shape — so the hosted slice runs end to
// end (contract -> classify -> derived records -> API -> web) with NO mailbox,
// no OAuth, no DB. Real Gmail/Graph ingestion + incremental sync land in a later
// step (plan §8). Mirrors the fictional demo data the existing app ships with.
import type { Thread } from "@pipeline/contracts";

export const DEMO_THREADS: Thread[] = [
  {
    threadId: "demo:stripe",
    domain: "stripe.com",
    subject: "Your application for Senior Backend Engineer at Stripe",
    messages: [
      { date: "2026-05-02", from: "Stripe <jobs@stripe.com>", body: "Thank you for applying to the Senior Backend Engineer role. We've received your application." },
      { date: "2026-05-14", from: "Stripe Recruiting <recruiting@stripe.com>", body: "We'd like to schedule a phone screen — please share your availability this week." },
      { date: "2026-06-01", from: "Stripe Recruiting <recruiting@stripe.com>", body: "We are pleased to offer you the position. Your offer letter is attached — welcome to the team!" },
    ],
  },
  {
    threadId: "demo:acme",
    domain: "greenhouse.io",
    subject: "Application for Product Designer at Acme Robotics",
    messages: [
      { date: "2026-05-20", from: "Acme Robotics via Greenhouse <no-reply@greenhouse.io>", body: "Thanks for applying to Acme Robotics. Your application is under review." },
      { date: "2026-06-08", from: "Acme Robotics via Greenhouse <no-reply@greenhouse.io>", body: "Good news — we'd love to invite you for a first interview next week. Please book a time via Calendly." },
    ],
  },
  {
    threadId: "demo:globex",
    domain: "hire.lever.co",
    subject: "Application confirmation — Data Analyst",
    messages: [
      { date: "2026-06-18", from: "Globex Careers <postings@hire.lever.co>", body: "We have received your application for the Data Analyst position and will be in touch." },
    ],
  },
  {
    threadId: "demo:initech",
    domain: "myworkday.com",
    subject: "Thank you for your interest in Initech",
    messages: [
      { date: "2026-04-10", from: "Workday Recruiting <noreply@myworkday.com>", body: "Thank you for applying to Initech. Your application has been received." },
      { date: "2026-05-05", from: "Workday Recruiting <noreply@myworkday.com>", body: "Unfortunately, after careful consideration we've decided to move forward with other candidates." },
    ],
  },
  {
    threadId: "demo:umbrella",
    domain: "linkedin.com",
    subject: "Your application was sent to Umbrella Corp",
    messages: [
      { date: "2026-06-21", from: "LinkedIn <jobs-noreply@linkedin.com>", body: "Your application was sent to Umbrella Corp for the Platform Engineer role." },
    ],
  },
  {
    threadId: "demo:hooli",
    domain: "indeed.com",
    subject: "Indeed Application: Machine Learning Engineer",
    messages: [
      { date: "2026-06-09", from: "Indeed Apply <donotreply@indeed.com>", body: "You applied to Hooli has been submitted via Indeed for the Machine Learning Engineer role." },
      { date: "2026-06-22", from: "Hooli Talent <talent@hooli.com>", body: "We'd like to set up a technical interview — what is your availability next week?" },
    ],
  },
  {
    threadId: "demo:notion",
    domain: "mail.notion.so",
    subject: "Your application to Notion",
    messages: [
      { date: "2026-03-30", from: "Notion <careers@mail.notion.so>", body: "Thank you for applying. Unfortunately the role has been filled. We wish you the best." },
    ],
  },
  {
    threadId: "demo:figma",
    domain: "figma.com",
    subject: "Application for Frontend Engineer at Figma",
    messages: [
      { date: "2026-06-24", from: "Figma <jobs@figma.com>", body: "We appreciate your interest and will review your application shortly." },
    ],
  },
  {
    threadId: "demo:vercel",
    domain: "greenhouse.io",
    subject: "Application for Developer Advocate at Vercel",
    messages: [
      { date: "2026-05-28", from: "Vercel via Greenhouse <no-reply@greenhouse.io>", body: "Thanks for applying to Vercel." },
      { date: "2026-06-19", from: "Vercel via Greenhouse <no-reply@greenhouse.io>", body: "Congratulations! We'd like to extend an offer of employment. Your start date is flexible." },
    ],
  },
];
