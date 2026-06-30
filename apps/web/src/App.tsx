import { useCallback, useEffect, useState } from "react";
import type { Board, CompanyGroup, Application, Status } from "@pipeline/contracts";

type Plan = "free" | "pro" | "teams";
interface Me {
  email: string;
  plan: Plan;
}
interface Nudge {
  threadId: string;
  company: string;
  role: string;
  daysSince: number;
  suggestion: string;
}
interface Note {
  id: string;
  body: string;
  createdAt: string;
}
interface Contact {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
}

const STATUS_LABEL: Record<Status, string> = { applied: "Active", interview: "Interview", offer: "Offer", rejected: "Rejected" };
const enc = (threadId: string) => encodeURIComponent(threadId);

type Toast = { type: "ok" | "err"; msg: string };
// Toast shown when the OAuth callback redirects back with ?connect=<status>.
// `ok` additionally kicks off a sync (handled separately); any unknown status falls back to `error`.
const CONNECT_TOASTS: { error: Toast; [status: string]: Toast } = {
  ok: { type: "ok", msg: "Mailbox connected — syncing your applications…" },
  unconfigured: { type: "err", msg: "That mailbox provider isn’t set up yet — add your OAuth client IDs (see EMAIL-SETUP.md)." },
  error: { type: "err", msg: "Mailbox connection failed or was cancelled." },
};

// Friendly name for a sync result's provider, used in reconnect prompts.
const providerLabel = (p: string): string => (p === "google" ? "Gmail" : p === "microsoft" ? "Outlook" : p);
// A sync result error means the stored token can no longer be refreshed → reconnect.
const isReauthError = (msg: string | undefined): boolean => /reauth|invalid_grant|expired|revoked/i.test(msg ?? "");

async function ensureSession(): Promise<void> {
  const me = await fetch("/auth/me");
  if (me.status === 401) {
    await fetch("/auth/dev/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "demo@pipeline.local" }) });
  }
}
async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
}
async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [reminders, setReminders] = useState<Nudge[]>([]);
  const [analytics, setAnalytics] = useState<{ interviewRate: number; offerRate: number } | null>(null);
  const [selected, setSelected] = useState<Application | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const isPro = me?.plan === "pro" || me?.plan === "teams";

  const refresh = useCallback(async () => {
    await ensureSession();
    const meRes = await getJson<{ user: Me }>("/auth/me");
    setMe(meRes.user);
    setBoard(await getJson<Board>("/api/applications"));
    if (meRes.user.plan !== "free") {
      try {
        setReminders((await getJson<{ nudges: Nudge[] }>("/api/reminders")).nudges);
      } catch {
        setReminders([]);
      }
      try {
        setAnalytics(await getJson<{ interviewRate: number; offerRate: number }>("/api/analytics"));
      } catch {
        setAnalytics(null);
      }
    } else {
      setReminders([]);
      setAnalytics(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Handle the post-connect redirect (?connect=ok|unconfigured|error) from the OAuth callback.
      const connect = new URLSearchParams(window.location.search).get("connect");
      if (connect) {
        window.history.replaceState({}, "", window.location.pathname);
        setToast(CONNECT_TOASTS[connect] ?? CONNECT_TOASTS.error);
        if (connect === "ok") {
          try {
            await postJson("/api/sync");
          } catch {
            /* sync runs again on demand */
          }
        }
      }
      await refresh();
      if (alive) setLoading(false);
    })().catch((e: unknown) => {
      if (alive) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [refresh]);

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  async function setPlan(plan: Plan) {
    await postJson("/auth/dev/upgrade", { plan });
    await refresh();
  }

  async function doSync() {
    setSyncing(true);
    try {
      const res = await postJson<{ connections: number; results?: { provider: string; error?: string }[] }>("/api/sync");
      await refresh();
      const failed = (res.results ?? []).filter((r) => r.error);
      const reauth = failed.filter((r) => isReauthError(r.error));
      if (reauth.length > 0) {
        const who = [...new Set(reauth.map((r) => providerLabel(r.provider)))].join(" & ");
        const tip = reauth.some((r) => r.provider === "google")
          ? " (Publish your Google app to “In production” so this stops recurring — see EMAIL-SETUP.md.)"
          : "";
        setToast({ type: "err", msg: `${who} needs reconnecting — use Connect ▾.${tip}` });
      } else if (failed.length > 0) {
        setToast({ type: "err", msg: `Sync issue: ${failed[0]?.error ?? "unknown error"}` });
      } else {
        setToast({ type: "ok", msg: res.connections ? `Synced ${res.connections} mailbox(es).` : "No mailbox connected yet — use Connect." });
      }
    } catch {
      setToast({ type: "err", msg: "Sync failed. Is a mailbox connected?" });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ▦
          </span>{" "}
          Pipeline
        </div>
        <div className="topbar-right">
          {board && <span className="chip">{board.source} data</span>}

          <div className="connect">
            <button className="btn" onClick={() => setConnectOpen((o) => !o)} aria-expanded={connectOpen}>
              Connect ▾
            </button>
            {connectOpen && (
              <div className="connect-menu" onMouseLeave={() => setConnectOpen(false)}>
                <a className="connect-item" href="/auth/google/start">
                  Connect Gmail
                </a>
                <a className="connect-item" href="/auth/microsoft/start">
                  Connect Outlook
                </a>
                <div className="connect-note muted">One-time setup per provider — see EMAIL-SETUP.md.</div>
              </div>
            )}
          </div>

          <button className="btn" onClick={() => void doSync()} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync"}
          </button>

          {me && <span className={`badge badge-${me.plan}`}>{me.plan.toUpperCase()}</span>}
          {isPro ? (
            <>
              <a className="btn" href="/api/export.csv">
                Export CSV
              </a>
              <button className="btn btn-ghost" onClick={() => void setPlan("free")}>
                Downgrade
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => void setPlan("pro")}>
              Upgrade to Pro (demo)
            </button>
          )}
        </div>
      </header>

      {toast && <div className={`toast toast-${toast.type}`} role="status">{toast.msg}</div>}

      <main>
        {loading && <p className="muted center">Loading your board…</p>}
        {error && (
          <div className="notice error" role="alert">
            <strong>Couldn’t reach the API.</strong> {error}
            <div className="muted">
              Start it with <code>pnpm --filter @pipeline/api dev</code> (port 3001).
            </div>
          </div>
        )}

        {isPro && reminders.length > 0 && (
          <section className="reminders">
            <div className="reminders-head">
              ⏰ <strong>{reminders.length}</strong> follow-up{reminders.length > 1 ? "s" : ""} due
            </div>
            <ul>
              {reminders.slice(0, 4).map((n) => (
                <li key={n.threadId}>
                  <strong>{n.company}</strong> — {n.role} · {n.daysSince}d quiet
                </li>
              ))}
            </ul>
          </section>
        )}

        {board && board.groups.length > 0 && (
          <>
            <section className="stats">
              <Stat label="Total" value={board.counts.total} tone="total" />
              <Stat label="Active" value={board.counts.applied} tone="applied" />
              <Stat label="Interview" value={board.counts.interview} tone="interview" />
              <Stat label="Offer" value={board.counts.offer} tone="offer" />
              <Stat label="Rejected" value={board.counts.rejected} tone="rejected" />
              {analytics && (
                <div className="stat stat-rate">
                  <div className="stat-value">{Math.round(analytics.interviewRate * 100)}%</div>
                  <div className="stat-label">Interview rate</div>
                </div>
              )}
            </section>

            <section className="grid">
              {board.groups.map((g) => (
                <CompanyCard key={g.company} group={g} onSelect={setSelected} />
              ))}
            </section>
          </>
        )}
      </main>

      {selected && <ApplicationPanel app={selected} isPro={isPro} onClose={() => setSelected(null)} onUpgrade={() => void setPlan("pro")} />}

      <footer className="foot muted">Derived records only — company, role, status, dates &amp; a short snippet. Never your raw email.</footer>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: Status | "total" }) {
  return (
    <div className={`stat stat-${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="avatar" aria-hidden>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function CompanyCard({ group, onSelect }: { group: CompanyGroup; onSelect: (a: Application) => void }) {
  return (
    <article className="card">
      <header className="card-head">
        <Avatar name={group.company} />
        <div className="card-title">
          <h2>{group.company}</h2>
          <span className="muted">
            {group.applications.length} role{group.applications.length > 1 ? "s" : ""}
          </span>
        </div>
      </header>
      <ul className="roles">
        {group.applications.map((a) => (
          <li key={a.id}>
            <button className="role role-btn" onClick={() => onSelect(a)} title="Open notes & contacts">
              <div className="role-main">
                <span className="role-name">{a.role}</span>
                <span className="muted role-date">{a.lastActivity}</span>
              </div>
              <StatusPill status={a.status} />
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}

function ApplicationPanel({ app, isPro, onClose, onUpgrade }: { app: Application; isPro: boolean; onClose: () => void; onUpgrade: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");

  const load = useCallback(async () => {
    if (!isPro) return;
    setNotes((await getJson<{ notes: Note[] }>(`/api/applications/${enc(app.threadId)}/notes`)).notes);
    setContacts((await getJson<{ contacts: Contact[] }>(`/api/applications/${enc(app.threadId)}/contacts`)).contacts);
  }, [app.threadId, isPro]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function addNote() {
    if (!noteBody.trim()) return;
    await postJson(`/api/applications/${enc(app.threadId)}/notes`, { body: noteBody.trim() });
    setNoteBody("");
    await load();
  }
  async function addContact() {
    if (!cName.trim()) return;
    await postJson(`/api/applications/${enc(app.threadId)}/contacts`, { name: cName.trim(), email: cEmail.trim() || null });
    setCName("");
    setCEmail("");
    await load();
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <h3>{app.company}</h3>
            <span className="muted">
              {app.role} · <StatusPill status={app.status} />
            </span>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </header>

        {!isPro ? (
          <div className="pro-cta">
            <p>📓 Notes &amp; contacts are a Pro feature.</p>
            <button className="btn btn-primary" onClick={onUpgrade}>
              Upgrade to Pro (demo)
            </button>
          </div>
        ) : (
          <>
            <section className="drawer-sec">
              <h4>Notes</h4>
              {notes.length === 0 && <p className="muted">No notes yet.</p>}
              <ul className="plain">
                {notes.map((n) => (
                  <li key={n.id} className="note">
                    {n.body}
                  </li>
                ))}
              </ul>
              <div className="row-form">
                <input value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="Add a note…" />
                <button className="btn" onClick={() => void addNote()}>
                  Add
                </button>
              </div>
            </section>

            <section className="drawer-sec">
              <h4>Contacts</h4>
              {contacts.length === 0 && <p className="muted">No contacts yet.</p>}
              <ul className="plain">
                {contacts.map((c) => (
                  <li key={c.id} className="contact">
                    <strong>{c.name}</strong>
                    {c.email ? <span className="muted"> · {c.email}</span> : null}
                  </li>
                ))}
              </ul>
              <div className="row-form">
                <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Name" />
                <input value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="Email (optional)" />
                <button className="btn" onClick={() => void addContact()}>
                  Add
                </button>
              </div>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
