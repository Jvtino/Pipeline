import { describe, it, expect } from "vitest";
import { memoryPendingStore, type PendingEntry } from "./pending-store";

const entry: PendingEntry = { provider: "google", verifier: "verifier", userId: "u1" };

describe("memoryPendingStore", () => {
  it("set then take returns the entry exactly once (one-time use)", async () => {
    const store = memoryPendingStore();
    await store.set("state1", entry, 10_000);
    expect(await store.take("state1")).toEqual(entry);
    expect(await store.take("state1")).toBeNull(); // consumed
  });

  it("returns null for an unknown state", async () => {
    expect(await memoryPendingStore().take("nope")).toBeNull();
  });

  it("expires entries past the TTL", async () => {
    const store = memoryPendingStore();
    await store.set("state1", entry, -1); // already expired
    expect(await store.take("state1")).toBeNull();
  });
});
