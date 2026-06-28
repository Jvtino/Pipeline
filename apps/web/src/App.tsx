import { useEffect, useState } from "react";
import type { Board, CompanyGroup, Status } from "@pipeline/contracts";

const STATUS_LABEL: Record<Status, string> = {
  applied: "Active",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

export function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    // The board requires a session. For the demo we auto-create one via the dev
    // login; a production build swaps this for a real sign-in screen (Clerk).
    async function loadBoard(): Promise<Board> {
      let res = await fetch("/api/applications");
      if (res.status === 401) {
        await fetch("/auth/dev/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "demo@pipeline.local" }),
        });
        res = await fetch("/api/applications");
      }
      if (!res.ok) throw new Error(`API responded ${res.status}`);
      return res.json() as Promise<Board>;
    }

    loadBoard()
      .then((b) => {
        if (alive) {
          setBoard(b);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ▦
          </span>{" "}
          Pipeline
        </div>
        <span className="chip">{board ? `${board.source} data` : "…"}</span>
      </header>

      <main>
        {loading && <p className="muted center">Loading your board…</p>}

        {error && (
          <div className="notice error" role="alert">
            <strong>Couldn’t reach the API.</strong> {error}
            <div className="muted">
              Start it with <code>pnpm --filter @pipeline/api dev</code> (expects it on port 3001).
            </div>
          </div>
        )}

        {board && board.groups.length === 0 && <p className="muted center">No applications yet.</p>}

        {board && board.groups.length > 0 && (
          <>
            <section className="stats">
              <Stat label="Total" value={board.counts.total} tone="total" />
              <Stat label="Active" value={board.counts.applied} tone="applied" />
              <Stat label="Interview" value={board.counts.interview} tone="interview" />
              <Stat label="Offer" value={board.counts.offer} tone="offer" />
              <Stat label="Rejected" value={board.counts.rejected} tone="rejected" />
            </section>

            <section className="grid">
              {board.groups.map((g) => (
                <CompanyCard key={g.company} group={g} />
              ))}
            </section>
          </>
        )}
      </main>

      <footer className="foot muted">
        Derived records only — company, role, status, dates &amp; a short snippet. Never your raw email.
      </footer>
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
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="avatar" aria-hidden>
      {letter}
    </div>
  );
}

function CompanyCard({ group }: { group: CompanyGroup }) {
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
          <li key={a.id} className="role">
            <div className="role-main">
              <span className="role-name">{a.role}</span>
              <span className="muted role-date">{a.lastActivity}</span>
            </div>
            <StatusPill status={a.status} />
          </li>
        ))}
      </ul>
    </article>
  );
}
