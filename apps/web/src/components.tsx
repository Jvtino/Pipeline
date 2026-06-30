// Shared presentational components for the redesigned shell: sidebar, header,
// status pills, avatars, the dashboard donut + trend chart, toast, and the
// loading / empty / error state overlays. Colors come from lib/status + avatar.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Screen, Plan } from "./types";
import { STATUS, STATUS_ORDER, type UiStatus } from "./lib/status";
import { tintFor, monogram, initials } from "./lib/avatar";
import { donutSegments, DONUT_C, type DonutSegment } from "./lib/derive";
import type { UiApplication } from "./types";
import {
  Logo,
  IconDashboard,
  IconApplications,
  IconCompanies,
  IconContacts,
  IconCalendar,
  IconTasks,
  IconStatistics,
  IconDocuments,
  IconTemplates,
  IconSettings,
  IconChevronRight,
  IconSearch,
  IconRefresh,
  IconPlus,
  IconBell,
  IconCheck,
  IconCloudOff,
  IconBox,
  IconMail,
} from "./lib/icons";

/* ---- nav config ----------------------------------------------------------- */
export const NAV: { key: Screen; label: string; Icon: typeof IconDashboard }[] = [
  { key: "dashboard", label: "Dashboard", Icon: IconDashboard },
  { key: "applications", label: "Applications", Icon: IconApplications },
  { key: "companies", label: "Companies", Icon: IconCompanies },
  { key: "contacts", label: "Contacts", Icon: IconContacts },
  { key: "calendar", label: "Calendar", Icon: IconCalendar },
  { key: "tasks", label: "Tasks", Icon: IconTasks },
  { key: "statistics", label: "Statistics", Icon: IconStatistics },
  { key: "documents", label: "Documents", Icon: IconDocuments },
  { key: "templates", label: "Templates", Icon: IconTemplates },
  { key: "settings", label: "Settings", Icon: IconSettings },
];

export const screenTitle = (s: Screen): string => NAV.find((n) => n.key === s)?.label ?? "Pipeline";

/* ---- status pill ---------------------------------------------------------- */
export function StatusPill({ status, sm }: { status: UiStatus; sm?: boolean }) {
  const s = STATUS[status];
  return (
    <span className={`pill${sm ? " sm" : ""}`} style={{ color: s.fg, background: s.bg }}>
      <span className="dot" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

/* ---- avatars -------------------------------------------------------------- */
export function CompanyAvatar({ name, size = 32, radius = 9, font = 13 }: { name: string; size?: number; radius?: number; font?: number }) {
  const t = tintFor(name);
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        display: "grid",
        placeItems: "center",
        font: `700 ${font}px var(--sans)`,
        flex: "0 0 auto",
        background: t.mbg,
        color: t.mfg,
      }}
    >
      {monogram(name)}
    </span>
  );
}

// A real company logo from a free service (Clearbit logo, then Google's favicon),
// layered over the lettered monogram. The monogram is always the base, so a
// slow, missing, or blocked logo shows the avatar — never a blank box. The logo
// follows the sender's domain; fictional/unknown companies just keep the monogram.
// Common mail/ATS sender subdomains stripped so the logo service resolves the
// real site (mail.notion.so → notion.so, hire.lever.co → lever.co).
const LOGO_PREFIX = /^(www|mail|email|e|smtp|jobs|job|careers|career|apply|applications?|recruiting|recruit|hire|hiring|talent|notifications?|no-?reply|reply|hello|team)\./;

export function CompanyLogo({ name, domain, size = 42, radius = 12, font = 17 }: { name: string; domain?: string; size?: number; radius?: number; font?: number }) {
  const host = (domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/:].*$/, "")
    .replace(LOGO_PREFIX, "");
  const sources = host ? [`https://logo.clearbit.com/${host}?size=128`, `https://www.google.com/s2/favicons?domain=${host}&sz=128`] : [];
  const [tier, setTier] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = sources[tier];
  return (
    <span style={{ position: "relative", width: size, height: size, flex: "0 0 auto", display: "inline-block" }}>
      <CompanyAvatar name={name} size={size} radius={radius} font={font} />
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => { setLoaded(false); setTier((t) => t + 1); }}
          style={{ position: "absolute", inset: 0, width: size, height: size, borderRadius: radius, objectFit: "contain", background: "#fff", border: "1px solid rgba(34,31,26,.08)", opacity: loaded ? 1 : 0, transition: "opacity .15s" }}
        />
      )}
    </span>
  );
}

export function PersonAvatar({ name, company, size = 46, round = true }: { name: string; company?: string; size?: number; round?: boolean }) {
  const t = tintFor(company ?? name);
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: round ? "50%" : 11,
        display: "grid",
        placeItems: "center",
        font: `700 ${Math.round(size / 2.7)}px var(--sans)`,
        flex: "0 0 auto",
        background: t.mbg,
        color: t.mfg,
      }}
    >
      {initials(name)}
    </span>
  );
}

/* ---- sidebar -------------------------------------------------------------- */
export function Sidebar({ active, onNav, me }: { active: Screen; onNav: (s: Screen) => void; me: Plan | null }) {
  const email = me?.email ?? "you@gmail.com";
  const name = (email.split("@")[0] ?? "you").replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const [connectOpen, setConnectOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the connect popover on an outside click or Escape.
  useEffect(() => {
    if (!connectOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setConnectOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConnectOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [connectOpen]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo />
        <span className="brand-name">Pipeline</span>
      </div>
      <nav className="nav">
        {NAV.map(({ key, label, Icon }) => (
          <button key={key} className={`pl-nav${active === key ? " active" : ""}`} onClick={() => onNav(key)}>
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="userchip-wrap" ref={wrapRef}>
        {connectOpen && (
          <div className="connect-pop" role="menu" aria-label="Connect your email">
            <div className="connect-pop-title">Connect your email</div>
            <div className="connect-pop-sub">Read-only — we store derived records, never your raw mail.</div>
            <a className="connect-pop-btn" href="/auth/google/start" role="menuitem">
              <IconMail size={17} color="#c06a57" />
              Connect Gmail
            </a>
            <a className="connect-pop-btn" href="/auth/microsoft/start" role="menuitem">
              <IconMail size={17} color="#6c7d96" />
              Connect Outlook
            </a>
          </div>
        )}
        <button
          type="button"
          className={`userchip${connectOpen ? " open" : ""}`}
          onClick={() => setConnectOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={connectOpen}
          title="Connect your email"
        >
          <span className="userchip-avatar">{(name[0] || "A").toUpperCase()}</span>
          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <div className="userchip-name">{name || "You"}</div>
            <div className="userchip-email">{email}</div>
          </div>
          <IconChevronRight size={16} color="#b3ab9e" stroke={2} className={`chev${connectOpen ? " chev-open" : ""}`} />
        </button>
      </div>
    </aside>
  );
}

/* ---- header --------------------------------------------------------------- */
export function Header({
  title,
  q,
  onSearch,
  email,
  syncLabel,
  syncing,
  onSync,
  onNewApp,
}: {
  title: string;
  q: string;
  onSearch: (v: string) => void;
  email: string;
  syncLabel: string;
  syncing: boolean;
  onSync: () => void;
  onNewApp: () => void;
}) {
  return (
    <header className="header">
      <div className="screen-title">{title}</div>
      <span className="spacer" />
      <div className="search">
        <IconSearch size={15} color="#b3ab9e" />
        <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search applications, companies…" />
      </div>
      <div className="mailbox-chip">
        <span className="mailbox-dot" />
        <span className="mailbox-email">{email}</span>
        <span className="mailbox-sync">· {syncLabel}</span>
      </div>
      <button className="btn" onClick={onSync} disabled={syncing}>
        <IconRefresh size={15} className={syncing ? "spin" : undefined} />
        {syncing ? "Syncing…" : "Run sync"}
      </button>
      <button className="btn btn-primary" onClick={onNewApp}>
        <IconPlus size={15} />
        New Application
      </button>
      <button className="iconbtn" aria-label="Notifications">
        <IconBell size={17} color="#6f685d" />
        <span className="bell-dot" />
      </button>
    </header>
  );
}

/* ---- donut ---------------------------------------------------------------- */
export function Donut({ apps }: { apps: UiApplication[] }) {
  const { segments, total } = donutSegments(apps);
  const legend: DonutSegment[] = segments.length ? segments : [];
  return (
    <div className="card card-pad">
      <div className="cardtitle">Application Status</div>
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 14 }}>
        <div style={{ position: "relative", flex: "0 0 auto" }}>
          <svg width="158" height="158" viewBox="0 0 180 180">
            <g transform="rotate(-90 90 90)" fill="none" strokeWidth="22">
              {total === 0 ? (
                <circle cx="90" cy="90" r="70" stroke="#efe9df" />
              ) : (
                segments.map((s) => (
                  <circle
                    key={s.status}
                    cx="90"
                    cy="90"
                    r="70"
                    stroke={s.color}
                    strokeDasharray={`${s.dash} ${DONUT_C - s.dash}`}
                    strokeDashoffset={s.offset}
                  />
                ))
              )}
            </g>
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ font: "700 26px var(--sans)", letterSpacing: "-.02em" }}>{total}</div>
            <div style={{ font: "500 11px var(--sans)", color: "var(--muted-2)" }}>applications</div>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {legend.map((s) => (
            <div key={s.status} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color }} />
              <span style={{ flex: 1, font: "500 12px var(--sans)", color: "#5f5a51" }}>{STATUS[s.status].label}</span>
              <span style={{ font: "600 11.5px var(--mono)", color: "var(--muted)" }}>{s.count}</span>
            </div>
          ))}
          {legend.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No applications yet.</span>}
        </div>
      </div>
    </div>
  );
}

/* ---- trend chart ---------------------------------------------------------- */
export function TrendChart({ labels, counts, control }: { labels: string[]; counts: number[]; control?: ReactNode }) {
  const W = 460;
  const yTop = 40;
  const yBot = 168;
  const max = Math.max(1, ...counts);
  const n = counts.length;
  const xs = counts.map((_, i) => (n > 1 ? 16 + (i * (W - 32)) / (n - 1) : W / 2));
  const ys = counts.map((c) => yBot - (c / max) * (yBot - yTop));
  const pt = (i: number) => ({ x: xs[i] ?? 0, y: ys[i] ?? yBot });
  const line = xs.map((_, i) => `${i === 0 ? "M" : "L"} ${pt(i).x.toFixed(0)} ${pt(i).y.toFixed(0)}`).join(" ");
  const area = n > 0 ? `${line} L ${pt(n - 1).x.toFixed(0)} ${yBot} L ${pt(0).x.toFixed(0)} ${yBot} Z` : "";
  return (
    <div className="card card-pad">
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="cardtitle" style={{ flex: 1 }}>Applications Over Time</div>
        {control}
      </div>
      <svg width="100%" height="196" viewBox="0 0 460 196" preserveAspectRatio="none" style={{ marginTop: 10, overflow: "visible" }}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a4a40" stopOpacity=".18" />
            <stop offset="1" stopColor="#2a4a40" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="40" x2="460" y2="40" stroke="rgba(34,31,26,.07)" />
        <line x1="0" y1="90" x2="460" y2="90" stroke="rgba(34,31,26,.07)" />
        <line x1="0" y1="140" x2="460" y2="140" stroke="rgba(34,31,26,.07)" />
        <path d={area} fill="url(#trend-fill)" />
        <path d={line} fill="none" stroke="#2a4a40" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r={i === n - 1 ? 4.5 : 3.5} fill="#2a4a40" stroke={i === n - 1 ? "#fffdf9" : undefined} strokeWidth={i === n - 1 ? 2 : undefined} />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, padding: "0 8px" }}>
        {labels.map((m, i) => (
          <span key={i} style={{ font: "500 10.5px var(--mono)", color: "var(--faint)" }}>{m}</span>
        ))}
      </div>
    </div>
  );
}

/* ---- toast ---------------------------------------------------------------- */
export function Toast({ msg }: { msg: string }) {
  return (
    <div className="toast" role="status">
      <span className="check">
        <IconCheck size={13} color="#9fe3c0" stroke={2.6} />
      </span>
      {msg}
    </div>
  );
}

/* ---- state overlays ------------------------------------------------------- */
export function StateLoading() {
  const sk = (h: number, r = 14): CSSProperties => ({ height: h, borderRadius: r });
  return (
    <div className="state-overlay">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 13 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="pl-sk" style={sk(84)} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 14, marginTop: 14 }}>
        <div className="pl-sk" style={sk(236, 16)} />
        <div className="pl-sk" style={sk(236, 16)} />
      </div>
      <div className="pl-sk" style={{ height: 150, borderRadius: 16, marginTop: 14 }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 34, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, font: "600 12.5px var(--sans)", color: "#a89e8c" }}>
        <span className="spinner" />
        Syncing your inbox…
      </div>
    </div>
  );
}

export function StateError({ onRetry, onCheck }: { onRetry: () => void; onCheck: () => void }) {
  return (
    <div className="state-center">
      <div style={{ textAlign: "center", maxWidth: 392 }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: "#f9ecea", display: "grid", placeItems: "center", margin: "0 auto 18px" }}>
          <IconCloudOff size={30} color="#c06a57" />
        </div>
        <div style={{ font: "500 21px var(--serif)", color: "var(--text)" }}>We couldn’t reach your inbox</div>
        <div style={{ font: "400 14px/1.6 var(--sans)", color: "#7a7468", marginTop: 9 }}>
          Your last sync didn’t finish — usually a dropped connection. Everything already saved is safe.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          <button className="btn btn-primary" onClick={onRetry}>
            <IconRefresh size={15} />
            Try again
          </button>
          <button className="btn" onClick={onCheck}>Check connection</button>
        </div>
      </div>
    </div>
  );
}

export function StateEmpty({
  title,
  sub,
  primary,
  onPrimary,
  secondary,
  onSecondary,
}: {
  title: string;
  sub: string;
  primary?: string;
  onPrimary?: () => void;
  secondary?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="state-center">
      <div style={{ textAlign: "center", maxWidth: 404 }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: "#efe9df", display: "grid", placeItems: "center", margin: "0 auto 18px" }}>
          <IconBox size={30} color="#b3a37e" />
        </div>
        <div style={{ font: "500 22px var(--serif)", color: "var(--text)" }}>{title}</div>
        <div style={{ font: "400 14px/1.6 var(--sans)", color: "#7a7468", marginTop: 9 }}>{sub}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          {primary && (
            <button className="btn btn-primary" onClick={onPrimary}>{primary}</button>
          )}
          {secondary && (
            <button className="btn" onClick={onSecondary}>
              <IconRefresh size={15} />
              {secondary}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- small reusable: eyebrow with count chip ------------------------------ */
export function CountChip({ children }: { children: ReactNode }) {
  return <span style={{ font: "600 11px var(--mono)", color: "var(--faint-2)", background: "#efe9df", padding: "1px 7px", borderRadius: 6 }}>{children}</span>;
}

export { STATUS_ORDER };
