// Client-side overlay persisted to localStorage. The redesign adds interactions
// the frozen server contract doesn't model — manual applications, "Move stage"
// status overrides, notes, task completion, sync settings, disconnect — so we
// keep them here, layered on top of the server board. (The legacy root app uses
// the same localStorage approach.)
import type { Overlay, ManualApp } from "../types";
import { STATUS, type UiStatus } from "./status";

const KEY = "pipeline.overlay.v1";

export function defaultOverlay(): Overlay {
  return {
    overrides: {},
    manual: [],
    notes: {},
    contacts: [],
    docs: [],
    doneTasks: {},
    taskLanes: {},
    clearedTasks: {},
    nextDone: {},
    meta: {},
    settings: { autoSync: "30 min", syncOnOpen: true },
    disconnected: false,
  };
}

const isStatus = (v: unknown): v is UiStatus => typeof v === "string" && v in STATUS;
const LANES = new Set(["todo", "doing", "done"]);

/** Keep only entries whose value is a status this build knows. */
function sanitizeOverrides(raw: Record<string, unknown> | undefined): Record<string, UiStatus> {
  const out: Record<string, UiStatus> = {};
  for (const [id, v] of Object.entries(raw ?? {})) if (isStatus(v)) out[id] = v;
  return out;
}

/** Coerce a manual app's status to a known one (a foreign status must not crash the board). */
function sanitizeManual(raw: ManualApp[] | undefined): ManualApp[] {
  return (raw ?? []).map((m) => (isStatus(m.status) ? m : { ...m, status: "applied" }));
}

function sanitizeLanes(raw: Record<string, unknown> | undefined): Overlay["taskLanes"] {
  const out: Overlay["taskLanes"] = {};
  for (const [id, v] of Object.entries(raw ?? {})) if (typeof v === "string" && LANES.has(v)) out[id] = v as "todo" | "doing" | "done";
  return out;
}

export function loadOverlay(): Overlay {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultOverlay();
    const parsed = JSON.parse(raw) as Partial<Overlay>;
    // Merge over defaults so older/partial blobs don't crash newer code — and
    // SANITIZE the status-valued fields: a blob written by a different build (or
    // a corrupted one) can carry statuses this build doesn't know, and screens
    // index STATUS[status] with them. Unknown values are dropped/coerced here,
    // at the single place the overlay enters the app, instead of guarded at
    // every render site.
    const base = defaultOverlay();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      overrides: sanitizeOverrides(parsed.overrides),
      manual: sanitizeManual(parsed.manual),
      taskLanes: sanitizeLanes(parsed.taskLanes),
    };
  } catch {
    return defaultOverlay();
  }
}

export function saveOverlay(o: Overlay): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* storage full / disabled — overlay just won't persist this session */
  }
}
