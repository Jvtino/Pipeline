import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, upsertUser, saveMailConnection, getBoardForUser, getCursor, type DbHandle } from "@pipeline/db";
import { generateMasterKey } from "@pipeline/crypto";
import type { Thread } from "@pipeline/contracts";
import { runSync, type MailSource, type FetchResult } from "./index";

// A scripted source: each round returns the next FetchResult and records the
// cursor it was called with — so we can prove the engine feeds back the cursor.
class FakeSource implements MailSource {
  private i = 0;
  readonly seen: (string | undefined)[] = [];
  constructor(private readonly rounds: FetchResult[]) {}
  async fetch({ cursor }: { cursor?: string }): Promise<FetchResult> {
    this.seen.push(cursor);
    const r = this.rounds[this.i++];
    if (!r) throw new Error("no more rounds");
    return r;
  }
}

function acmeThread(...bodies: string[]): Thread {
  return {
    threadId: "t-acme",
    domain: "greenhouse.io",
    subject: "Application for Engineer at Acme",
    messages: bodies.map((body, i) => ({
      date: `2026-0${i + 1}-01`,
      from: "Acme via Greenhouse <x@greenhouse.io>",
      body,
    })),
  };
}

let h: DbHandle;
beforeEach(async () => {
  h = await createDb();
  await upsertUser(h.db, { id: "u1", email: "u1@x.com" });
  // sync_state FKs to a connection, so create one (secret is irrelevant here)
  await saveMailConnection(h.db, Buffer.from(generateMasterKey(), "base64"), {
    id: "conn1",
    userId: "u1",
    provider: "google",
    email: "u1@gmail.com",
    secret: { access_token: "x" },
  });
});
afterEach(async () => {
  await h.close();
});

describe("incremental sync engine", () => {
  it("backfills, persists the cursor, then applies a delta idempotently", async () => {
    const source = new FakeSource([
      { threads: [acmeThread("thank you for applying")], cursor: "h1" },
      { threads: [acmeThread("thank you for applying", "we'd like to schedule an interview")], cursor: "h2" },
    ]);

    // round 1 — backfill (no cursor)
    const r1 = await runSync(h.db, { userId: "u1", connectionId: "conn1", source });
    expect(r1).toMatchObject({ cursor: "h1", fetched: 1, upserted: 1 });
    expect(await getCursor(h.db, "conn1")).toBe("h1");
    let board = await getBoardForUser(h.db, "u1", "live");
    expect(board.counts.total).toBe(1);
    expect(board.counts.applied).toBe(1);

    // round 2 — delta (engine feeds back cursor h1); same thread, advanced status
    const r2 = await runSync(h.db, { userId: "u1", connectionId: "conn1", source });
    expect(r2.cursor).toBe("h2");
    expect(await getCursor(h.db, "conn1")).toBe("h2");
    board = await getBoardForUser(h.db, "u1", "live");
    expect(board.counts.total).toBe(1); // idempotent on (user, thread) — not duplicated
    expect(board.counts.interview).toBe(1); // status advanced applied → interview

    expect(source.seen).toEqual([undefined, "h1"]); // first backfill, then delta from the saved cursor
  });

  it("an empty delta still advances the cursor and changes nothing", async () => {
    const source = new FakeSource([
      { threads: [acmeThread("thank you for applying")], cursor: "h1" },
      { threads: [], cursor: "h2" },
    ]);
    await runSync(h.db, { userId: "u1", connectionId: "conn1", source });
    const r2 = await runSync(h.db, { userId: "u1", connectionId: "conn1", source });
    expect(r2).toMatchObject({ cursor: "h2", fetched: 0, upserted: 0 });
    expect(await getCursor(h.db, "conn1")).toBe("h2");
    expect((await getBoardForUser(h.db, "u1", "live")).counts.total).toBe(1);
  });
});
