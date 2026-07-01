// Thin client for the Pipeline API. Same-origin paths (the Vite dev server
// proxies /api and /auth to the Fastify API on :3001). The redesign keeps the
// server contract untouched — it reads the board, triggers sync, and starts
// OAuth connect; everything else the UI needs is derived client-side.
import type { Board } from "@pipeline/contracts";
import type { Plan } from "./types";

export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}

/** Ensure a session exists (dev-login the stand-in user if not signed in). */
export async function ensureSession(): Promise<void> {
  const me = await fetch("/auth/me");
  if (me.status === 401) {
    await fetch("/auth/dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "demo@pipeline.local" }),
    });
  }
}

export async function getMe(): Promise<Plan> {
  const res = await getJson<{ user: Plan }>("/auth/me");
  return res.user;
}

export function getBoard(): Promise<Board> {
  return getJson<Board>("/api/applications");
}

/** Trigger an incremental sync of connected mailboxes. */
export function runSync(): Promise<{ connections: number }> {
  return postJson<{ connections: number }>("/api/sync");
}

export interface Connections {
  count: number;
  mailboxes: { provider: string; email: string }[];
}

/** How many mailboxes are connected (metadata only) — for the header chip. */
export function getConnections(): Promise<Connections> {
  return getJson<Connections>("/api/connections");
}
