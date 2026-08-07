// Write paths. Status overrides update the board optimistically (instant UI,
// rollback on failure); everything else invalidates and refetches. Writes
// require connectivity in this phase — the queued-offline-writes machinery is
// deliberately deferred (plan §B4).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { applicationSchema, boardSchema, type Application, type Board, type Status } from "@pipeline/contracts";
import { request } from "./client";
import { hapticError, hapticSuccess } from "../ui/feedback";

const applicationEnvelope = z.object({ application: applicationSchema });
const reviewResolveEnvelope = z.object({ ok: z.boolean(), application: applicationSchema.nullable() });
const connectTokenEnvelope = z.object({ connectToken: z.string(), expiresInSeconds: z.number(), startPath: z.string() });
const okEnvelope = z.object({ ok: z.boolean() });

/** Re-derive board counts after a local status edit (mirror of the server's). */
function recount(groups: Board["groups"]): Board["counts"] {
  const counts = { applied: 0, interview: 0, offer: 0, rejected: 0, cancelled: 0, total: 0 };
  for (const g of groups)
    for (const a of g.applications) {
      counts[a.status] += 1;
      counts.total += 1;
    }
  return counts;
}

function patchBoard(board: Board, threadId: string, patch: (a: Application) => Application): Board {
  const groups = board.groups.map((g) => ({
    ...g,
    applications: g.applications.map((a) => (a.threadId === threadId ? patch(a) : a)),
  }));
  return { ...board, groups, counts: recount(groups) };
}

/** Sticky status override — the user's word outranks the classifier. */
export function useOverrideStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, status }: { threadId: string; status: Status }) =>
      request(`/api/applications/${encodeURIComponent(threadId)}`, applicationEnvelope, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onMutate: async ({ threadId, status }) => {
      await qc.cancelQueries({ queryKey: ["board"] });
      const before = qc.getQueryData<Board>(["board"]);
      if (before) qc.setQueryData(["board"], patchBoard(before, threadId, (a) => ({ ...a, status })));
      return { before };
    },
    onSuccess: () => hapticSuccess(),
    onError: (_err, _vars, ctx) => {
      if (ctx?.before) qc.setQueryData(["board"], ctx.before); // rollback — server said no
      hapticError();
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["board"] });
      void qc.invalidateQueries({ queryKey: ["review"] });
      void qc.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useAddPosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { company: string; role: string; status?: Status; appliedOn?: string }) =>
      request("/api/applications", applicationEnvelope, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      hapticSuccess();
      void qc.invalidateQueries({ queryKey: ["board"] });
    },
    onError: () => hapticError(),
  });
}

/** Resolve a review-queue item: confirm keeps the status, 'set' also overrides. */
export function useResolveReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, action, status }: { threadId: string; action: "confirm" | "set"; status?: Status }) =>
      request(`/api/review/${encodeURIComponent(threadId)}`, reviewResolveEnvelope, {
        method: "POST",
        body: JSON.stringify({ action, status }),
      }),
    onSuccess: () => {
      hapticSuccess();
      void qc.invalidateQueries({ queryKey: ["review"] });
      void qc.invalidateQueries({ queryKey: ["board"] });
      void qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: () => hapticError(),
  });
}

/** One-time nonce that lets the SYSTEM BROWSER start mail OAuth for this user —
 *  the phone itself never touches the mail token. */
export function useConnectToken() {
  return useMutation({
    mutationFn: (provider: "google" | "microsoft") =>
      request("/api/connect-token", connectTokenEnvelope, { method: "POST", body: JSON.stringify({ provider }) }),
  });
}

const deviceEnvelope = z.object({
  device: z.object({
    id: z.string(),
    notifyStatusChanges: z.boolean(),
    notifyReminders: z.boolean(),
  }),
});

/** Per-device notification preferences (Settings toggles). Optimistic — a
 *  native Switch that animates on, snaps back, then flips again after the
 *  round-trip reads as broken on any slow connection. */
export function useUpdateDevice() {
  const qc = useQueryClient();
  type Devices = { devices: { id: string; notifyStatusChanges: boolean; notifyReminders: boolean }[] };
  return useMutation({
    mutationFn: ({ id, ...prefs }: { id: string; notifyStatusChanges?: boolean; notifyReminders?: boolean }) =>
      request(`/api/devices/${encodeURIComponent(id)}`, deviceEnvelope, { method: "PATCH", body: JSON.stringify(prefs) }),
    onMutate: async ({ id, ...prefs }) => {
      await qc.cancelQueries({ queryKey: ["devices"] });
      const before = qc.getQueryData<Devices>(["devices"]);
      if (before) {
        qc.setQueryData<Devices>(["devices"], {
          devices: before.devices.map((d) => (d.id === id ? { ...d, ...prefs } : d)),
        });
      }
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(["devices"], ctx.before);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["devices"] }),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request("/api/account", okEnvelope, { method: "DELETE" }),
    onSuccess: () => qc.clear(), // every cached record belonged to the erased account
  });
}

export { boardSchema };
