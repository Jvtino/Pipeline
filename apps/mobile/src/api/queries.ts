// TanStack Query hooks over the validated client. Query keys are the app's
// cache vocabulary — invalidations in later phases must use these exact keys.
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { boardSchema } from "@pipeline/contracts";
import { request } from "./client";

// Response envelopes for endpoints whose shapes live server-side (additive
// fields tolerated by design — zod strips unknown keys).
const messagesSchema = z.object({
  messages: z.array(
    z.object({
      date: z.string(),
      from: z.string(),
      bodyPreview: z.string(),
      attachments: z.array(z.object({ name: z.string(), contentType: z.string().nullish(), size: z.number().nullish() })),
      webLink: z.string().nullish(),
    }),
  ),
});

const eventsSchema = z.object({
  events: z.array(z.object({ status: z.string(), occurredAt: z.string(), source: z.string() })),
});

const connectionsSchema = z.object({
  count: z.number(),
  mailboxes: z.array(z.object({ id: z.string(), provider: z.string(), email: z.string() })),
});

const metaSchema = z.object({
  ok: z.boolean(),
  minMobileVersion: z.string(),
  features: z.object({ gmailConnect: z.boolean(), microsoftConnect: z.boolean() }),
});

const meSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), plan: z.string() }),
});

export const useBoard = () =>
  useQuery({
    queryKey: ["board"],
    queryFn: () => request("/api/applications", boardSchema),
  });

export const useMessages = (threadId: string) =>
  useQuery({
    queryKey: ["messages", threadId],
    queryFn: () => request(`/api/applications/${encodeURIComponent(threadId)}/messages`, messagesSchema),
  });

export const useEvents = (threadId: string) =>
  useQuery({
    queryKey: ["events", threadId],
    queryFn: () => request(`/api/applications/${encodeURIComponent(threadId)}/events`, eventsSchema),
  });

export const useConnections = () =>
  useQuery({
    queryKey: ["connections"],
    queryFn: () => request("/api/connections", connectionsSchema),
  });

/** Public endpoint (no auth): version gate + feature flags. Cached aggressively;
 *  a failure must never block the app (treated as "no constraints known"). */
export const useMeta = () =>
  useQuery({
    queryKey: ["meta"],
    queryFn: () => request("/api/meta", metaSchema),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

export const useMe = (enabled: boolean) =>
  useQuery({
    queryKey: ["me"],
    queryFn: () => request("/auth/me", meSchema),
    enabled,
    retry: false,
  });
