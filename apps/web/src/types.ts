// UI-facing types for the redesigned web app. The server contract lives in
// @pipeline/contracts (Board/Application/Status); these are the presentation
// shapes the screens render, plus the client-side overlay persisted to
// localStorage (status overrides, manual apps, notes, tasks, settings).
import type { UiStatus } from "./lib/status";

export type Screen =
  | "dashboard"
  | "applications"
  | "companies"
  | "contacts"
  | "calendar"
  | "tasks"
  | "statistics"
  | "documents"
  | "templates"
  | "settings";

export type ViewState = "ready" | "loading" | "empty" | "error";
export type DetailTab = "overview" | "notes" | "contacts" | "files";

export type WorkType = "remote" | "hybrid" | "onsite";

/** Optional, user-entered tracking fields for any application (server or manual).
 *  Keyed by application id in the overlay so it annotates synced apps too — and
 *  powers the work-type / location / salary / resume-version statistics. */
export interface AppMeta {
  workType?: WorkType | null;
  location?: string | null;
  salary?: number | null; // annual, user's currency
  resumeVersion?: string | null;
}

export interface Plan {
  email: string;
  plan: "free" | "pro" | "teams";
}

/** A flattened, presentation-ready application (server-derived OR manual). */
export interface UiApplication {
  id: string; // threadId for server apps; "m-…" for manual ones
  threadId: string | null;
  company: string;
  companyDomain: string;
  role: string;
  status: UiStatus;
  appliedIso: string | null; // earliest activity (firstSeen) — metrics
  lastActivityIso: string | null; // latest activity — aging
  dateLabel: string; // compact display, e.g. "May 2" / "today"
  source: string; // channel label (LinkedIn, Company site, …)
  nextStep: string; // human next action, or "—"
  snippet: string;
  manual: boolean;
  needsReview: boolean; // classifier confidence below the review threshold → "unconfirmed" affordance
  // user-entered tracking fields (from the overlay) — optional
  workType: WorkType | null;
  location: string | null;
  salary: number | null;
  resumeVersion: string | null;
}

export interface NoteEntry {
  body: string;
  when: string;
}

export interface ContactEntry {
  id: string;
  name: string;
  title: string;
  email: string;
  company: string;
}

export interface DocEntry {
  id: string;
  name: string;
  type: string; // "PDF" | "DOC" | …
  size: string; // human size
  date: string; // short label
}

export interface ManualApp {
  id: string;
  company: string;
  role: string;
  status: UiStatus;
  dateLabel: string;
  source: string;
  createdIso: string;
}

export interface OverlaySettings {
  autoSync: "30 min" | "Hourly" | "Manual";
  syncOnOpen: boolean;
}

/** Everything we persist client-side, layered on top of the server board. */
export interface Overlay {
  overrides: Record<string, UiStatus>;
  manual: ManualApp[];
  notes: Record<string, NoteEntry[]>;
  contacts: ContactEntry[];
  docs: DocEntry[];
  doneTasks: Record<string, boolean>;
  nextDone: Record<string, boolean>;
  meta: Record<string, AppMeta>; // per-application tracking fields, keyed by app id
  settings: OverlaySettings;
  disconnected: boolean;
}
