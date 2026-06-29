import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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

const FREE_COMPANY_LIMIT = 20; // free plan shows the 20 most recent companies; rest are blurred
const FREE_ROLE_LIMIT = 4; // and only the 4 most recent roles per company

type SortMode = "recent" | "az" | "count";

/** Deterministic hue from a company name, for the colored avatar (desktop look). */
function hueFromName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** "3d ago" / "2mo ago" from an ISO date (yyyy-mm-dd). */
function timeAgo(iso: string): string {
  if (!iso) return "";
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  if (Number.isNaN(then)) return iso;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

type Toast = { type: "ok" | "err"; msg: string };
// Toast shown when the OAuth callback redirects back with ?connect=<status>.
// `ok` additionally kicks off a sync (handled separately); any unknown status falls back to `error`.
const CONNECT_TOASTS: { error: Toast; [status: string]: Toast } = {
  ok: { type: "ok", msg: "Mailbox connected — syncing your applications…" },
  unconfigured: { type: "err", msg: "That mailbox provider isn’t set up yet — add your OAuth client IDs (see DEPLOY.md)." },
  error: { type: "err", msg: "Mailbox connection failed or was cancelled." },
};

// Returns true if there's an authenticated session. Tries a frictionless demo
// login, which succeeds only when no hosted gate (passphrase) is configured —
// on a gated/hosted instance it fails and the app shows the sign-in screen.
async function ensureSession(): Promise<boolean> {
  const me = await fetch("/auth/me");
  if (me.ok) return true;
  const r = await fetch("/auth/dev/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "demo@pipeline.local" }) });
  return r.ok;
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

// Sign-in screen, shown only when the API is gated (a hosted instance with a
// passphrase set). On a local/ungated instance the silent demo login succeeds
// and this never renders.
function LoginScreen({ onLogin }: { onLogin: (email: string, passphrase: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onLogin(email.trim(), passphrase);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <span className="logo" aria-hidden>▦</span> <strong>Pipeline</strong>
        </div>
        <p className="muted">Sign in to your board.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Passphrase
          <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="current-password" required />
        </label>
        {err && <div className="login-err" role="alert">{err}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
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
  const [needsLogin, setNeedsLogin] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");

  const isPro = me?.plan === "pro" || me?.plan === "teams";

  // Free: search/sort off, board ordered newest-first by the API. Pro: live search + sort.
  const orderedGroups = useMemo(() => {
    let gs = board?.groups ?? [];
    if (isPro && query.trim()) {
      const q = query.trim().toLowerCase();
      gs = gs.filter(
        (g) => g.company.toLowerCase().includes(q) || g.applications.some((a) => a.role.toLowerCase().includes(q)),
      );
    }
    if (isPro && sort !== "recent") {
      gs = [...gs].sort((a, b) =>
        sort === "az" ? a.company.localeCompare(b.company) : b.applications.length - a.applications.length,
      );
    }
    return gs;
  }, [board, isPro, query, sort]);

  const visibleGroups = isPro ? orderedGroups : orderedGroups.slice(0, FREE_COMPANY_LIMIT);
  const lockedGroups = isPro ? [] : orderedGroups.slice(FREE_COMPANY_LIMIT);

  const refresh = useCallback(async () => {
    if (!(await ensureSession())) {
      setNeedsLogin(true);
      return;
    }
    setNeedsLogin(false);
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
      const res = await postJson<{ connections: number }>("/api/sync");
      await refresh();
      setToast({ type: "ok", msg: res.connections ? `Synced ${res.connections} mailbox(es).` : "No mailbox connected yet — use Connect." });
    } catch {
      setToast({ type: "err", msg: "Sync failed. Is a mailbox connected?" });
    } finally {
      setSyncing(false);
    }
  }

  async function doRebuild() {
    if (!window.confirm("Re-sync your mailboxes from scratch and drop mis-classified items (marketing, account alerts)? Your notes and contacts are kept.")) return;
    setConnectOpen(false);
    setSyncing(true);
    try {
      const res = await postJson<{ connections: number }>("/api/sync", { rebuild: true });
      await refresh();
      setToast({ type: "ok", msg: res.connections ? "Rebuilt your board from a fresh sync." : "No mailbox connected yet — use Connect." });
    } catch {
      setToast({ type: "err", msg: "Rebuild failed — try again in a moment." });
    } finally {
      setSyncing(false);
    }
  }

  async function login(email: string, passphrase: string) {
    const r = await fetch("/auth/dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, passphrase }),
    });
    if (!r.ok) {
      throw new Error(
        r.status === 401 ? "Wrong passphrase." : r.status === 403 ? "That email isn’t allowed on this instance." : "Sign-in failed.",
      );
    }
    setLoading(true);
    await refresh();
    setLoading(false);
  }

  if (needsLogin) return <LoginScreen onLogin={login} />;

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
                <div className="connect-note muted">Requires your OAuth client IDs (see DEPLOY.md).</div>
                <button type="button" className="connect-item connect-action" onClick={() => void doRebuild()} disabled={syncing}>
                  Rebuild board
                </button>
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

            {isPro && (
              <div className="toolbar">
                <input
                  className="search"
                  placeholder="Search company or role…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search"
                />
                <select className="sort" value={sort} onChange={(e) => setSort(e.target.value as SortMode)} aria-label="Sort">
                  <option value="recent">Most recent</option>
                  <option value="az">A–Z</option>
                  <option value="count">Most roles</option>
                </select>
              </div>
            )}

            <section className="grid">
              {visibleGroups.map((g) => (
                <CompanyCard key={g.company} group={g} limit={isPro ? undefined : FREE_ROLE_LIMIT} onSelect={setSelected} />
              ))}
            </section>

            {lockedGroups.length > 0 && (
              <div className="locked">
                <section className="grid locked-grid" aria-hidden>
                  {lockedGroups.slice(0, 6).map((g) => (
                    <CompanyCard key={g.company} group={g} limit={FREE_ROLE_LIMIT} onSelect={() => {}} />
                  ))}
                </section>
                <div className="locked-overlay">
                  <div className="locked-cta">
                    <div className="locked-lock" aria-hidden>🔒</div>
                    <h3>
                      {lockedGroups.length} more {lockedGroups.length === 1 ? "company" : "companies"}
                    </h3>
                    <p className="muted">
                      Free shows your 20 most recent companies. Upgrade to Pro to see your whole pipeline — plus search &amp; sort.
                    </p>
                    <button className="btn btn-primary" onClick={() => void setPlan("pro")}>
                      Upgrade to Pro
                    </button>
                  </div>
                </div>
              </div>
            )}
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
  const hue = hueFromName(name);
  return (
    <div className="avatar" style={{ background: `hsl(${hue} 45% 20%)`, color: `hsl(${hue} 80% 74%)` }} aria-hidden>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function CompanyCard({ group, onSelect, limit }: { group: CompanyGroup; onSelect: (a: Application) => void; limit?: number }) {
  const all = group.applications;
  const shown = limit ? all.slice(0, limit) : all;
  const hidden = all.length - shown.length;
  return (
    <article className="card">
      <header className="card-head">
        <Avatar name={group.company} />
        <div className="card-title">
          <h2>{group.company}</h2>
          <span className="muted">
            {all.length} role{all.length > 1 ? "s" : ""}
          </span>
        </div>
        <div className="card-dots" aria-hidden>
          {all.slice(0, 8).map((a) => (
            <span key={a.id} className={`mini-dot s-${a.status}`} title={STATUS_LABEL[a.status]} />
          ))}
          {all.length > 8 && <span className="dots-more">+{all.length - 8}</span>}
        </div>
      </header>
      <ul className={limit ? "roles" : "roles roles--scroll"}>
        {shown.map((a) => (
          <li key={a.id}>
            <button className="role role-btn" onClick={() => onSelect(a)} title="Open notes & contacts">
              <span className={`mini-dot s-${a.status}`} aria-hidden />
              <div className="role-main">
                <span className="role-name">{a.role}</span>
                <span className="muted role-date">{timeAgo(a.lastActivity)}</span>
              </div>
              <StatusPill status={a.status} />
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 && <div className="roles-more muted">+{hidden} more</div>}
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
