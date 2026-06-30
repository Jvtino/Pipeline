// End-to-end proof that local mode survives a "restart": a second server built
// against the same PIPELINE_HOME keeps the same session secret (the cookie still
// verifies) AND the same on-disk DB (the seeded board is still there). Without
// the persistence fix, both the cookie and the board would be gone — which is
// what forced a reconnect on every launch.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server";

async function login(app: FastifyInstance, email = "demo@pipeline.local"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/auth/dev/login", payload: { email } });
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  return raw.split(";")[0]!;
}

describe("local mode persists across restarts", () => {
  let home: string;
  const saved: Record<string, string | undefined> = {};
  const clear = (k: string) => {
    saved[k] = process.env[k];
    delete process.env[k];
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "pipeline-home-"));
    // Force the local fallbacks (no managed secrets / DB), pointed at a temp home.
    clear("DATABASE_URL");
    clear("PGLITE_DIR");
    clear("PIPELINE_MASTER_KEY");
    clear("SESSION_SECRET");
    saved.PIPELINE_HOME = process.env.PIPELINE_HOME;
    process.env.PIPELINE_HOME = home;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  });

  it("keeps the session + board after a simulated relaunch", async () => {
    // First launch: sign in, board is seeded.
    const a = await buildServer({ local: true });
    let cookie: string;
    try {
      cookie = await login(a);
      const res = await a.inject({ method: "GET", url: "/api/applications", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json().counts.total).toBe(9);
    } finally {
      await a.close();
    }

    // Second launch (same PIPELINE_HOME): the OLD cookie still works and the
    // board is still there — nothing had to be set up again.
    const b = await buildServer({ local: true });
    try {
      const res = await b.inject({ method: "GET", url: "/api/applications", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json().counts.total).toBe(9);
    } finally {
      await b.close();
    }
  });
});
