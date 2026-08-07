// Demo mode's in-memory "server": the same classify → derive → serve pipeline
// the real backend runs, executed locally over the demo inbox. Implements
// exactly the endpoints the app calls, with the server's semantics (sticky
// overrides, review resolution, no-op-safe timelines). Nothing here runs in a
// real build — client.ts routes to it only when EXPO_PUBLIC_DEMO is set.
import { threadsToApplications } from "@pipeline/classify";
import { boardFromApplications, type Application, type Status } from "@pipeline/contracts";
import { DEMO_THREADS } from "./data";

interface EventRow {
  status: Status;
  occurredAt: string;
  source: string;
}

interface DemoState {
  apps: Map<string, Application & { overrideStatus?: Status; reviewedAt?: string }>;
  events: Map<string, EventRow[]>;
}

let state: DemoState | null = null;

function seed(): DemoState {
  const apps = new Map<string, Application & { overrideStatus?: Status; reviewedAt?: string }>();
  const events = new Map<string, EventRow[]>();
  for (const a of threadsToApplications(DEMO_THREADS)) {
    apps.set(a.threadId, { ...a });
    events.set(a.threadId, [{ status: a.status, occurredAt: a.firstSeen, source: "sync" }]);
  }

  // Guarantee the demo shows every feature regardless of classifier nuances:
  // one upcoming interview (calendar) and one hesitant classification (review).
  const acme = apps.get("demo:acme");
  if (acme) {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    acme.enrichment = {
      ...acme.enrichment,
      interviewDateTime: `${soon.toISOString().slice(0, 10)}T14:30:00Z`,
      location: "Berlin · hybrid",
      recruiterName: "Maya Lindqvist",
      recruiterTitle: "Talent Partner",
      recruiterEmail: "maya@acmerobotics.example",
    };
  }
  const stripe = apps.get("demo:stripe");
  if (stripe) {
    stripe.enrichment = { ...stripe.enrichment, compensation: "€95k–110k + equity", location: "Remote (EU)" };
  }
  const umbrella = apps.get("demo:umbrella");
  if (umbrella) {
    umbrella.confidence = 0.42;
    umbrella.classification = {
      eventType: "applied",
      confidence: 0.42,
      evidence: ["your application was sent"],
      negativeEvidence: [],
      requiresManualReview: true,
      reason: "job-board relay with no employer reply yet",
    };
  }
  return { apps, events };
}

const db = (): DemoState => (state ??= seed());

export function resetDemo(): void {
  state = null;
}

const coalesced = (a: Application & { overrideStatus?: Status }): Application => ({
  ...a,
  status: a.overrideStatus ?? a.status,
});

const today = (): string => new Date().toISOString();

function json(body: unknown, status = 200): { status: number; body: unknown } {
  return { status, body };
}

/** The demo request router — same paths, same envelopes as apps/api. */
export function demoHandle(path: string, init?: { method?: string; body?: string }): { status: number; body: unknown } {
  const method = (init?.method ?? "GET").toUpperCase();
  const payload = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  const s = db();
  const url = path.split("?")[0]!;

  if (url === "/api/meta") {
    return json({ ok: true, minMobileVersion: "0.0.0", features: { gmailConnect: false, microsoftConnect: false } });
  }
  if (url === "/auth/me") {
    return json({ user: { id: "demo", email: "demo@pipeline.local", plan: "free" } });
  }
  if (url === "/api/applications" && method === "GET") {
    return json(boardFromApplications([...s.apps.values()].map(coalesced), "demo"));
  }
  if (url === "/api/applications" && method === "POST") {
    const company = String(payload.company ?? "").trim();
    const role = String(payload.role ?? "").trim();
    const status = (payload.status as Status | undefined) ?? "applied";
    if (!company || !role) return json({ error: "company and role are required" }, 400);
    const threadId = `manual:${Math.random().toString(36).slice(2, 10)}`;
    const date = today().slice(0, 10);
    const app: Application = {
      id: threadId,
      threadId,
      company,
      companyDomain: "",
      role,
      status,
      firstSeen: date,
      lastActivity: date,
      snippet: "",
      manual: true,
    };
    s.apps.set(threadId, { ...app });
    s.events.set(threadId, [{ status, occurredAt: today(), source: "user" }]);
    return json({ application: app }, 201);
  }

  const patchApp = /^\/api\/applications\/([^/]+)$/.exec(url);
  if (patchApp && method === "PATCH") {
    const threadId = decodeURIComponent(patchApp[1]!);
    const app = s.apps.get(threadId);
    const status = payload.status as Status | undefined;
    if (!app || !status) return json({ error: "application not found" }, app ? 400 : 404);
    const before = coalesced(app).status;
    app.overrideStatus = status;
    app.reviewedAt = today();
    if (before !== status) s.events.get(threadId)!.push({ status, occurredAt: today(), source: "user" });
    return json({ application: coalesced(app) });
  }

  const sub = /^\/api\/applications\/([^/]+)\/(messages|events)$/.exec(url);
  if (sub && method === "GET") {
    const threadId = decodeURIComponent(sub[1]!);
    if (sub[2] === "events") return json({ events: s.events.get(threadId) ?? [] });
    const thread = DEMO_THREADS.find((t) => t.threadId === threadId);
    return json({
      messages: (thread?.messages ?? []).map((m) => ({
        date: m.date,
        from: m.from,
        bodyPreview: m.body.slice(0, 600),
        attachments: m.attachments ?? [],
        webLink: null,
      })),
    });
  }

  if (url === "/api/review" && method === "GET") {
    const items = [...s.apps.values()]
      .filter((a) => !a.manual && !a.reviewedAt && (a.classification?.requiresManualReview || (a.confidence ?? 1) < 0.5))
      .map(coalesced);
    return json({ applications: items });
  }
  const review = /^\/api\/review\/([^/]+)$/.exec(url);
  if (review && method === "POST") {
    const threadId = decodeURIComponent(review[1]!);
    const app = s.apps.get(threadId);
    if (!app) return json({ error: "application not found" }, 404);
    if (payload.action === "set") {
      const status = payload.status as Status | undefined;
      if (!status) return json({ error: "a valid status is required with action 'set'" }, 400);
      const before = coalesced(app).status;
      app.overrideStatus = status;
      if (before !== status) s.events.get(threadId)!.push({ status, occurredAt: today(), source: "user" });
    }
    app.reviewedAt = today();
    return json({ ok: true, application: coalesced(app) });
  }

  if (url === "/api/connections") {
    return json({ count: 1, mailboxes: [{ id: "demo:mailbox", provider: "demo", email: "demo@pipeline.local" }] });
  }
  if (url === "/api/account" && method === "DELETE") {
    resetDemo();
    return json({ ok: true });
  }
  if (url === "/api/devices" && method === "GET") return json({ devices: [] });

  return json({ error: `demo mode has no ${method} ${url}` }, 404);
}
