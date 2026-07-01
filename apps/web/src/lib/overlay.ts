// Client-side overlay persisted to localStorage. The redesign adds interactions
// the frozen server contract doesn't model — manual applications, "Move stage"
// status overrides, notes, task completion, sync settings, disconnect — so we
// keep them here, layered on top of the server board. (The legacy root app uses
// the same localStorage approach.) The server endpoints are left untouched.
import type { Overlay } from "../types";

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

export function loadOverlay(): Overlay {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultOverlay();
    const parsed = JSON.parse(raw) as Partial<Overlay>;
    // Merge over defaults so older/partial blobs don't crash newer code.
    const base = defaultOverlay();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      overrides: parsed.overrides ?? base.overrides,
      manual: parsed.manual ?? base.manual,
      notes: parsed.notes ?? base.notes,
      contacts: parsed.contacts ?? base.contacts,
      docs: parsed.docs ?? base.docs,
      doneTasks: parsed.doneTasks ?? base.doneTasks,
      taskLanes: parsed.taskLanes ?? base.taskLanes,
      clearedTasks: parsed.clearedTasks ?? base.clearedTasks,
      nextDone: parsed.nextDone ?? base.nextDone,
      meta: parsed.meta ?? base.meta,
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
