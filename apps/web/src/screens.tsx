// The ten content screens of the redesign. Each reads the shared Ctx (derived
// from the real Board + overlay) and renders the warm-light design. Per-screen
// layout uses design-system classes from styles.css plus a few inline grids.
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Ctx } from "./ctx";
import type { UiApplication } from "./types";
import { STATUS, STATUS_ORDER, NEW_APP_STATUSES, type UiStatus } from "./lib/status";
import {
  buildNudges,
  statusCounts,
  topSources,
  trendSeries,
  companyCards,
  deriveTasks,
  calendarFor,
  computeStats,
  volumeStats,
  sourcePerformance,
  rolePerformance,
  workTypePerformance,
  locationPerformance,
  resumePerformance,
  companyInsights,
  timingStats,
  salaryStats,
  responseByWeek,
  type PerfRow,
} from "./lib/derive";
import { MONTHS } from "./lib/format";
import { CompanyAvatar, CompanyLogo, PersonAvatar, StatusPill, Donut, TrendChart, CountChip } from "./components";
import { IconBolt, IconChevronRight, IconSearch, IconMail, IconDownload, IconPlus, IconShield, IconCheck } from "./lib/icons";

const CARD = "card card-pad";

/* ============================================================================
   DASHBOARD
   ========================================================================== */
function StatCard({ label, value, color, sub, delta }: { label: string; value: number; color?: string; sub: string; delta?: { pct: number } }) {
  return (
    <div className="card" style={{ padding: "15px 16px" }}>
      <div style={{ font: "500 12px var(--sans)", color: "var(--muted)" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 9 }}>
        <div style={{ font: "700 28px/1 var(--sans)", letterSpacing: "-.02em", color }}>{value}</div>
        {delta && (
          <div style={{ font: "600 11px var(--mono)", color: delta.pct >= 0 ? "#1f7a52" : "#a85544", marginBottom: 2 }}>
            {delta.pct >= 0 ? "↑" : "↓"} {Math.abs(delta.pct)}%
          </div>
        )}
      </div>
      <div style={{ font: "500 11px var(--sans)", color: "var(--faint)", marginTop: 6 }}>{sub}</div>
    </div>
  );
}

export function Dashboard(ctx: Ctx) {
  const { apps, nowMs, openDetail, goto } = ctx;
  const counts = statusCounts(apps);
  const nudges = buildNudges(apps, nowMs);
  const sources = topSources(apps);
  const trend = trendSeries(apps, nowMs);
  const recent = apps.slice(0, 6);
  const pct = (n: number) => (counts.total ? Math.round((n / counts.total) * 100) : 0);
  const thisM = trend.counts[trend.counts.length - 1] ?? 0;
  const lastM = trend.counts[trend.counts.length - 2] ?? 0;
  const totalDelta = lastM ? { pct: Math.round(((thisM - lastM) / lastM) * 100) } : undefined;

  return (
    <div>
      {nudges.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
            <IconBolt size={17} color="#c08a2a" />
            <span style={{ font: "600 14px var(--sans)" }}>Needs you today</span>
            <CountChip>{nudges.length}</CountChip>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, nudges.length)},1fr)`, gap: 13, marginBottom: 18 }}>
            {nudges.map((z) => (
              <div
                key={z.appId + z.tag}
                className="card pl-lift"
                onClick={() => openDetail(z.appId)}
                style={{ borderLeft: `3px solid ${z.color}`, padding: "15px 16px", cursor: "pointer", borderRadius: 14 }}
              >
                <span style={{ font: "700 9px var(--mono)", letterSpacing: ".07em", textTransform: "uppercase", color: z.color, background: z.bg, padding: "3px 7px", borderRadius: 5 }}>
                  {z.tag}
                </span>
                <div style={{ font: "600 13.5px/1.3 var(--sans)", color: "#2a2620", marginTop: 11 }}>{z.title}</div>
                <div style={{ font: "500 12px var(--sans)", color: "#8a847a", marginTop: 4 }}>{z.sub}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 12, font: "600 12px var(--sans)", color: "var(--primary)" }}>
                  {z.cta}
                  <IconChevronRight size={13} stroke={2.2} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 13 }}>
        <StatCard label="Total Applications" value={counts.total} sub="vs last month" delta={totalDelta} />
        <StatCard label="In Interview" value={counts.interview} color="#9a6a16" sub="in your pipeline" />
        <StatCard label="Offers" value={counts.offer} color="#1f7a52" sub="in play" />
        <StatCard label="Rejected" value={counts.rejected} color="#a85544" sub={`${pct(counts.rejected)}% of total`} />
        <StatCard label="No Response" value={counts.no_response} color="#857a64" sub={`${pct(counts.no_response)}% awaiting reply`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 14, marginTop: 14 }}>
        <Donut apps={apps} />
        <TrendChart labels={trend.labels} counts={trend.counts} control={<div style={{ font: "500 11.5px var(--sans)", color: "var(--muted)", padding: "5px 10px", border: "1px solid rgba(34,31,26,.12)", borderRadius: 8 }}>Last 6 months ▾</div>} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14, marginTop: 14 }}>
        <div className={CARD}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
            <div className="cardtitle" style={{ flex: 1 }}>Recent Applications</div>
            <span onClick={() => goto("applications")} style={{ font: "600 12px var(--sans)", color: "var(--primary)", cursor: "pointer" }}>View all</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.3fr auto auto", gap: "8px 12px", padding: "8px 2px", borderBottom: "1px solid rgba(34,31,26,.07)", font: "600 10.5px var(--mono)", letterSpacing: ".04em", textTransform: "uppercase", color: "var(--faint)" }}>
            <span>Company</span>
            <span>Position</span>
            <span>Status</span>
            <span style={{ textAlign: "right" }}>Applied</span>
          </div>
          {recent.length === 0 && <div className="muted" style={{ padding: "18px 2px", fontSize: 12.5 }}>No applications yet.</div>}
          {recent.map((a) => (
            <div key={a.id} className="hover-row" onClick={() => openDetail(a.id)} style={{ display: "grid", gridTemplateColumns: "1.4fr 1.3fr auto auto", gap: "8px 12px", alignItems: "center", padding: "9px 2px", borderBottom: "1px solid rgba(34,31,26,.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <CompanyAvatar name={a.company} size={28} radius={8} font={12} />
                <span style={{ font: "600 12.5px var(--sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.company}</span>
              </div>
              <span style={{ font: "500 12.5px var(--sans)", color: "#5f5a51", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.role}</span>
              <StatusPill status={a.status} sm />
              <span style={{ font: "500 11.5px var(--mono)", color: "var(--muted-2)", textAlign: "right" }}>{a.dateLabel}</span>
            </div>
          ))}
        </div>

        <div className={CARD}>
          <div className="cardtitle" style={{ marginBottom: 14 }}>Top Sources</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {sources.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No sources yet.</span>}
            {sources.map((s, i) => (
              <div key={s.label}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ font: "550 12px var(--sans)" }}>{s.label}</span>
                  <span style={{ font: "600 11.5px var(--mono)", color: "var(--muted)" }}>{s.count}</span>
                </div>
                <div style={{ height: 8, borderRadius: 5, background: "#efe9df", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${s.pct}%`, background: ["#2a4a40", "#3f7363", "#6c7d96", "#c08a2a", "#b0a48f"][i] ?? "#3f7363", borderRadius: 5 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   APPLICATIONS
   ========================================================================== */
export function Applications(ctx: Ctx) {
  const { apps, q, appTab, setAppTab, openDetail, newIds, onNewApp, onSync } = ctx;
  const counts = statusCounts(apps);
  const query = q.trim().toLowerCase();
  const rows = apps.filter(
    (a) => (appTab === "all" || a.status === appTab) && (!query || a.company.toLowerCase().includes(query) || a.role.toLowerCase().includes(query)),
  );
  const tabs: { key: UiStatus | "all"; label: string; count: number }[] = [
    { key: "all", label: "All", count: apps.length },
    ...STATUS_ORDER.map((s) => ({ key: s, label: STATUS[s].label, count: counts[s] })),
  ];
  const grid = "1.5fr 1.6fr 1fr .9fr 1.2fr .9fr 30px";
  const filtered = !!query || appTab !== "all";

  if (apps.length === 0) {
    return (
      <EmptyInline
        title="No applications yet"
        sub="Connect your inbox to import them automatically, or add one by hand to start tracking."
        primary="Add application"
        onPrimary={onNewApp}
        secondary="Run sync"
        onSecondary={onSync}
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t.key} className={`pl-tab${appTab === t.key ? " active" : ""}`} onClick={() => setAppTab(t.key)}>
            {t.label}
            <span className="count">{t.count}</span>
          </button>
        ))}
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: grid, gap: 14, padding: "13px 18px", background: "var(--table-head)", borderBottom: "1px solid var(--card-border)", font: "600 10.5px var(--mono)", letterSpacing: ".04em", textTransform: "uppercase", color: "#9b9082" }}>
          <span>Company</span>
          <span>Position</span>
          <span>Status</span>
          <span>Applied</span>
          <span>Next Step</span>
          <span>Source</span>
          <span />
        </div>
        {rows.map((a) => (
          <div key={a.id} className="hover-row" onClick={() => openDetail(a.id)} style={{ display: "grid", gridTemplateColumns: grid, gap: 14, alignItems: "center", padding: "13px 18px", borderBottom: "1px solid rgba(34,31,26,.05)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <CompanyAvatar name={a.company} />
              <span style={{ font: "600 13px var(--sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.company}</span>
              {newIds.has(a.id) && (
                <span style={{ font: "700 8px var(--mono)", letterSpacing: ".08em", color: "#1f7a52", background: "rgba(47,146,102,.16)", padding: "2px 5px", borderRadius: 4, flex: "0 0 auto" }}>NEW</span>
              )}
            </div>
            <span style={{ font: "500 13px var(--sans)", color: "#4f4a42", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.role}</span>
            <StatusPill status={a.status} />
            <span style={{ font: "500 12px var(--mono)", color: "var(--muted)" }}>{a.dateLabel}</span>
            <span style={{ font: "500 12.5px var(--sans)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nextStep}</span>
            <span style={{ font: "500 12px var(--sans)", color: "var(--muted-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.source}</span>
            <span style={{ display: "grid", placeItems: "center", color: "var(--faint-2)" }}>›</span>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "46px 20px" }}>
            <div style={{ width: 46, height: 46, borderRadius: 13, background: "#efe9df", display: "grid", placeItems: "center", marginBottom: 13 }}>
              <IconSearch size={21} color="#b3a37e" stroke={1.8} />
            </div>
            <div style={{ font: "600 14.5px var(--sans)", color: "#3f3a33" }}>{filtered ? "No applications match this view" : "No applications yet"}</div>
            <div style={{ font: "500 12.5px var(--sans)", color: "var(--muted-2)", marginTop: 4 }}>{filtered ? "Try a different status or clear your search." : "Run a sync or add one to get started."}</div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", padding: "13px 18px" }}>
          <span style={{ font: "500 12px var(--sans)", color: "var(--muted-2)" }}>
            Showing {rows.length} of {apps.length} applications
          </span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   COMPANIES
   ========================================================================== */
export function Companies(ctx: Ctx) {
  const cards = companyCards(ctx.apps);
  if (cards.length === 0) return <EmptyInline title="No companies yet" sub="Companies appear here as applications come in." />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
      {cards.map((c) => {
        const top = STATUS[c.topStatus];
        return (
          <div key={c.company} className="card hover-border" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <CompanyLogo name={c.company} domain={c.domain} size={42} radius={12} font={17} />
              <div style={{ minWidth: 0 }}>
                <div style={{ font: "650 14.5px var(--sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.company}</div>
                <div style={{ font: "500 11.5px var(--sans)", color: "var(--muted-2)" }}>{c.sub}</div>
              </div>
            </div>
            <div style={{ height: 1, background: "rgba(34,31,26,.07)", margin: "13px 0" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 9px", borderRadius: 999, font: "600 10.5px var(--mono)", color: top.fg, background: top.bg }}>{top.label}</span>
              <div style={{ display: "flex", gap: 4 }}>
                {c.dots.map((d, i) => (
                  <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS[d].dot }} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================================
   CONTACTS
   ========================================================================== */
export function Contacts(ctx: Ctx) {
  const list = ctx.overlay.contacts;
  if (list.length === 0) {
    return <EmptyInline title="No contacts yet" sub="Add the recruiters and hiring managers you’re talking to from any application’s Contacts tab and they’ll appear here." />;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
      {list.map((k) => (
        <div key={k.id} className="card hover-border" style={{ padding: 17 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <PersonAvatar name={k.name} company={k.company} />
            <div style={{ minWidth: 0 }}>
              <div style={{ font: "650 14.5px var(--sans)" }}>{k.name}</div>
              <div style={{ font: "500 12px var(--sans)", color: "var(--muted-2)" }}>{k.title || "—"}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, paddingTop: 13, borderTop: "1px solid rgba(34,31,26,.07)" }}>
            <CompanyAvatar name={k.company} size={24} radius={7} font={10} />
            <span style={{ font: "600 12px var(--sans)", color: "#5f5a51", flex: 1 }}>{k.company}</span>
          </div>
          {k.email && (
            <div style={{ font: "500 12px var(--sans)", color: "#7e88a0", marginTop: 11, display: "flex", alignItems: "center", gap: 7 }}>
              <IconMail size={13} color="#9aa3b5" />
              {k.email}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ============================================================================
   CALENDAR
   ========================================================================== */
export function Calendar(ctx: Ctx) {
  const now = new Date(ctx.nowMs);
  const [ym, setYm] = useState({ y: now.getUTCFullYear(), m: now.getUTCMonth() });
  const cells = useMemo(() => calendarFor(ctx.apps, ym.y, ym.m), [ctx.apps, ym]);
  const shift = (d: number) => {
    const next = new Date(Date.UTC(ym.y, ym.m + d, 1));
    setYm({ y: next.getUTCFullYear(), m: next.getUTCMonth() });
  };
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span onClick={() => setYm({ y: now.getUTCFullYear(), m: now.getUTCMonth() })} className="btn" style={{ padding: "8px 14px", color: "#3f4a44" }}>Today</span>
        <span onClick={() => shift(-1)} style={{ display: "grid", placeItems: "center", width: 32, height: 32, border: "1px solid rgba(34,31,26,.12)", borderRadius: 9, color: "var(--text-3)", cursor: "pointer" }}>‹</span>
        <span onClick={() => shift(1)} style={{ display: "grid", placeItems: "center", width: 32, height: 32, border: "1px solid rgba(34,31,26,.12)", borderRadius: 9, color: "var(--text-3)", cursor: "pointer" }}>›</span>
        <div style={{ font: "600 18px var(--sans)", letterSpacing: "-.01em" }}>{MONTHS[ym.m]} {ym.y}</div>
        <span className="spacer" />
        <div className="segmented">
          <button className="active">Month</button>
          <button>Week</button>
          <button>List</button>
        </div>
      </div>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 7, marginBottom: 8 }}>
          {days.map((d) => (
            <span key={d} style={{ textAlign: "center", font: "600 10.5px var(--mono)", letterSpacing: ".05em", color: "var(--faint)" }}>{d}</span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 7 }}>
          {cells.map((c, i) => (
            <div key={i} style={{ minHeight: 96, border: "1px solid rgba(34,31,26,.06)", borderRadius: 9, padding: "7px 8px", background: c.day ? "#fffefb" : "transparent" }}>
              {c.day && <div style={{ font: "600 12px var(--mono)", color: "var(--muted-2)" }}>{c.day}</div>}
              {c.events.map((e, j) => (
                <div key={j} onClick={() => ctx.openDetail(e.appId)} className="pl-lift" style={{ marginTop: 6, padding: "4px 7px", borderRadius: 6, cursor: "pointer", font: "600 9.5px/1.25 var(--sans)", color: e.fg, background: e.bg }}>
                  {e.label}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   TASKS
   ========================================================================== */
export function Tasks(ctx: Ctx) {
  const tasks = deriveTasks(ctx.apps, ctx.nowMs);
  const groups: ("Today" | "This week" | "Later")[] = ["Today", "This week", "Later"];
  const hasAny = tasks.length > 0;
  if (!hasAny) return <EmptyInline title="You’re all caught up" sub="No tasks right now — new ones appear automatically as interviews and follow-ups come due." />;
  return (
    <div style={{ maxWidth: 720 }}>
      {groups.map((g) => {
        const items = tasks.filter((t) => t.group === g);
        if (items.length === 0) return null;
        return (
          <div key={g} style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
              <span className="eyebrow">{g}</span>
              <CountChip>{items.length}</CountChip>
              <span style={{ flex: 1, height: 1, background: "rgba(34,31,26,.07)" }} />
            </div>
            {items.map((it) => {
              const done = !!ctx.overlay.doneTasks[it.id];
              return (
                <button key={it.id} onClick={() => ctx.toggleTask(it.id)} className="hover-border" style={{ display: "flex", alignItems: "center", gap: 13, width: "100%", textAlign: "left", background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 12, padding: "13px 15px", cursor: "pointer", marginBottom: 9, boxShadow: "var(--card-shadow)" }}>
                  <span style={{ width: 21, height: 21, borderRadius: 6, flex: "0 0 auto", display: "grid", placeItems: "center", background: done ? "#2f9266" : "transparent", border: `2px solid ${done ? "#2f9266" : "#c3bbac"}` }}>
                    {done && <IconCheck size={12} color="#fff" stroke={3} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "600 13.5px var(--sans)", color: done ? "#a89e8c" : "#2a2620", textDecoration: done ? "line-through" : "none" }}>{it.label}</div>
                    <div style={{ font: "500 11.5px var(--sans)", color: "var(--muted-2)", marginTop: 2 }}>{it.coLine || "Personal"}</div>
                  </div>
                  <span style={{ font: "600 11.5px var(--mono)", color: "var(--muted-2)", whiteSpace: "nowrap", flex: "0 0 auto" }}>{it.due}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================================
   STATISTICS
   ========================================================================== */
export function Statistics(ctx: Ctx) {
  const s = computeStats(ctx.apps, ctx.nowMs);
  if (s.sent === 0) return <EmptyInline title="No data yet" sub="Statistics appear once you’ve applied to a few roles. Add an application or run a sync to begin." />;
  const vol = volumeStats(ctx.apps, ctx.nowMs);
  const src = sourcePerformance(ctx.apps);
  const role = rolePerformance(ctx.apps);
  const comp = companyInsights(ctx.apps);
  const timing = timingStats(ctx.apps, ctx.nowMs);
  const work = workTypePerformance(ctx.apps);
  const loc = locationPerformance(ctx.apps);
  const sal = salaryStats(ctx.apps);
  const resume = resumePerformance(ctx.apps);
  const wk = responseByWeek(ctx.apps, ctx.nowMs, 6);
  const hasMeta = work.length > 0 || loc.length > 0 || sal.count > 0 || resume.rows.length > 0;
  const dDays = (n: number | null) => (n == null ? "—" : String(n));
  const ratePct = Math.round(s.responseRate * 100);
  const healthLabel = s.health === "healthy" ? "healthy" : s.health === "ok" ? "okay" : "needs work";
  const healthColor = s.health === "healthy" ? "#1f7a52" : s.health === "ok" ? "#9a6a16" : "#a85544";
  const advText = (i: number) => {
    const adv = s.advance[i];
    if (adv == null) return "";
    return `↓ ${Math.round(adv * 100)}% advance · ${Math.round((1 - adv) * 100)}% drop`;
  };

  return (
    <div>
      {/* A — response rate hero */}
      <div className="card" style={{ padding: "20px 22px" }}>
        <div style={{ display: "flex", alignItems: "stretch", gap: 28 }}>
          <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ font: "500 12px var(--sans)", color: "var(--muted)" }}>Response rate · your one number</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginTop: 5 }}>
              <div style={{ font: "700 48px/1 var(--sans)", letterSpacing: "-.03em", color: healthColor }}>{ratePct}%</div>
              <div style={{ font: "600 12px var(--mono)", color: healthColor }}>{healthLabel}</div>
            </div>
            <div style={{ font: "500 12.5px var(--sans)", color: "var(--muted-2)", marginTop: 7 }}>{s.replied} replies · {s.sent} applications</div>
          </div>
          <div style={{ width: 1, background: "rgba(34,31,26,.08)" }} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ position: "relative", marginBottom: 7, height: 18 }}>
              <div style={{ position: "absolute", left: `${s.markerPct}%`, top: -3, transform: "translateX(-50%)", width: 2.5, height: 24, background: "#1f3d33", borderRadius: 2 }} />
              <div style={{ position: "absolute", left: `${s.markerPct}%`, top: -13, transform: "translateX(-50%)", font: "700 10px var(--mono)", color: "#1f3d33" }}>YOU</div>
            </div>
            <div style={{ height: 13, borderRadius: 7, overflow: "hidden", display: "flex" }}>
              <span style={{ width: "20%", background: "#dca596" }} />
              <span style={{ width: "30%", background: "#e6cd97" }} />
              <span style={{ width: "50%", background: "#9ec7b1" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, font: "600 10.5px var(--sans)" }}>
              <span style={{ color: "#c06a57" }}>Broken &lt; 10%</span>
              <span style={{ color: "#9a6a16" }}>OK 10–25%</span>
              <span style={{ color: "#1f7a52" }}>Healthy 25%+</span>
            </div>
            <div style={{ font: "500 12.5px/1.5 var(--sans)", color: "#5a5446", marginTop: 13, padding: "11px 13px", background: "#f4f6f2", borderRadius: 10, border: "1px solid rgba(47,146,102,.16)" }}>
              {s.health === "healthy" ? (
                <>You’re converting replies well. <b style={{ color: "var(--primary)" }}>Volume isn’t the problem</b> — keep the quality of each application high.</>
              ) : s.health === "ok" ? (
                <>You’re above the broken line, but there’s room. <b style={{ color: "var(--primary)" }}>Tighten targeting</b> to lift the reply rate before adding volume.</>
              ) : (
                <>Replies are scarce. That’s a <b style={{ color: "var(--primary)" }}>resume / targeting</b> signal — fix the top of the funnel before sending more.</>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* A1 — highlights (moved off the dashboard, redesigned with an extra context line each) */}
      <div className="hl-row">
        <HighlightCard
          accent="#2a4a40"
          label="This week"
          value={String(vol.thisWeek)}
          unit="apps"
          delta={vol.lastWeek ? vol.thisWeek - vol.lastWeek : undefined}
          context={`${vol.thisMonth} this month · ~${vol.perWeek}/wk pace`}
        />
        <HighlightCard
          accent={timing.followUpsDue ? "#9a6a16" : "#3f7363"}
          label="Follow-ups due"
          value={String(timing.followUpsDue)}
          context={timing.noResponse14 ? `${timing.noResponse14} silent 14+ days` : "you’re on top of it"}
        />
        <HighlightCard
          accent="#1f7a52"
          label="Best source"
          value={src.best ? src.best.key : "—"}
          context={src.best ? `${Math.round(src.best.interviewRate * 100)}% interview · ${Math.round(src.best.responseRate * 100)}% reply` : "needs more data"}
        />
        <HighlightCard
          accent="#3f7363"
          label="Best role"
          value={role.best ? role.best.key : "—"}
          context={role.best ? `${Math.round(role.best.responseRate * 100)}% reply · ${Math.round(role.best.interviewRate * 100)}% interview` : "needs more data"}
        />
        <HighlightCard
          accent="#6c7d96"
          label="Reply time"
          value={timing.medianResponseDays == null ? "—" : String(timing.medianResponseDays)}
          unit={timing.medianResponseDays == null ? "" : "d median"}
          context={timing.medianInterviewDays == null ? "no interviews yet" : `${timing.medianInterviewDays}d to interview`}
        />
      </div>

      {/* A2 — volume & momentum */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 13, marginTop: 14 }}>
        <VolTile value={String(vol.thisWeek)} label="This week" sub="applications" delta={vol.lastWeek ? vol.thisWeek - vol.lastWeek : undefined} />
        <VolTile value={String(vol.thisMonth)} label="This month" sub="last 30 days" />
        <VolTile value={String(vol.perWeek)} label="Per week" sub="average pace" />
        <VolTile value={vol.bestDay ? vol.bestDay.label : "—"} label="Best day" sub={vol.bestDay ? `${vol.bestDay.count} applied` : "no pattern yet"} />
        <VolTile value={String(vol.streakDays)} label="Day streak" sub="keep it going" color="#9a6a16" />
        <VolTile value={String(vol.wishlist)} label="Saved" sub="not applied yet" color="#6b5e86" />
      </div>

      {/* B — funnel */}
      <div className="card" style={{ padding: "20px 22px", marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 18 }}>
          <span className="cardtitle">Funnel conversion</span>
          <span style={{ font: "500 12px var(--sans)", color: "var(--muted-2)" }}>where you’re leaking (by current stage)</span>
        </div>
        <div style={{ display: "flex", gap: 22 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {s.funnel.map((f, i) => (
              <div key={f.label}>
                <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                  <div style={{ width: 74, font: "600 12.5px var(--sans)", color: "#3f3a33", flex: "0 0 auto" }}>{f.label}</div>
                  <div style={{ flex: 1, height: 32, borderRadius: 8, background: "#eef0f3", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.max(f.pct, f.count > 0 ? 4 : 0)}%`, minWidth: f.count > 0 ? 8 : 0, background: f.color, borderRadius: 8 }} />
                  </div>
                  <div style={{ width: 34, font: "600 13px var(--mono)", color: f.label === "Offer" ? "#1f7a52" : "#3f3a33", textAlign: "right", flex: "0 0 auto" }}>{f.count}</div>
                </div>
                {i < s.funnel.length - 1 && (
                  <div style={{ margin: "4px 0 4px 87px", font: "600 10.5px var(--mono)", color: (s.advance[i] ?? 1) < 0.5 ? "#a85544" : "#1f7a52" }}>{advText(i)}</div>
                )}
              </div>
            ))}
          </div>
          {s.biggestLeak && (
            <div style={{ width: 230, flex: "0 0 auto", display: "flex", flexDirection: "column", justifyContent: "center", padding: "14px 15px", background: "#f8f1e8", border: "1px solid rgba(192,138,42,.2)", borderRadius: 12 }}>
              <div style={{ font: "700 10px var(--mono)", letterSpacing: ".07em", textTransform: "uppercase", color: "#a8842f" }}>Biggest leak</div>
              <div style={{ font: "600 13.5px/1.4 var(--sans)", color: "#2a2620", marginTop: 6 }}>{s.biggestLeak.from} → {s.biggestLeak.to}</div>
              <div style={{ font: "500 12px/1.5 var(--sans)", color: "var(--text-3)", marginTop: 6 }}>
                {Math.round(s.biggestLeak.drop * 100)}% drop here. {s.biggestLeak.from === "Applied" ? (
                  <>That’s a <b style={{ color: "#9a6a16" }}>resume / targeting</b> signal — the fix is upstream.</>
                ) : (
                  <>Focus your prep on this transition to convert more.</>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* C — aging & stale */}
      <div className="card" style={{ padding: "20px 22px", marginTop: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 22, alignItems: "center" }}>
          <div>
            <div className="cardtitle">Aging &amp; stale</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, padding: "13px 15px", background: "#f9ecea", border: "1px solid rgba(192,106,87,.22)", borderRadius: 12 }}>
              <div style={{ font: "700 30px/1 var(--sans)", color: "#a85544", flex: "0 0 auto" }}>{s.aging.silent21}</div>
              <div>
                <div style={{ font: "600 12.5px var(--sans)", color: "#2a2620" }}>apps silent 21+ days</div>
                <div style={{ font: "500 11.5px var(--sans)", color: "#9b8278", marginTop: 1 }}>Most are silent rejections — treat as dead, move on.</div>
              </div>
            </div>
          </div>
          <AgingBars buckets={s.aging.buckets} />
        </div>
      </div>

      {/* D — source performance (full table) */}
      <div className="card" style={{ padding: "20px 22px", marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 14 }}>
          <span className="cardtitle">Source performance</span>
          <span style={{ font: "500 12px var(--sans)", color: "var(--muted-2)" }}>which channels actually convert</span>
        </div>
        <PerfTable rows={src.rows} keyHeader="Source" best={src.best} />
        {src.best && (
          <Takeaway>
            Your strongest channel is <b style={{ color: "var(--primary)" }}>{src.best.key}</b> — {Math.round(src.best.interviewRate * 100)}% reach an interview and {Math.round(src.best.responseRate * 100)}% reply. Lean into it; the channels at the bottom are mostly wasted effort.
          </Takeaway>
        )}
      </div>

      {/* E — role performance */}
      <div className="card" style={{ padding: "20px 22px", marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 14 }}>
          <span className="cardtitle">Role / title performance</span>
          <span style={{ font: "500 12px var(--sans)", color: "var(--muted-2)" }}>what the market actually responds to</span>
        </div>
        <PerfTable rows={role.rows} keyHeader="Role" best={role.best} worst={role.worst} />
        {role.best && (
          <Takeaway>
            <b style={{ color: "var(--primary)" }}>{role.best.key}</b> is where you’re strongest ({Math.round(role.best.responseRate * 100)}% reply).{role.worst && role.worst.key !== role.best.key ? <> {role.worst.key} is the weakest — consider whether it’s worth chasing.</> : null}
          </Takeaway>
        )}
      </div>

      {/* F — company insights + speed/follow-up */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        <div className="card" style={{ padding: "20px 22px" }}>
          <div className="cardtitle">Company insights</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11, marginTop: 14 }}>
            <ContextCard value={String(comp.companiesAppliedTo)} unit="" color="#3f3a33" title="Companies" sub="distinct employers applied to" />
            <ContextCard value={String(comp.multiple.length)} unit="" color="#6b5e86" title="Applied 2+ times" sub="multiple roles at one company" />
          </div>
          {comp.bestResponders.length > 0 && (
            <>
              <div className="eyebrow" style={{ margin: "16px 0 9px" }}>Best responders</div>
              {comp.bestResponders.slice(0, 4).map((c) => (
                <div key={c.company} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid rgba(34,31,26,.05)" }}>
                  <span style={{ font: "600 12.5px var(--sans)", color: "#3f3a33" }}>{c.company}</span>
                  <span style={{ font: "500 11px var(--mono)", color: "var(--muted-2)" }}><b style={{ color: "#1f7a52" }}>{Math.round(c.responseRate * 100)}%</b> · {c.applied} app{c.applied > 1 ? "s" : ""}</span>
                </div>
              ))}
            </>
          )}
          {comp.neverResponded.length > 0 && (
            <div style={{ font: "500 12px/1.5 var(--sans)", color: "var(--text-3)", marginTop: 13, paddingTop: 11, borderTop: "1px solid rgba(34,31,26,.07)" }}>
              <b style={{ color: "#a85544" }}>{comp.neverResponded.length}</b> compan{comp.neverResponded.length > 1 ? "ies" : "y"} never replied — treat them as dead ends.
            </div>
          )}
        </div>

        <div className="card" style={{ padding: "20px 22px" }}>
          <div className="cardtitle">Speed &amp; follow-up</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 11, marginTop: 14 }}>
            <ContextCard value={dDays(timing.medianResponseDays)} unit={timing.medianResponseDays == null ? "" : "d"} color="#3f3a33" title="To first reply" sub="median" />
            <ContextCard value={dDays(timing.medianInterviewDays)} unit={timing.medianInterviewDays == null ? "" : "d"} color="#9a6a16" title="To interview" sub="median" />
            <ContextCard value={dDays(timing.medianRejectionDays)} unit={timing.medianRejectionDays == null ? "" : "d"} color="#a85544" title="To rejection" sub="median" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, padding: "12px 14px", background: "#f8f1e8", border: "1px solid rgba(192,138,42,.2)", borderRadius: 12 }}>
            <div style={{ font: "700 26px/1 var(--sans)", color: "#9a6a16", flex: "0 0 auto" }}>{timing.followUpsDue}</div>
            <div style={{ font: "500 12px/1.45 var(--sans)", color: "#6f685d" }}>application{timing.followUpsDue === 1 ? "" : "s"} need a follow-up (quiet 7+ days). <b>{timing.noResponse14}</b> have had no reply after 14 days.</div>
          </div>
          <div className="eyebrow" style={{ margin: "16px 0 9px" }}>Reply rate by week</div>
          <WeekBars points={wk} />
        </div>
      </div>

      {/* G — tracking-based breakdowns (work type / location / résumé / salary) */}
      {hasMeta ? (
        <>
          <div className="eyebrow" style={{ margin: "20px 2px 11px" }}>From your tracking</div>
          {(work.length > 0 || loc.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: work.length > 0 && loc.length > 0 ? "1fr 1fr" : "1fr", gap: 14 }}>
              {work.length > 0 && (
                <div className="card" style={{ padding: "20px 22px" }}>
                  <div className="cardtitle" style={{ marginBottom: 12 }}>Work arrangement</div>
                  <PerfTable rows={work} keyHeader="Type" />
                </div>
              )}
              {loc.length > 0 && (
                <div className="card" style={{ padding: "20px 22px" }}>
                  <div className="cardtitle" style={{ marginBottom: 12 }}>Location</div>
                  <PerfTable rows={loc.slice(0, 6)} keyHeader="Location" />
                </div>
              )}
            </div>
          )}
          {resume.rows.length > 0 && (
            <div className="card" style={{ padding: "20px 22px", marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 12 }}>
                <span className="cardtitle">Résumé performance</span>
                <span style={{ font: "500 12px var(--sans)", color: "var(--muted-2)" }}>which version actually works</span>
              </div>
              <PerfTable rows={resume.rows} keyHeader="Résumé" best={resume.best} />
              {resume.best && <Takeaway>Your <b style={{ color: "var(--primary)" }}>{resume.best.key}</b> résumé performs best — use it as your default and retire the weak ones.</Takeaway>}
            </div>
          )}
          {sal.count > 0 && (
            <div className="card" style={{ padding: "20px 22px", marginTop: 14 }}>
              <div className="cardtitle" style={{ marginBottom: 14 }}>Salary snapshot</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 11 }}>
                <ContextCard value={sal.median == null ? "—" : money(sal.median)} unit="" color="#1f7a52" title="Median (applied)" sub={`${sal.count} with salary`} />
                <ContextCard value={sal.min == null ? "—" : money(sal.min)} unit="" color="#3f3a33" title="Lowest" sub="floor" />
                <ContextCard value={sal.max == null ? "—" : money(sal.max)} unit="" color="#3f3a33" title="Highest" sub="ceiling" />
              </div>
              {sal.byRole.length > 1 && (
                <div style={{ marginTop: 12 }}>
                  {sal.byRole.slice(0, 5).map((r) => (
                    <div key={r.role} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid rgba(34,31,26,.05)" }}>
                      <span style={{ font: "600 12.5px var(--sans)", color: "#3f3a33" }}>{r.role}</span>
                      <span style={{ font: "500 11.5px var(--mono)", color: "var(--muted)" }}>{money(r.median)} · {r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="card" style={{ padding: "16px 18px", marginTop: 14, display: "flex", gap: 11, alignItems: "center" }}>
          <span style={{ font: "500 12.5px/1.5 var(--sans)", color: "var(--text-3)" }}>
            <b style={{ color: "var(--primary)" }}>Unlock more breakdowns:</b> add a work type, location, salary or résumé version to an application — in the <b>New Application</b> form or any application’s <b>Tracking</b> panel — and you’ll get response rates by remote/hybrid/onsite, by location, by pay, and by résumé version here.
          </span>
        </div>
      )}

      {/* H — context */}
      <div className="eyebrow" style={{ margin: "20px 2px 11px" }}>For context, not action</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 13 }}>
        <ContextCard value={s.timeToFirstReply == null ? "—" : String(s.timeToFirstReply)} unit={s.timeToFirstReply == null ? "" : "days"} color="#3f3a33" title="Time to first reply" sub="Median time a reply takes to land. After this, an app is going quiet." />
        <ContextCard value={`${Math.round(s.ghostRate * 100)}%`} unit="" color="#a85544" title="Ghost rate" sub="Died with zero reply. Normal — it’s a volume + targeting game." />
        <ContextCard value={String(s.activePipeline)} unit="" color="#1f7a52" title="Active pipeline" sub="Genuinely in play right now — not ghosted or rejected." />
      </div>
    </div>
  );
}

const money = (n: number) => "$" + Math.round(n).toLocaleString();

function VolTile({ value, label, sub, color, delta, small }: { value: string; label: string; sub?: string; color?: string; delta?: number; small?: boolean }) {
  const ell: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  return (
    <div className="card" style={{ padding: "13px 15px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, minWidth: 0 }}>
        <div style={{ font: `700 ${small ? 15 : 22}px/1.1 var(--sans)`, letterSpacing: "-.02em", color, ...ell }}>{value}</div>
        {delta != null && delta !== 0 && (
          <div style={{ font: "600 10.5px var(--mono)", color: delta >= 0 ? "#1f7a52" : "#a85544", marginBottom: 1, flex: "0 0 auto" }}>{delta >= 0 ? "↑" : "↓"}{Math.abs(delta)}</div>
        )}
      </div>
      <div style={{ font: "600 11.5px var(--sans)", color: "#5f5a51", marginTop: 6, ...ell }}>{label}</div>
      {sub && <div style={{ font: "500 10.5px var(--sans)", color: "var(--muted-2)", marginTop: 1, ...ell }}>{sub}</div>}
    </div>
  );
}

function Takeaway({ children }: { children: ReactNode }) {
  return (
    <div style={{ font: "500 12px/1.55 var(--sans)", color: "var(--text-3)", marginTop: 14, paddingTop: 13, borderTop: "1px solid rgba(34,31,26,.07)" }}>{children}</div>
  );
}

// A richer, redesigned metric card for the Statistics "Highlights" band (the
// stats that used to sit on the dashboard, now with an extra context line).
function HighlightCard({ accent, label, value, unit, delta, context }: { accent: string; label: string; value: string; unit?: string; delta?: number; context: string }) {
  const numeric = /^[\d.]+$/.test(value);
  return (
    <div style={{ position: "relative", overflow: "hidden", background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 14, padding: "15px 16px 14px 18px", boxShadow: "var(--card-shadow)" }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent, opacity: 0.85 }} />
      <div style={{ font: "600 10px var(--mono)", letterSpacing: ".05em", textTransform: "uppercase", color: "var(--faint)" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 9, minWidth: 0 }}>
        <span title={value} style={{ font: `700 ${numeric ? 29 : 17}px/1 var(--sans)`, letterSpacing: "-.02em", color: accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
        {unit ? <span style={{ font: "500 11.5px var(--sans)", color: "var(--muted-2)", flex: "0 0 auto" }}>{unit}</span> : null}
        {delta != null && delta !== 0 && (
          <span style={{ font: "600 11px var(--mono)", color: delta > 0 ? "#1f7a52" : "#a85544", marginLeft: "auto", flex: "0 0 auto" }}>{delta > 0 ? "↑" : "↓"}{Math.abs(delta)}</span>
        )}
      </div>
      <div style={{ font: "500 11.5px/1.4 var(--sans)", color: "var(--text-3)", marginTop: 8 }}>{context}</div>
    </div>
  );
}

function PerfTable({ rows, keyHeader, best, worst }: { rows: PerfRow[]; keyHeader: string; best?: PerfRow | null; worst?: PerfRow | null }) {
  const grid = "1.5fr .8fr .8fr .7fr .7fr .9fr";
  const head: CSSProperties = { font: "600 10px var(--mono)", letterSpacing: ".04em", textTransform: "uppercase", color: "var(--faint)", textAlign: "right" };
  if (rows.length === 0) return <div className="muted" style={{ fontSize: 12 }}>No data yet.</div>;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: grid, gap: 10, padding: "0 2px 8px" }}>
        <span style={{ ...head, textAlign: "left" }}>{keyHeader}</span>
        <span style={head}>Applied</span>
        <span style={head}>Replies</span>
        <span style={head}>Intv</span>
        <span style={head}>Offers</span>
        <span style={head}>Reply&nbsp;%</span>
      </div>
      {rows.map((r) => {
        const rate = Math.round(r.responseRate * 100);
        const isBest = best?.key === r.key;
        const isWorst = worst?.key === r.key && !isBest;
        const col = rate >= 40 ? "#1f7a52" : rate >= 20 ? "#3f7363" : rate >= 10 ? "#857a64" : "#a85544";
        const numR: CSSProperties = { font: "500 12px var(--mono)", color: "var(--muted)", textAlign: "right" };
        return (
          <div key={r.key} style={{ display: "grid", gridTemplateColumns: grid, gap: 10, alignItems: "center", padding: "9px 2px", borderTop: "1px solid rgba(34,31,26,.05)" }}>
            <span style={{ font: "600 12.5px var(--sans)", color: "#3f3a33", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
              {r.key}
              {isBest && <span style={{ font: "700 8px var(--mono)", color: "#1f7a52", background: "rgba(47,146,102,.14)", padding: "1px 5px", borderRadius: 4, flex: "0 0 auto" }}>BEST</span>}
              {isWorst && <span style={{ font: "700 8px var(--mono)", color: "#a85544", background: "rgba(192,106,87,.13)", padding: "1px 5px", borderRadius: 4, flex: "0 0 auto" }}>WEAK</span>}
            </span>
            <span style={{ ...numR, color: "#3f3a33", fontWeight: 600 }}>{r.applied}</span>
            <span style={numR}>{r.responses}</span>
            <span style={numR}>{r.interviews}</span>
            <span style={{ ...numR, color: r.offers ? "#1f7a52" : "var(--muted-2)" }}>{r.offers}</span>
            <span style={{ ...numR, color: col, fontWeight: 600 }}>{rate}%</span>
          </div>
        );
      })}
    </div>
  );
}

function WeekBars({ points }: { points: { label: string; applied: number; responses: number; rate: number }[] }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 70 }}>
      {points.map((p, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, height: "100%", justifyContent: "flex-end" }}>
          <div style={{ font: "600 10px var(--mono)", color: "var(--muted-2)" }}>{p.applied ? `${Math.round(p.rate * 100)}%` : "—"}</div>
          <div style={{ width: "100%", maxWidth: 30, height: `${Math.max(p.applied ? p.rate * 100 : 0, p.applied ? 6 : 2)}%`, background: p.rate >= 0.25 ? "#9ec7b1" : p.rate >= 0.1 ? "#e6cd97" : "#dca596", borderRadius: "5px 5px 0 0" }} />
          <span style={{ font: "500 9.5px var(--mono)", color: "var(--faint)" }}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}

function AgingBars({ buckets }: { buckets: { label: string; count: number; stale: boolean }[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 104, marginTop: 18, padding: "0 4px" }}>
      {buckets.map((b) => {
        const h = Math.round((b.count / max) * 100);
        const fill = b.stale ? (b.label === "40+d" ? "#b86a58" : "#c98a7d") : b.label === "0–7d" ? "#bcc8c2" : "#d8c596";
        return (
          <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7, height: "100%", justifyContent: "flex-end" }}>
            <div style={{ font: "600 11px var(--mono)", color: b.stale ? "#a85544" : "var(--muted-2)" }}>{b.count}</div>
            <div style={{ width: "100%", maxWidth: 38, height: `${Math.max(h, b.count > 0 ? 6 : 2)}%`, background: fill, borderRadius: "6px 6px 0 0" }} />
            <span style={{ font: `${b.stale ? 600 : 500} 10px var(--mono)`, color: b.stale ? "#a85544" : "var(--faint)" }}>{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function ContextCard({ value, unit, color, title, sub }: { value: string; unit: string; color: string; title: string; sub: string }) {
  return (
    <div style={{ background: "var(--card-subtle)", border: "1px solid rgba(34,31,26,.07)", borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
        <div style={{ font: "700 24px var(--sans)", letterSpacing: "-.02em", color }}>{value}</div>
        {unit && <div style={{ font: "500 12px var(--sans)", color: "var(--muted)" }}>{unit}</div>}
      </div>
      <div style={{ font: "600 12px var(--sans)", color: "#5f5a51", marginTop: 6 }}>{title}</div>
      <div style={{ font: "500 11px/1.45 var(--sans)", color: "var(--muted-2)", marginTop: 3 }}>{sub}</div>
    </div>
  );
}

/* ============================================================================
   DOCUMENTS
   ========================================================================== */
export function Documents(ctx: Ctx) {
  const fileRef = useRef<HTMLInputElement>(null);
  const docs = ctx.overlay.docs;
  const pick = () => fileRef.current?.click();
  return (
    <div style={{ maxWidth: 840 }}>
      <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) ctx.addDoc(f); e.target.value = ""; }} />
      {docs.length === 0 ? (
        <EmptyInline title="No documents yet" sub="Add your resume, cover letters and portfolio so you can attach them to applications." primary="Upload a document" onPrimary={pick} />
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          {docs.map((d) => (
            <div key={d.id} className="hover-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 18px", borderBottom: "1px solid rgba(34,31,26,.05)" }}>
              <DocBadge type={d.type} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "600 13.5px var(--sans)" }}>{d.name}</div>
                <div style={{ font: "500 11.5px var(--sans)", color: "var(--muted-2)", marginTop: 2 }}>Stored locally</div>
              </div>
              <span style={{ font: "500 12px var(--mono)", color: "var(--muted-2)" }}>{d.size}</span>
              <span style={{ font: "500 12px var(--mono)", color: "var(--faint)", width: 54, textAlign: "right" }}>{d.date}</span>
              <IconDownload size={17} color="#b3ab9e" />
            </div>
          ))}
          <div onClick={pick} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 15, color: "var(--primary)", font: "600 12.5px var(--sans)", cursor: "pointer" }}>
            <IconPlus size={15} />
            Upload a document
          </div>
        </div>
      )}
    </div>
  );
}

export function DocBadge({ type, big = true }: { type: string; big?: boolean }) {
  const isDoc = type.toUpperCase().startsWith("DOC");
  return (
    <span style={{ width: big ? 40 : 34, height: big ? 46 : 40, borderRadius: big ? 8 : 7, flex: "0 0 auto", display: "grid", placeItems: "center", font: `700 ${big ? 9 : 8}px var(--mono)`, color: isDoc ? "#4a5f8c" : "#a85544", background: isDoc ? "rgba(108,125,150,.16)" : "rgba(192,106,87,.14)" }}>
      {type.toUpperCase()}
    </span>
  );
}

/* ============================================================================
   TEMPLATES (static message templates)
   ========================================================================== */
const TEMPLATES = [
  {
    title: "Follow-up nudge",
    purpose: "When a company has gone quiet",
    body: "Hi [name],\n\nI wanted to follow up on my application for the [role] position — I'm still very excited about the team and the work you're doing. If there's an update on the timeline, or anything else you need from me, I'd love to hear it.\n\nThank you for your time,\n[your name]",
  },
  {
    title: "Thank-you after interview",
    purpose: "Send within 24h of an interview",
    body: "Hi [name],\n\nThank you for taking the time to meet today. I really enjoyed our conversation about [topic], and it left me even more excited about the [role] and the team. Please don't hesitate to reach out if there's anything else I can share.\n\nBest,\n[your name]",
  },
  {
    title: "Reschedule request",
    purpose: "Politely move an interview",
    body: "Hi [name],\n\nSomething has come up and I want to be sure I can give our [round] interview my full attention. Would it be possible to find another time? I'm free [days/times], but I'm happy to work around your schedule.\n\nApologies for any inconvenience, and thank you for understanding.\n\nBest,\n[your name]",
  },
  {
    title: "Accept the offer",
    purpose: "Formally accept",
    body: "Hi [name],\n\nI'm thrilled to formally accept the [role] offer at [company]. Thank you for the opportunity and for the trust the team has placed in me — I can't wait to get started.\n\nPlease let me know what you need from me next on paperwork and a start date.\n\nWith appreciation,\n[your name]",
  },
  {
    title: "Decline politely",
    purpose: "Turn one down gracefully",
    body: "Hi [name],\n\nThank you so much for the offer, and for the time everyone spent with me through the process. After careful thought, I've decided to pursue a different path that's a closer fit for me right now.\n\nIt was a genuine pleasure getting to know the team, and I hope our paths cross again.\n\nWarm regards,\n[your name]",
  },
  {
    title: "Withdraw application",
    purpose: "Bow out of a process",
    body: "Hi [name],\n\nI wanted to let you know that I'm withdrawing my application for the [role] position. After some reflection I've decided it isn't the right fit at this time.\n\nI appreciate the time you and the team invested, and I hope we might connect again down the road.\n\nBest,\n[your name]",
  },
];

const TEMPLATE_EDITS_KEY = "pipeline.templateEdits";
function loadTemplateEdits(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TEMPLATE_EDITS_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

const tplPrimaryBtn: CSSProperties = { flex: 1, textAlign: "center", padding: 9, background: "var(--primary)", color: "var(--on-primary)", border: "none", borderRadius: 9, font: "600 12.5px var(--sans)", cursor: "pointer" };
const tplGhostBtn: CSSProperties = { padding: "9px 14px", background: "#fff", border: "1px solid rgba(34,31,26,.14)", borderRadius: 9, font: "600 12.5px var(--sans)", color: "var(--text-3)", cursor: "pointer" };

export function Templates(ctx: Ctx) {
  // User edits persist locally (overlay-style) so a tweaked template sticks.
  const [edits, setEdits] = useState<Record<string, string>>(loadTemplateEdits);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const persist = (next: Record<string, string>) => {
    setEdits(next);
    try {
      localStorage.setItem(TEMPLATE_EDITS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  const saveEdit = (title: string) => {
    persist({ ...edits, [title]: draft });
    setEditing(null);
  };
  const resetEdit = (title: string) => {
    const next = { ...edits };
    delete next[title];
    persist(next);
    setEditing(null);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
      {TEMPLATES.map((tp) => {
        const body = edits[tp.title] ?? tp.body;
        const isEditing = editing === tp.title;
        const edited = edits[tp.title] != null;
        return (
          <div key={tp.title} className="card hover-border" style={{ padding: 20, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(42,74,64,.1)", display: "grid", placeItems: "center", flex: "0 0 auto" }}>
                <IconMail size={16} color="#2a4a40" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "650 14px var(--sans)" }}>{tp.title}</div>
                <div style={{ font: "500 11.5px var(--sans)", color: "var(--muted-2)", marginTop: 1 }}>{tp.purpose}</div>
              </div>
              {edited && <span style={{ font: "600 9.5px var(--mono)", letterSpacing: ".06em", color: "#9a6a16", background: "#f8f1e8", padding: "2px 7px", borderRadius: 5, flex: "0 0 auto" }}>EDITED</span>}
            </div>

            {isEditing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                style={{ marginTop: 14, padding: "13px 14px", minHeight: 200, resize: "vertical", background: "#fffdf9", border: "1px solid rgba(42,74,64,.4)", borderRadius: 10, font: "400 12.5px/1.6 var(--sans)", color: "#3f3a33", outline: "none", flex: 1 }}
              />
            ) : (
              <div style={{ font: "400 12.5px/1.6 var(--sans)", color: "#5f5a51", marginTop: 14, padding: "14px 15px", background: "#f6f1e8", borderRadius: 10, whiteSpace: "pre-wrap", flex: 1 }}>{body}</div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {isEditing ? (
                <>
                  <button onClick={() => saveEdit(tp.title)} style={tplPrimaryBtn}>Save</button>
                  <button onClick={() => setEditing(null)} style={tplGhostBtn}>Cancel</button>
                  {edited && (
                    <button onClick={() => resetEdit(tp.title)} style={tplGhostBtn} title="Restore the original wording">Reset</button>
                  )}
                </>
              ) : (
                <>
                  <button onClick={() => ctx.copyTemplate(tp.title, body)} style={tplPrimaryBtn}>Use template</button>
                  <button onClick={() => { setDraft(body); setEditing(tp.title); }} style={tplGhostBtn}>Edit</button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================================
   SETTINGS
   ========================================================================== */
export function Settings(ctx: Ctx) {
  const { overlay, setSetting, exportCsv, deleteAll, disconnect, email, onRebuild } = ctx;
  return (
    <div style={{ maxWidth: 720 }}>
      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ font: "600 15px var(--sans)" }}>Connected mailboxes</div>
        <div style={{ font: "500 12.5px var(--sans)", color: "var(--muted-2)", marginTop: 3 }}>Pipeline reads these inboxes read-only to find your applications.</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 15, padding: "13px 15px", border: "1px solid rgba(34,31,26,.09)", borderRadius: 12, background: "#fdfbf6" }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: "#fff", border: "1px solid rgba(34,31,26,.1)", display: "grid", placeItems: "center", flex: "0 0 auto" }}>
            <IconMail size={18} color="#c06a57" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "600 13.5px var(--sans)" }}>{email}</div>
            <div style={{ font: "500 11.5px var(--sans)", color: "#2f9266", display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#2f9266" }} />
              Connected
            </div>
          </div>
          <span style={{ font: "600 10.5px var(--mono)", color: "#857a64", background: "#efe9df", padding: "3px 8px", borderRadius: 6 }}>PRIMARY</span>
          <button className="btn btn-danger" onClick={disconnect}>Disconnect</button>
        </div>
        <div onClick={() => (window.location.href = "/auth/google/start")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 11, padding: 12, border: "1px dashed rgba(34,31,26,.18)", borderRadius: 12, color: "var(--primary)", font: "600 12.5px var(--sans)", cursor: "pointer" }}>
          <IconPlus size={15} />
          Connect another mailbox
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ font: "600 15px var(--sans)" }}>Sync</div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ font: "600 13px var(--sans)" }}>Auto-sync frequency</div>
            <div style={{ font: "500 11.5px var(--sans)", color: "var(--muted-2)", marginTop: 2 }}>How often Pipeline checks for new application mail.</div>
          </div>
          <div className="segmented">
            {(["30 min", "Hourly", "Manual"] as const).map((opt) => (
              <button key={opt} className={overlay.settings.autoSync === opt ? "active" : ""} onClick={() => setSetting({ autoSync: opt })}>{opt}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 16, paddingTop: 15, borderTop: "1px solid rgba(34,31,26,.07)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ font: "600 13px var(--sans)" }}>Sync on app open</div>
            <div style={{ font: "500 11.5px var(--sans)", color: "var(--muted-2)", marginTop: 2 }}>Refresh your board every time you open Pipeline.</div>
          </div>
          <button className={`toggle${overlay.settings.syncOnOpen ? " on" : ""}`} aria-pressed={overlay.settings.syncOnOpen} onClick={() => setSetting({ syncOnOpen: !overlay.settings.syncOnOpen })}>
            <span className="knob" />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 16, paddingTop: 15, borderTop: "1px solid rgba(34,31,26,.07)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ font: "600 13px var(--sans)" }}>Rebuild from mailbox</div>
            <div style={{ font: "500 11.5px var(--sans)", color: "var(--muted-2)", marginTop: 2 }}>Clear synced applications and re-scan your inbox from scratch — use this if non-application mail slipped onto your board.</div>
          </div>
          <button className="btn" onClick={onRebuild} style={{ color: "#3f4a44" }}>Rebuild board</button>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div style={{ font: "600 15px var(--sans)" }}>Privacy &amp; data</div>
        <div style={{ display: "flex", gap: 11, marginTop: 13, padding: "13px 15px", background: "#f4f6f2", border: "1px solid rgba(47,146,102,.18)", borderRadius: 12 }}>
          <IconShield size={18} color="#2f9266" style={{ flex: "0 0 auto", marginTop: 1 }} />
          <div style={{ font: "500 12.5px/1.55 var(--sans)", color: "#4f5a52" }}>
            Pipeline stores only <b style={{ color: "var(--primary)" }}>derived records</b> — company, role, status, dates and a short snippet. Never your raw email, and never shared with anyone.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button className="btn" onClick={exportCsv} style={{ color: "#3f4a44" }}>Export my data (CSV)</button>
          <button className="btn btn-danger" onClick={deleteAll}>Delete all my data</button>
        </div>
      </div>
    </div>
  );
}

/* ---- inline empty state (within the content area) ------------------------- */
export function EmptyInline({ title, sub, primary, onPrimary, secondary, onSecondary }: { title: string; sub: string; primary?: string; onPrimary?: () => void; secondary?: string; onSecondary?: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "80px 20px" }}>
      <div style={{ font: "500 22px var(--serif)", color: "var(--text)" }}>{title}</div>
      <div style={{ font: "400 14px/1.6 var(--sans)", color: "#7a7468", marginTop: 9, maxWidth: 420 }}>{sub}</div>
      {(primary || secondary) && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          {primary && <button className="btn btn-primary" onClick={onPrimary}>{primary}</button>}
          {secondary && <button className="btn" onClick={onSecondary}>{secondary}</button>}
        </div>
      )}
    </div>
  );
}
