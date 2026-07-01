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
import { ensureSession, getMe, getBoard, runSync, resync, getConnections, postJson } from "./api";
import { loadOverlay, saveOverlay, defaultOverlay } from "./lib/overlay";
import { flattenBoard } from "./lib/derive";
import { shortDate, syncedLabel } from "./lib/format";
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
  const [appTab, setAppTab] = useState<UiStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailFrom, setDetailFrom] = useState<DOMRect | null>(null); // when set, the detail expands from this rect (Apple-style); null → right-docked drawer
  const [modalOpen, setModalOpen] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const [viewState, setViewState] = useState<ViewState>("loading");
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [connCount, setConnCount] = useState(0);
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

  const refresh = useCallback(async () => {
    await ensureSession();
    setMe(await getMe());
    setBoard(await getBoard());
    try {
      setConnCount((await getConnections()).count);
    } catch {
      /* non-fatal — chip just shows 0 */
    }
    setLastSync(Date.now());
  }, []);

  // Initial load + post-connect (?connect=) handling.
  useEffect(() => {
    let alive = true;
    (async () => {
      const connect = new URLSearchParams(window.location.search).get("connect");
      if (connect) {
        window.history.replaceState({}, "", window.location.pathname);
        flash(CONNECT_TOASTS[connect] ?? "Mailbox connection failed or was cancelled.");
        if (connect === "ok") {
          setOverlay((o) => ({ ...o, disconnected: false }));
          try {
            await postJson("/api/sync");
          } catch {
            /* sync runs again on demand */
          }
        }
      }
      await refresh();
      if (alive) setViewState("ready");
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

  const flagNew = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setNewIds((prev) => new Set([...prev, ...ids]));
    window.setTimeout(() => setNewIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    }), 5000);
  }, []);

  const onSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    const before = new Set(apps.map((a) => a.id));
    try {
      const res = await runSync();
      const nextBoard = await getBoard();
      setBoard(nextBoard);
      setConnCount(res.connections);
      setLastSync(Date.now());
      // Flag rows that appeared as a result of the sync.
      const found = nextBoard.groups.flatMap((g) => g.applications.map((a) => a.threadId)).filter((id) => !before.has(id));
      if (found.length) {
        flagNew(found);
        setNav("applications");
        setAppTab("all");
      }
      flash(res.connections ? `Synced ${res.connections} mailbox(es).` : "No mailbox connected yet — connect one in Settings.");
    } catch {
      flash("Sync failed. Is a mailbox connected?");
    } finally {
      setSyncing(false);
    }
  }, [syncing, apps, flash, flagNew]);

  // Clear synced applications and re-scan the mailbox from scratch — recovery for
  // a board polluted by a previous bad sync. Manual + annotated apps are kept.
  const onRebuild = useCallback(async () => {
    if (syncing) return;
    if (!window.confirm("Rebuild your board from your mailbox? This clears synced applications and re-scans your inbox from scratch. Manual entries and anything you've annotated are kept.")) return;
    setSyncing(true);
    try {
      const res = await resync();
      setBoard(await getBoard());
      setConnCount(res.connections);
      setLastSync(Date.now());
      if (res.connections) {
        setNav("applications");
        setAppTab("all");
        flash(`Rebuilt your board — cleared ${res.removed} stale item(s) and re-scanned ${res.connections} mailbox(es).`);
      } else {
        flash("No mailbox connected yet — connect one in Settings.");
      }
    } catch {
      flash("Rebuild failed. Is a mailbox connected?");
    } finally {
      setSyncing(false);
    }
  }, [syncing, flash]);

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
    setOverlay((o) => ({ ...o, notes: { ...o.notes, [id]: [{ body, when: "just now" }, ...(o.notes[id] ?? [])] } }));
  }, [setOverlay]);

  const toggleTask = useCallback((id: string) => {
    setOverlay((o) => ({ ...o, doneTasks: { ...o.doneTasks, [id]: !o.doneTasks[id] } }));
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
    setOverlay((o) => ({
      ...o,
      docs: [{ id: uid("d"), name: file.name, type: ext.startsWith("PDF") ? "PDF" : ext, size: humanSize(file.size), date: shortDate(new Date(nowMs).toISOString().slice(0, 10)) }, ...o.docs],
    }));
    flash(`Added ${file.name}`);
  }, [setOverlay, flash, nowMs]);

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

  const disconnect = useCallback(() => {
    setOverlay((o) => ({ ...o, disconnected: true }));
    setSelectedId(null);
  }, [setOverlay]);

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
    const createdIso = new Date(nowMs).toISOString().slice(0, 10);
    setOverlay((o) => ({
      ...o,
      manual: [...o.manual, { id, company: f.company, role: f.role, status: f.status, dateLabel: f.dateLabel, source: f.source, createdIso }],
      meta: { ...o.meta, [id]: { workType: f.workType ?? null, location: f.location?.trim() || null, salary: f.salary ?? null, resumeVersion: f.resumeVersion?.trim() || null } },
    }));
    setModalOpen(false);
    setNav("applications");
    setAppTab("all");
    flagNew([id]);
    flash(`Added ${f.company}`);
  }, [setOverlay, nowMs, flagNew, flash]);

  const ctx: Ctx = {
    apps,
    overlay,
    newIds,
    nowMs,
    me,
    email,
    q,
    appTab,
    setAppTab,
    goto,
    openDetail,
    onNewApp,
    onSync,
    onRebuild,
    setStatus,
    setMeta,
    markNextDone,
    addNote,
    toggleTask,
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
          connectedCount={connCount}
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
