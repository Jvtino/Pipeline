// The single context object App builds and hands to every screen/drawer/modal.
// Keeps prop-threading flat: screens destructure what they need.
import type { Screen, Plan, Overlay, UiApplication, OverlaySettings, AppMeta } from "./types";
import type { UiStatus } from "./lib/status";
import type { Mailbox } from "./api";

export interface Ctx {
  apps: UiApplication[]; // flattened + overlaid, newest activity first
  overlay: Overlay;
  nowMs: number;
  me: Plan | null;
  email: string;
  mailboxes: Mailbox[]; // really-connected mailboxes from /api/connections

  // header search
  q: string;

  // navigation / overlays
  goto: (s: Screen) => void;
  openDetail: (id: string, from?: DOMRect | null) => void; // from set → detail expands from that rect (Apple-style)
  onNewApp: () => void;
  onSync: () => void;
  onRebuild: () => void; // clear synced apps + re-scan the mailbox from scratch

  // mutations (persisted to the localStorage overlay)
  setStatus: (id: string, s: UiStatus) => void;
  setMeta: (id: string, patch: Partial<AppMeta>) => void;
  markNextDone: (id: string) => void;
  addNote: (id: string, body: string) => void;
  setTaskLane: (id: string, lane: "todo" | "doing" | "done") => void;
  clearTasks: (ids: string[]) => void; // dismiss derived tasks from the board
  restoreTasks: () => void; // un-dismiss all cleared tasks
  setSetting: (patch: Partial<OverlaySettings>) => void;
  addContact: (c: { name: string; title: string; email: string; company: string }) => void;
  addDoc: (file: File) => void;
  exportCsv: () => void;
  deleteAll: () => void;
  disconnect: (connectionId?: string) => void; // with an id → that mailbox; without → all
  copyTemplate: (title: string, snippet: string) => void;
}
