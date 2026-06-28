// Store for in-flight OAuth PKCE state. The in-memory impl is fine for a single
// instance; the Redis impl (behind REDIS_URL) lets any API replica complete a
// callback — the plan calls out server.py's in-process _pending as a multi-replica
// hazard. Entries are one-time-use and TTL'd so abandoned flows self-clean.
import Redis from "ioredis";
import type { ProviderId } from "@pipeline/providers";

export interface PendingEntry {
  provider: ProviderId;
  verifier: string;
  userId: string;
}

export interface PendingStore {
  set(state: string, entry: PendingEntry, ttlMs: number): Promise<void>;
  /** Atomically fetch + remove (one-time use). Returns null if missing or expired. */
  take(state: string): Promise<PendingEntry | null>;
}

export function memoryPendingStore(): PendingStore {
  const map = new Map<string, { entry: PendingEntry; exp: number }>();
  return {
    async set(state, entry, ttlMs) {
      map.set(state, { entry, exp: Date.now() + ttlMs });
    },
    async take(state) {
      const rec = map.get(state);
      if (!rec) return null;
      map.delete(state);
      return Date.now() > rec.exp ? null : rec.entry;
    },
  };
}

export function redisPendingStore(redisUrl: string): PendingStore {
  const redis = new Redis(redisUrl); // only constructed when REDIS_URL is set
  const key = (state: string) => `pipeline:oauth:${state}`;
  return {
    async set(state, entry, ttlMs) {
      await redis.set(key(state), JSON.stringify(entry), "PX", ttlMs);
    },
    async take(state) {
      const k = key(state);
      const v = await redis.get(k);
      if (v) await redis.del(k);
      return v ? (JSON.parse(v) as PendingEntry) : null;
    },
  };
}
