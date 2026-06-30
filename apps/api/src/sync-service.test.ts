import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, upsertUser, saveMailConnection, getCursor, getBoardForUser, upsertApplications, type DbHandle } from "@pipeline/db";
import { generateMasterKey } from "@pipeline/crypto";
import type { Thread } from "@pipeline/contracts";
import type { MailSource } from "@pipeline/sync";
import { syncAllConnections, syncAllUsers, type SourceFactory } from "./sync-service";

const mk = Buffer.from(generateMasterKey(), "base64");

function acmeThread(...bodies: string[]): Thread {
  return {
    threadId: "t-acme",
    domain: "greenhouse.io",
    subject: "Application for Engineer at Acme",
    messages: bodies.map((body, i) => ({ date: `2026-0${i + 1}-01`, from: "Acme via Greenhouse <x@greenhouse.io>", body })),
  };
}

let h: DbHandle;
beforeEach(async () => {
  h = await createDb();
  await upsertUser(h.db, { id: "u1", email: "u1@x.com" });
});
afterEach(async () => {
  await h.close();
});

describe("syncAllConnections", () => {
  it("clears the seeded demo board once a real mailbox is connected", async () => {
    // onboarding seeds demo apps (threadId prefixed "demo:")
    await upsertApplications(h.db, "u1", [
      { id: "demo:x", threadId: "demo:x", company: "Demo Co", companyDomain: "demo.co", role: "Engineer", status: "applied", firstSeen: "2026-01-01", lastActivity: "2026-01-01", snippet: "demo" },
    ]);
    await saveMailConnection(h.db, mk, {
      id: "conn1",
      userId: "u1",
      provider: "google",
      email: "u1@gmail.com",
      secret: { access_token: "AT", expires_in: 3600, obtained_at: Date.now() },
    });
    const makeSource: SourceFactory = () => ({
      async fetch() {
        return { threads: [acmeThread("thank you for applying")], cursor: "h1" };
      },
    });
    await syncAllConnections({ db: h.db, masterKey: mk, userId: "u1", configs: { google: { clientId: "c", clientSecret: "s" } }, makeSource });
    const board = await getBoardForUser(h.db, "u1", "live");
    expect(board.groups.some((g) => g.company === "Demo Co")).toBe(false); // demo gone
    expect(board.counts.total).toBe(1); // replaced by the real synced application
  });

  it("syncs a connected mailbox with a valid token and persists results", async () => {
    // a fresh (non-expired) token, so no network/refresh is needed
    await saveMailConnection(h.db, mk, {
      id: "conn1",
      userId: "u1",
      provider: "google",
      email: "u1@gmail.com",
      secret: { access_token: "AT", refresh_token: "RT", expires_in: 3600, obtained_at: Date.now() },
    });

    const made: { provider: string; token: string }[] = [];
    const makeSource: SourceFactory = (provider, token) => {
      made.push({ provider, token });
      const src: MailSource = { async fetch() { return { threads: [acmeThread("thank you for applying")], cursor: "h1" }; } };
      return src;
    };

    const summary = await syncAllConnections({
      db: h.db,
      masterKey: mk,
      userId: "u1",
      configs: { google: { clientId: "cid", clientSecret: "sec" } },
      makeSource,
    });

    expect(summary.connections).toBe(1);
    expect(summary.results[0]!.result?.upserted).toBe(1);
    expect(made[0]!.token).toBe("AT"); // the valid access token was handed to the source
    expect(await getCursor(h.db, "conn1")).toBe("h1");
    expect((await getBoardForUser(h.db, "u1", "live")).counts.total).toBe(1);
  });

  it("reports a clear error for a connected provider that isn't configured", async () => {
    await saveMailConnection(h.db, mk, {
      id: "conn1",
      userId: "u1",
      provider: "google",
      email: "u1@gmail.com",
      secret: { access_token: "AT", expires_in: 3600, obtained_at: Date.now() },
    });
    const summary = await syncAllConnections({ db: h.db, masterKey: mk, userId: "u1", configs: {} });
    expect(summary.results[0]!.error).toMatch(/not configured/);
  });
});

describe("syncAllUsers (scheduler fan-out)", () => {
  it("syncs every user that has a connected mailbox", async () => {
    await upsertUser(h.db, { id: "u2", email: "u2@x.com" });
    for (const u of ["u1", "u2"]) {
      await saveMailConnection(h.db, mk, {
        id: `${u}:c`,
        userId: u,
        provider: "google",
        email: `${u}@gmail.com`,
        secret: { access_token: "AT", expires_in: 3600, obtained_at: Date.now() },
      });
    }
    const makeSource: SourceFactory = () => ({ async fetch() { return { threads: [acmeThread("thank you for applying")], cursor: "h1" }; } });
    const r = await syncAllUsers({ db: h.db, masterKey: mk, configs: { google: { clientId: "c", clientSecret: "s" } }, makeSource });
    expect(r.users).toBe(2);
    expect((await getBoardForUser(h.db, "u1", "live")).counts.total).toBe(1);
    expect((await getBoardForUser(h.db, "u2", "live")).counts.total).toBe(1);
  });
});
