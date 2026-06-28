import { describe, it, expect } from "vitest";
import { boardSchema } from "@pipeline/contracts";
import { buildServer } from "./server";

describe("api server (DB-backed)", () => {
  it("GET /api/applications returns a persisted, contract-valid board", async () => {
    const app = await buildServer();
    try {
      const res = await app.inject({ method: "GET", url: "/api/applications" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(() => boardSchema.parse(body)).not.toThrow();
      expect(body.counts.total).toBe(9); // seeded demo threads
      expect(body.groups.length).toBeGreaterThan(0);
      // employer resolved from behind the ATS, persisted and read back
      expect(body.groups.some((g: { company: string }) => g.company === "Acme Robotics")).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("GET /api/health is ok", async () => {
    const app = await buildServer();
    try {
      const res = await app.inject({ method: "GET", url: "/api/health" });
      expect(res.json()).toEqual({ ok: true, service: "pipeline-api" });
    } finally {
      await app.close();
    }
  });
});
