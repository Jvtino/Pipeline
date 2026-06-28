// Pro-tier routes (all server-side entitlement-gated): analytics, follow-up
// reminders, CSV export, and notes/contacts per application.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  getApplicationsForUser,
  getBoardForUser,
  applicationBelongsTo,
  addNote,
  listNotes,
  addContact,
  listContacts,
  type Database,
} from "@pipeline/db";
import { requireProUser, type GateDeps } from "./gate";
import { computeNudges } from "./reminders";
import { toCsv } from "./export";

export type ProRouteDeps = GateDeps & { db: Database };

export function registerProRoutes(app: FastifyInstance, deps: ProRouteDeps): void {
  const gate = (req: FastifyRequest, reply: FastifyReply) => requireProUser(req, reply, deps);
  const appIdFor = (userId: string, threadId: string) => `${userId}:${threadId}`;

  app.get("/api/analytics", async (req, reply) => {
    const user = await gate(req, reply);
    if (!user) return reply;
    const { counts } = await getBoardForUser(deps.db, user.id, "demo");
    return {
      plan: user.plan,
      funnel: counts,
      interviewRate: counts.total ? counts.interview / counts.total : 0,
      offerRate: counts.total ? counts.offer / counts.total : 0,
    };
  });

  app.get("/api/reminders", async (req, reply) => {
    const user = await gate(req, reply);
    if (!user) return reply;
    const apps = await getApplicationsForUser(deps.db, user.id);
    return { nudges: computeNudges(apps, Date.now()) };
  });

  app.get("/api/export.csv", async (req, reply) => {
    const user = await gate(req, reply);
    if (!user) return reply;
    const apps = await getApplicationsForUser(deps.db, user.id);
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="pipeline.csv"');
    return toCsv(apps);
  });

  // ── Notes ──────────────────────────────────────────────────────────────────
  app.get("/api/applications/:threadId/notes", async (req, reply) => {
    const user = await gate(req, reply);
    if (!user) return reply;
    const appId = appIdFor(user.id, (req.params as { threadId: string }).threadId);
    if (!(await applicationBelongsTo(deps.db, user.id, appId))) return reply.code(404).send({ error: "application not found" });
    return { notes: await listNotes(deps.db, user.id, appId) };
  });

  app.post("/api/applications/:threadId/notes", async (req, reply) => {
    const user = await gate(req, reply);
    if (!user) return reply;
    const appId = appIdFor(user.id, (req.params as { threadId: string }).threadId);
    if (!(await applicationBelongsTo(deps.db, user.id, appId))) return reply.code(404).send({ error: "application not found" });
    const body = ((req.body as { body?: string } | undefined)?.body ?? "").trim();
    if (!body) return reply.code(400).send({ error: "note body required" });
    return { note: await addNote(deps.db, { userId: user.id, applicationId: appId, body }) };
  });

  // ── Contacts ────────────────────────────────────────────────────────────────
  app.get("/api/applications/:threadId/contacts", async (req, reply) => {
    const user = await gate(req, reply);
    if (!user) return reply;
    const appId = appIdFor(user.id, (req.params as { threadId: string }).threadId);
    if (!(await applicationBelongsTo(deps.db, user.id, appId))) return reply.code(404).send({ error: "application not found" });
    return { contacts: await listContacts(deps.db, user.id, appId) };
  });

  app.post("/api/applications/:threadId/contacts", async (req, reply) => {
    const user = await gate(req, reply);
    if (!user) return reply;
    const appId = appIdFor(user.id, (req.params as { threadId: string }).threadId);
    if (!(await applicationBelongsTo(deps.db, user.id, appId))) return reply.code(404).send({ error: "application not found" });
    const b = (req.body as { name?: string; email?: string; role?: string } | undefined) ?? {};
    const name = (b.name ?? "").trim();
    if (!name) return reply.code(400).send({ error: "contact name required" });
    return { contact: await addContact(deps.db, { userId: user.id, applicationId: appId, name, email: b.email ?? null, role: b.role ?? null }) };
  });
}
