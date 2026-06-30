// The single context object App builds and hands to every screen/drawer/modal.
// Keeps prop-threading flat: screens destructure what they need.
import type { Screen, Plan, Overlay, UiApplication, OverlaySettings } from "./types";
import type { UiStatus } from "./lib/status";

export interface Ctx {
  apps: UiApplication[]; // flattened + overlaid, newest activity first
  overlay: Overlay;
  newIds: Set<string>; // ids flagged NEW (post-sync / post-add), auto-clears
  nowMs: number;
  me: Plan | null;
  email: string;

  // header search + applications filter
  q: string;
  appTab: UiStatus | "all";
  setAppTab: (t: UiStatus | "all") => void;

  // navigation / overlays
  goto: (s: Screen) => void;
  openDetail: (id: string) => void;
  onNewApp: () => void;
  onSync: () => void;

  // mutations (persisted to the localStorage overlay)
  setStatus: (id: string, s: UiStatus) => void;
  markNextDone: (id: string) => void;
  addNote: (id: string, body: string) => void;
  toggleTask: (id: string) => void;
  setSetting: (patch: Partial<OverlaySettings>) => void;
  addContact: (c: { name: string; title: string; email: string; company: string }) => void;
  addDoc: (file: File) => void;
  exportCsv: () => void;
  deleteAll: () => void;
  disconnect: () => void;
  copyTemplate: (title: string, snippet: string) => void;
}
