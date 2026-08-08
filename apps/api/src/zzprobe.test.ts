// SCRATCH PROBE — delete after review.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createDb,
  upsertUser,
  upsertApplications,
  upsertDevice,
  type DbHandle,
} from "@pipeline/db";
import type { Application } from "@pipeline/contracts";
import { notifyInterviewReminders, notifyTransitions, type NotifyDeps } from "./notifications";
import type { PushGateway, SendOutcome, PushMessage } from "./push";

const TOK = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";

describe("PROBE A: the REAL expoPushGateway against an unreachable Expo", () => {
  it("does NOT throw — it resolves with ok:false outcomes", async () => {
    process.env.EXPO_BASE_URL = "http://127.0.0.1:9"; // discard port, connection refused
    const { expoPushGateway } = await import("./push");
    const gw = expoPushGateway();
    let threw: unknown = null;
    let outcomes: SendOutcome[] = [];
    try {
      outcomes = await gw.send([{ to: TOK, title: "t", body: "b", data: {} }]);
    } catch (e) {
      threw = e;
    }
    console.log("PROBE A threw:", threw === null ? "NO" : String(threw));
    console.log("PROBE A outcomes:", JSON.stringify(outcomes));
    expect(threw).toBeNull();
    expect(outcomes).toEqual([{ token: TOK, ok: false, deviceNotRegistered: false }]);
    delete process.env.EXPO_BASE_URL;
  }, 60000);
});

describe("PROBE B: policy layer fed the REAL gateway's outage shape", () => {
  let h: DbHandle;
  let sent: PushMessage[];
  // Mimics expoPushGateway exactly: transport failure => resolve, ok:false.
  const outageGateway = (failures: number): PushGateway => {
    let left = failures;
    return {
      async send(messages) {
        if (left > 0) {
          left -= 1;
          return messages.map<SendOutcome>((m) => ({ token: m.to, ok: false, deviceNotRegistered: false }));
        }
        sent.push(...messages);
        return messages.map<SendOutcome>((m) => ({ token: m.to, ok: true, deviceNotRegistered: false }));
      },
      async pollReceipts() {
        return [];
      },
    };
  };

  beforeEach(async () => {
    h = await createDb();
    sent = [];
    await upsertUser(h.db, { id: "u1", email: "u1@x.com" });
    await upsertDevice(h.db, { userId: "u1", platform: "ios", expoPushToken: "tok-ios" });
  });
  afterEach(async () => await h.close());

  it("interview reminder is LOST FOREVER after a transient outage", async () => {
    const appRow: Application = {
      id: "t-int",
      threadId: "t-int",
      company: "Acme",
      companyDomain: "acme.com",
      role: "Engineer",
      status: "interview",
      firstSeen: "2026-01-01",
      lastActivity: "2026-02-01",
      snippet: "",
      manual: false,
      enrichment: { interviewDateTime: "2026-08-10T14:30:00Z" },
    };
    await upsertApplications(h.db, "u1", [appRow]);
    const gw = outageGateway(1);
    const deps = (now: string): NotifyDeps => ({ db: h.db, gateway: gw, now: () => new Date(now), log: (m) => console.log("LOG:", m) });

    await notifyInterviewReminders(deps("2026-08-09T20:00:00Z")); // outage tick
    console.log("PROBE B after outage tick, sent =", sent.length);
    await notifyInterviewReminders(deps("2026-08-09T20:05:00Z")); // gateway back
    console.log("PROBE B after recovery tick, sent =", sent.length);
    await notifyInterviewReminders(deps("2026-08-09T20:30:00Z"));
    console.log("PROBE B after third tick, sent =", sent.length);
    expect(sent.length).toBe(0); // <-- if this passes, the notification is permanently lost
  });

  it("transition ping is LOST FOREVER after a transient outage", async () => {
    const gw = outageGateway(1);
    const deps: NotifyDeps = { db: h.db, gateway: gw, log: (m) => console.log("LOG:", m) };
    const t = { threadId: "t1", company: "Acme", role: "Eng", from: "applied", to: "interview", isNew: false, overridden: false } as never;
    await notifyTransitions(deps, "u1", [t]);
    await notifyTransitions(deps, "u1", [t]);
    await notifyTransitions(deps, "u1", [t]);
    console.log("PROBE B transitions sent =", sent.length);
    expect(sent.length).toBe(0);
  });
});

describe("PROBE C: partial chunk (chunk1 ok, chunk2 network-fails) via the real gateway", () => {
  it("send() resolves, so no throw => no release => no double-send", async () => {
    // 150 messages => 2 chunks. Point at a server that answers chunk1 then dies.
    const http = await import("node:http");
    let call = 0;
    const server = http.createServer((req, res) => {
      call += 1;
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (call === 1) {
          const n = 100;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ status: "ok", id: `tid-${i}` })) }));
        } else {
          req.socket.destroy(); // mid-request transport death
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    process.env.EXPO_BASE_URL = `http://127.0.0.1:${port}`;
    // fresh module registry so ExpoClientValues re-reads the env
    const { expoPushGateway } = await import("./push?probe=c" as string).catch(() => import("./push"));
    const gw = expoPushGateway();
    const msgs = Array.from({ length: 150 }, (_, i) => ({
      to: `ExponentPushToken[${String(i).padStart(22, "y")}]`,
      title: "t",
      body: "b",
      data: {},
    }));
    let threw: unknown = null;
    let outcomes: SendOutcome[] = [];
    try {
      outcomes = await gw.send(msgs);
    } catch (e) {
      threw = e;
    }
    console.log("PROBE C threw:", threw === null ? "NO" : String(threw));
    console.log("PROBE C ok count:", outcomes.filter((o) => o.ok).length, "notOk:", outcomes.filter((o) => !o.ok).length);
    server.close();
    delete process.env.EXPO_BASE_URL;
    expect(threw).toBeNull();
  }, 60000);
});
