// App shell + orchestrator for the redesigned Pipeline web app.
//
// The server contract is untouched: we read the board from /api/applications,
// trigger /api/sync, and start OAuth connect. Everything the warm-light redesign
// adds beyond the 4-status board — the 7-status presentation system, manual
// applications, "Move stage", notes, tasks, sync settings, disconnect — lives in
// a client overlay (localStorage), layered on top of the server data.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Board } from "@pipeline/contracts";
import type { Overlay, Plan, Screen, OverlaySettings, ViewState, AppMeta } from "./types";
import type { UiStatus } from "./lib/status";
import { STATUS } from "./lib/status";
import { ensureSession, getMe, getBoard, runSync, resync, getConnections, deleteConnection, postJson, type Mailbox, type SyncSummary } from "./api";
import { loadOverlay, saveOverlay, defaultOverlay } from "./lib/overlay";
import { flattenBoard } from "./lib/derive";
import { shortDate, syncedLabel, localIsoDate } from "./lib/format";
import { Sidebar, Header, Toast, StateLoading, StateError, screenTitle } from "./components";
import type { Ctx } from "./ctx";
import { Dashboard, Applications, Contacts, Calendar, Tasks, Statistics, Documents, Templates, Settings } from "./screens";
import { DetailDrawer } from "./drawer";
import { NewApplicationModal, type NewAppForm } from "./modals";
import { Onboarding } from "./onboarding";

// Toast shown after the OAuth callback redirects back with ?connect=<status>.
const CONNECT_TOASTS: Record<string, string> = {
  ok: "Mailbox connected — syncing your applications…",
  unconfigured: "That provider isn’t set up yet — add your OAuth client IDs (see DEPLOY.md).",
  error: "Mailbox connection failed or was cancelled.",
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Monotonic id so two overlay items created in the same millisecond never collide.
let _idSeq = 0;
const uid = (prefix: string): string => `${prefix}-${Date.now()}-${(_idSeq += 1)}`;

const SCREENS: Record<Screen, (ctx: Ctx) => JSX.Element> = {
  dashboard: Dashboard,
  applications: Applications,
  contacts: Contacts,
  calendar: Calendar,
  tasks: Tasks,
  statistics: Statistics,
  documents: Documents,
  templates: Templates,
  settings: Settings,
};

export function App() {
  const [nowMs] = useState(() => Date.now());
  const [me, setMe] = useState<Plan | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [overlay, setOverlayState] = useState<Overlay>(() => loadOverlay());

  const [nav, setNav] = useState<Screen>("dashboard");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailFrom, setDetailFrom] = useState<DOMRect | null>(null); // when set, the detail expands from this rect (Apple-style); null → right-docked drawer
  const [modalOpen, setModalOpen] = useState(false);

  const [viewState, setViewState] = useState<ViewState>("loading");
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  // Toast carries a nonce so flashing the *same* message twice still produces a
  // fresh state identity — otherwise React bails on the equal update and the
  // [toast]-keyed auto-dismiss effect wouldn't re-arm the timer.
  const [toast, setToast] = useState<{ msg: string; n: number } | null>(null);
  const toastSeq = useRef(0);

  // Persist the overlay on every change.
  const setOverlay = useCallback((update: (o: Overlay) => Overlay) => {
    setOverlayState((prev) => {
      const next = update(prev);
      saveOverlay(next);
      return next;
    });
  }, []);

  const flash = useCallback((msg: string) => setToast({ msg, n: (toastSeq.current += 1) }), []);

  // Board + identity + connections. Deliberately does NOT stamp lastSync — this
  // only re-reads what's stored; the "synced" chip must reflect real mailbox
  // syncs, not page loads. Returns the connection count (for sync-on-open).
  const refresh = useCallback(async (): Promise<number> => {
    await ensureSession();
    setMe(await getMe());
    setBoard(await getBoard());
    try {
      const c = await getConnections();
      setMailboxes(c.mailboxes);
      return c.count;
    } catch {
      /* non-fatal — chip just shows 0 */
      return 0;
    }
  }, []);

  // Latest onSync/overlay without re-running mount-style effects on every render.
  const onSyncRef = useRef<() => void>(() => {});
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;

  // Initial load + post-connect (?connect=) handling.
  useEffect(() => {
    let alive = true;
    (async () => {
      const connect = new URLSearchParams(window.location.search).get("connect");
      if (connect) {
        window.history.replaceState({}, "", window.location.pathname);
        flash(CONNECT_TOASTS[connect] ?? CONNECT_TOASTS.error!);
        if (connect === "ok") {
          setOverlay((o) => ({ ...o, disconnected: false }));
          try {
            await postJson("/api/sync");
          } catch {
            /* sync runs again on demand */
          }
        }
      }
      const connections = await refresh();
      if (!alive) return;
      setViewState("ready");
      // "Sync on app open" (Settings): a real behavior, not a dead toggle. The
      // post-connect path just synced, so don't double up on that redirect.
      if (connect !== "ok" && connections > 0 && overlayRef.current.settings.syncOnOpen) {
        onSyncRef.current();
      }
    })().catch((e: unknown) => {
      if (alive) {
        setViewState("error");
        // eslint-disable-next-line no-console
        console.error(e);
      }
    });
    return () => {
      alive = false;
    };
  }, [refresh, setOverlay, flash]);

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const apps = useMemo(() => flattenBoard(board, overlay, nowMs), [board, overlay, nowMs]);
  const email = me?.email ?? "you@gmail.com";

  // ---- actions -------------------------------------------------------------
  // Navigating dismisses any open drawer/modal so they don't linger over the
  // new screen (the scrim only covers the content area, not the sidebar).
  const goto = useCallback((s: Screen) => {
    setNav(s);
    setSelectedId(null);
    setModalOpen(false);
  }, []);
  const openDetail = useCallback((id: string, from?: DOMRect | null) => {
    setDetailFrom(from ?? null);
    setSelectedId(id);
  }, []);
  const onNewApp = useCallback(() => setModalOpen(true), []);

  // A sync round is only a success for the mailboxes that actually synced — the
  // API returns per-connection outcomes, and "reauth required" must never read
  // as "Synced 1 mailbox(es)." while the board quietly goes stale.
  const describeFailures = (res: SyncSummary): { ok: number; failText: string | null } => {
    const failed = res.results.filter((r) => r.error);
    if (failed.length === 0) return { ok: res.results.length, failText: null };
    const f = failed[0]!;
    const why = f.error === "reauth required" ? `${f.email} needs to be reconnected (Settings → Connect)` : `${f.email}: ${f.error}`;
    return { ok: res.results.length - failed.length, failText: why };
  };

  const onSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    const before = new Set(apps.map((a) => a.id));
    try {
      const res = await runSync();
      const nextBoard = await getBoard();
      setBoard(nextBoard);
      // Jump to Applications when the sync produced new rows.
      const found = nextBoard.groups.flatMap((g) => g.applications.map((a) => a.threadId)).filter((id) => !before.has(id));
      if (found.length) setNav("applications");
      if (!res.connections) {
        flash("No mailbox connected yet — connect one in Settings.");
      } else {
        const { ok, failText } = describeFailures(res);
        if (ok > 0) setLastSync(Date.now()); // stamp only when a mailbox really synced
        if (!failText) flash(`Synced ${res.connections} mailbox(es).`);
        else if (ok > 0) flash(`Synced ${ok} mailbox(es), but ${failText}.`);
        else flash(`Sync failed — ${failText}.`);
      }
    } catch {
      flash("Sync failed. Is the API running?");
    } finally {
      setSyncing(false);
    }
  }, [syncing, apps, flash]);
  onSyncRef.current = () => void onSync();

  // Clear synced applications and re-scan the mailbox from scratch — recovery for
  // a board polluted by a previous bad sync. Manual apps are kept server-side;
  // everything the user annotated IN THE APP (notes, stage moves, tracking
  // fields) lives in the client overlay, so those thread ids are sent along for
  // the rebuild to preserve — otherwise the dialog's promise would be false.
  const onRebuild = useCallback(async () => {
    if (syncing) return;
    if (!window.confirm("Rebuild your board from your mailbox? This clears synced applications and re-scans your inbox from scratch. Manual entries and anything you've annotated (notes, stage moves, tracking fields) are kept.")) return;
    setSyncing(true);
    try {
      const o = overlayRef.current;
      const keepThreadIds = [
        ...new Set([...Object.keys(o.notes), ...Object.keys(o.overrides), ...Object.keys(o.meta), ...Object.keys(o.nextDone)]),
      ].filter((id) => !id.startsWith("m-")); // manual apps aren't server rows
      const res = await resync(keepThreadIds);
      setBoard(await getBoard());
      if (res.connections) {
        const { ok, failText } = describeFailures(res);
        if (ok > 0) setLastSync(Date.now());
        setNav("applications");
        if (!failText) flash(`Rebuilt your board — cleared ${res.removed} stale item(s) and re-scanned ${res.connections} mailbox(es).`);
        else flash(`Cleared ${res.removed} stale item(s), but the re-scan hit a problem — ${failText}.`);
      } else {
        flash("No mailbox connected yet — connect one in Settings.");
      }
    } catch {
      flash("Rebuild failed. Is the API running?");
    } finally {
      setSyncing(false);
    }
  }, [syncing, flash]);

  // "Auto-sync frequency" (Settings): a real client-side scheduler. (A hosted
  // deployment may ALSO run the server scheduler via SYNC_INTERVAL_MS; both
  // funnel through the same idempotent /api/sync.)
  useEffect(() => {
    if (overlay.settings.autoSync === "Manual") return;
    const ms = overlay.settings.autoSync === "Hourly" ? 3_600_000 : 1_800_000;
    const t = window.setInterval(() => onSyncRef.current(), ms);
    return () => window.clearInterval(t);
  }, [overlay.settings.autoSync]);

  const setStatus = useCallback((id: string, s: UiStatus) => {
    setOverlay((o) => ({ ...o, overrides: { ...o.overrides, [id]: s } }));
    flash(`Moved to ${STATUS[s].label}`);
  }, [setOverlay, flash]);

  const setMeta = useCallback((id: string, patch: Partial<AppMeta>) => {
    setOverlay((o) => ({ ...o, meta: { ...o.meta, [id]: { ...o.meta[id], ...patch } } }));
  }, [setOverlay]);

  const markNextDone = useCallback((id: string) => {
    setOverlay((o) => ({ ...o, nextDone: { ...o.nextDone, [id]: true } }));
    flash("Marked as done — nice work");
  }, [setOverlay, flash]);

  const addNote = useCallback((id: string, body: string) => {
    // A real date, not the literal "just now" — the note is rendered weeks later.
    setOverlay((o) => ({ ...o, notes: { ...o.notes, [id]: [{ body, when: localIsoDate(Date.now()) }, ...(o.notes[id] ?? [])] } }));
  }, [setOverlay]);

  const setTaskLane = useCallback((id: string, lane: "todo" | "doing" | "done") => {
    setOverlay((o) => ({ ...o, taskLanes: { ...o.taskLanes, [id]: lane } }));
  }, [setOverlay]);

  const clearTasks = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setOverlay((o) => {
      const cleared = { ...o.clearedTasks };
      for (const id of ids) cleared[id] = true;
      return { ...o, clearedTasks: cleared };
    });
  }, [setOverlay]);
  const restoreTasks = useCallback(() => {
    setOverlay((o) => ({ ...o, clearedTasks: {} }));
  }, [setOverlay]);

  const setSetting = useCallback((patch: Partial<OverlaySettings>) => {
    setOverlay((o) => ({ ...o, settings: { ...o.settings, ...patch } }));
  }, [setOverlay]);

  const addContact = useCallback((c: { name: string; title: string; email: string; company: string }) => {
    setOverlay((o) => ({ ...o, contacts: [{ id: uid("c"), ...c }, ...o.contacts] }));
    flash(`Added ${c.name}`);
  }, [setOverlay, flash]);

  const addDoc = useCallback((file: File) => {
    const ext = (file.name.split(".").pop() ?? "").toUpperCase().slice(0, 3) || "DOC";
    // Current LOCAL date — not the UTC date of a nowMs frozen at mount.
    setOverlay((o) => ({
      ...o,
      docs: [{ id: uid("d"), name: file.name, type: ext.startsWith("PDF") ? "PDF" : ext, size: humanSize(file.size), date: shortDate(localIsoDate(Date.now())) }, ...o.docs],
    }));
    flash(`Added ${file.name}`);
  }, [setOverlay, flash]);

  const exportCsv = useCallback(() => {
    const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = ["Company", "Role", "Status", "Source", "Applied", "Last activity", "Next step"];
    const lines = [header, ...apps.map((a) => [a.company, a.role, STATUS[a.status].label, a.source, a.appliedIso ?? "", a.lastActivityIso ?? "", a.nextStep])];
    const csv = lines.map((r) => r.map((c) => cell(String(c))).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "pipeline.csv";
    a.click();
    URL.revokeObjectURL(url);
    flash("Exported your applications to CSV.");
  }, [apps, flash]);

  const deleteAll = useCallback(() => {
    if (!window.confirm("Clear all your local Pipeline data (manual apps, notes, status changes, tasks)? Your inbox and server records are untouched.")) return;
    const fresh = defaultOverlay();
    saveOverlay(fresh);
    setOverlayState(fresh);
    setSelectedId(null);
    flash("Your local data was cleared.");
  }, [flash]);

  // A REAL disconnect: delete the connection server-side (tokens + cursor go with
  // it, background sync stops reading the account), then reflect the new state.
  // The overlay flag alone would only hide the UI while the server kept syncing.
  const disconnect = useCallback((connectionId?: string) => {
    void (async () => {
      try {
        const targets = connectionId ? mailboxes.filter((m) => m.id === connectionId) : mailboxes;
        for (const m of targets) await deleteConnection(m.id);
        const next = await getConnections();
        setMailboxes(next.mailboxes);
        if (next.count === 0) {
          setOverlay((o) => ({ ...o, disconnected: true }));
          setSelectedId(null);
        }
        if (targets.length) flash("Mailbox disconnected — Pipeline no longer reads it.");
      } catch {
        flash("Couldn't disconnect the mailbox. Is the API running?");
      }
    })();
  }, [mailboxes, setOverlay, flash]);

  const copyTemplate = useCallback((title: string, snippet: string) => {
    try {
      void navigator.clipboard?.writeText(snippet);
    } catch {
      /* clipboard unavailable */
    }
    flash(`Copied “${title}” to your clipboard.`);
  }, [flash]);

  const saveNewApp = useCallback((f: NewAppForm) => {
    const id = uid("m");
    // The date the user picked drives BOTH the label and the metrics (calendar,
    // trend, streaks) — falling back to the current LOCAL date, not the UTC date
    // of a nowMs frozen at mount.
    const createdIso = f.dateIso || localIsoDate(Date.now());
    setOverlay((o) => ({
      ...o,
      manual: [...o.manual, { id, company: f.company, role: f.role, status: f.status, dateLabel: "", source: f.source, createdIso }],
      meta: { ...o.meta, [id]: { workType: f.workType ?? null, location: f.location?.trim() || null, salary: f.salary ?? null, resumeVersion: f.resumeVersion?.trim() || null } },
    }));
    setModalOpen(false);
    setNav("applications");
    flash(`Added ${f.company}`);
  }, [setOverlay, flash]);

  const ctx: Ctx = {
    apps,
    overlay,
    nowMs,
    me,
    email,
    mailboxes,
    q,
    goto,
    openDetail,
    onNewApp,
    onSync,
    onRebuild,
    setStatus,
    setMeta,
    markNextDone,
    addNote,
    setTaskLane,
    clearTasks,
    restoreTasks,
    setSetting,
    addContact,
    addDoc,
    exportCsv,
    deleteAll,
    disconnect,
    copyTemplate,
  };

  // ---- onboarding takeover -------------------------------------------------
  if (overlay.disconnected) {
    return (
      <div className="app">
        <Onboarding onDemo={() => setOverlay((o) => ({ ...o, disconnected: false }))} />
        {toast && <Toast msg={toast.msg} />}
      </div>
    );
  }

  const selected = selectedId ? apps.find((a) => a.id === selectedId) ?? null : null;
  const ScreenComp = SCREENS[nav];

  return (
    <div className="app">
      <Sidebar active={nav} onNav={goto} me={me} />
      <main className="main">
        <Header
          title={screenTitle(nav)}
          q={q}
          onSearch={setQ}
          connectedCount={mailboxes.length}
          syncLabel={syncing ? "syncing…" : syncedLabel(lastSync)}
          syncing={syncing}
          onSync={onSync}
          onNewApp={onNewApp}
        />

        <div className="content">{viewState === "ready" && <ScreenComp {...ctx} />}</div>

        {viewState === "loading" && <StateLoading />}
        {viewState === "error" && (
          <StateError onRetry={() => { setViewState("loading"); refresh().then(() => setViewState("ready")).catch(() => setViewState("error")); }} onCheck={() => { setViewState("ready"); setNav("settings"); }} />
        )}

        {selected && <DetailDrawer app={selected} ctx={ctx} from={detailFrom} onClose={() => setSelectedId(null)} />}
        {modalOpen && <NewApplicationModal onClose={() => setModalOpen(false)} onSave={saveNewApp} />}
        {toast && <Toast msg={toast.msg} />}
      </main>
    </div>
  );
}
