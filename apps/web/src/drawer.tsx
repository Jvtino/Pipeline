// Application detail drawer — right-docked, slides in over a scrim. Tabs:
// Overview (next step + move stage + progress timeline + details), Notes,
// Contacts, Files. Notes/contacts/files read & write the client overlay.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Ctx } from "./ctx";
import type { UiApplication, WorkType } from "./types";
import { STATUS, MOVE_STAGES, type UiStatus } from "./lib/status";
import { CompanyAvatar, PersonAvatar, StatusPill } from "./components";
import { DocBadge } from "./screens";
import { IconX, IconClock, IconCheck, IconDownload } from "./lib/icons";

type TLState = "done" | "current" | "upcoming" | "rejected";
interface TLEvent { label: string; cap: string; state: TLState }

function timelineFor(a: UiApplication): TLEvent[] {
  const D = a.dateLabel;
  const ev = (label: string, cap: string, state: TLState): TLEvent => ({ label, cap, state });
  switch (a.status) {
    case "wishlist":
      return [ev("Saved", "Bookmarked to apply to", "current"), ev("Applied", "Not yet applied", "upcoming")];
    case "applied":
      return [ev("Applied", `Application received · ${D}`, "done"), ev("Screening", "Awaiting recruiter", "current"), ev("Interview", "Upcoming", "upcoming"), ev("Offer", "Upcoming", "upcoming")];
    case "screening":
      return [ev("Applied", `Application received · ${D}`, "done"), ev("Screening", a.nextStep, "current"), ev("Interview", "Upcoming", "upcoming"), ev("Offer", "Upcoming", "upcoming")];
    case "interview":
      return [ev("Applied", `Application received · ${D}`, "done"), ev("Screening", "Recruiter screen passed", "done"), ev("Interview", a.nextStep, "current"), ev("Offer", "Upcoming", "upcoming")];
    case "offer":
      return [ev("Applied", `Application received · ${D}`, "done"), ev("Screening", "Recruiter screen passed", "done"), ev("Interview", "Interviews complete", "done"), ev("Offer", a.nextStep, "current")];
    case "rejected":
      return [ev("Applied", `Application received · ${D}`, "done"), ev("Reviewed", "Application reviewed", "done"), ev("Closed", "Not moving forward", "rejected")];
    case "no_response":
      return [ev("Applied", `Application received · ${D}`, "done"), ev("No response", "Quiet — consider a nudge", "current")];
    default:
      return [];
  }
}

export function DetailDrawer({ app, ctx, onClose }: { app: UiApplication; ctx: Ctx; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "notes" | "contacts" | "files">("overview");
  const [noteDraft, setNoteDraft] = useState("");
  const [enter, setEnter] = useState(false);
  // Contact add form (Contacts tab)
  const [cName, setCName] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cEmail, setCEmail] = useState("");
  const raf = useRef(0);

  useEffect(() => {
    raf.current = requestAnimationFrame(() => setEnter(true));
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const s = STATUS[app.status];
  const notes = ctx.overlay.notes[app.id] ?? [];
  const contacts = ctx.overlay.contacts.filter((c) => c.company.toLowerCase() === app.company.toLowerCase());
  const docs = ctx.overlay.docs;
  const nextDone = !!ctx.overlay.nextDone[app.id];
  const hasNext = app.nextStep && app.nextStep !== "—";

  const addNote = () => {
    const t = noteDraft.trim();
    if (!t) return;
    ctx.addNote(app.id, t);
    setNoteDraft("");
  };
  const addContact = () => {
    if (!cName.trim()) return;
    ctx.addContact({ name: cName.trim(), title: cTitle.trim(), email: cEmail.trim(), company: app.company });
    setCName("");
    setCTitle("");
    setCEmail("");
  };

  return (
    <>
      <div className={`scrim pl-fade${enter ? " enter" : ""}`} style={{ zIndex: 35, background: "rgba(34,31,26,.3)" }} onClick={onClose} />
      <div className={`drawer pl-drawer${enter ? " enter" : ""}`} style={{ zIndex: 36 }}>
        <div className="drawer-head">
          <CompanyAvatar name={app.company} size={46} radius={13} font={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "700 16.5px var(--sans)", letterSpacing: "-.01em" }}>{app.company}</div>
            <div style={{ font: "500 13px var(--sans)", color: "#7a7468", marginTop: 1 }}>{app.role}</div>
          </div>
          <StatusPill status={app.status} />
          <button className="iconbtn" style={{ width: 32, height: 32, border: "none", background: "transparent", color: "var(--muted-2)" }} onClick={onClose} aria-label="Close">
            <IconX size={17} />
          </button>
        </div>

        <div className="drawer-tabs">
          {(["overview", "notes", "contacts", "files"] as const).map((t) => (
            <button key={t} className={`pl-dtab${tab === t ? " active" : ""}`} onClick={() => setTab(t)} style={{ textTransform: "capitalize" }}>
              {t}
            </button>
          ))}
        </div>

        <div className="drawer-body">
          {tab === "overview" && (
            <div>
              {/* next step */}
              <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "14px 15px", background: "#f4ede0", border: "1px solid rgba(192,138,42,.22)", borderRadius: 13 }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(192,138,42,.16)", display: "grid", placeItems: "center", flex: "0 0 auto" }}>
                  <IconClock size={17} color="#9a6a16" />
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ font: "600 10px var(--mono)", letterSpacing: ".08em", textTransform: "uppercase", color: "#a8842f" }}>Next step</div>
                  <div style={{ font: "600 13.5px var(--sans)", color: "#2a2620", marginTop: 2 }}>{hasNext ? app.nextStep : "No next step yet — add one to stay on track."}</div>
                </div>
                {nextDone ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 12px", background: "rgba(47,146,102,.14)", borderRadius: 9, font: "600 11.5px var(--sans)", color: "#1f7a52", flex: "0 0 auto" }}>
                    <IconCheck size={12} stroke={3} />
                    Done
                  </span>
                ) : (
                  hasNext && (
                    <button onClick={() => ctx.markNextDone(app.id)} style={{ padding: "8px 13px", background: "#fff", border: "1px solid rgba(192,138,42,.4)", borderRadius: 9, font: "600 11.5px var(--sans)", color: "#9a6a16", cursor: "pointer", flex: "0 0 auto", whiteSpace: "nowrap" }}>Mark done</button>
                  )
                )}
              </div>

              {/* move stage */}
              <div className="eyebrow" style={{ margin: "20px 0 11px" }}>Move stage</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {MOVE_STAGES.map((st: UiStatus) => (
                  <button key={st} className={`pl-stage${app.status === st ? " active" : ""}`} onClick={() => ctx.setStatus(app.id, st)}>
                    <span className="dot" style={{ background: STATUS[st].dot }} />
                    {STATUS[st].label}
                  </button>
                ))}
              </div>

              {/* timeline */}
              <div className="eyebrow" style={{ margin: "22px 0 14px" }}>Application progress</div>
              {timelineFor(app).map((e, i, arr) => {
                const color = e.state === "done" ? "#2f9266" : e.state === "rejected" ? "#c06a57" : e.state === "current" ? s.dot : null;
                return (
                  <div key={i} style={{ display: "flex", gap: 14 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
                      <span style={{ width: 15, height: 15, borderRadius: "50%", flex: "0 0 auto", background: color || "#fbf8f2", border: `2px solid ${color || "#d2ccc0"}` }} />
                      {i < arr.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 26, margin: "3px 0", background: e.state === "done" ? "#bfe0cd" : "#e2dccf" }} />}
                    </div>
                    <div style={{ flex: 1, paddingBottom: 16 }}>
                      <div style={{ font: "600 13.5px var(--sans)", color: "#2a2620" }}>{e.label}</div>
                      <div style={{ font: "500 12px var(--sans)", color: "var(--muted)", marginTop: 2 }}>{e.cap}</div>
                    </div>
                  </div>
                );
              })}

              {/* details grid */}
              <div className="eyebrow" style={{ margin: "8px 0 12px" }}>Details</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
                <DetailBox label="Applied" value={app.dateLabel} />
                <DetailBox label="Source" value={app.source} />
                <DetailBox label="Last activity" value={app.lastActivityIso ? app.dateLabel : "—"} />
                <DetailBox label="Stage" value={s.label} />
              </div>

              {/* editable tracking fields — power the work-type / location / salary / résumé stats */}
              <div className="eyebrow" style={{ margin: "20px 0 11px" }}>Tracking</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
                <MetaField label="Work type">
                  <select className="select" style={{ padding: "8px 10px", fontSize: 13 }} value={app.workType ?? ""} onChange={(e) => ctx.setMeta(app.id, { workType: (e.target.value || null) as WorkType | null })}>
                    <option value="">—</option>
                    <option value="remote">Remote</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="onsite">Onsite</option>
                  </select>
                </MetaField>
                <MetaField label="Location">
                  <input className="input" style={{ padding: "8px 10px", fontSize: 13 }} defaultValue={app.location ?? ""} onBlur={(e) => ctx.setMeta(app.id, { location: e.target.value.trim() || null })} placeholder="—" />
                </MetaField>
                <MetaField label="Salary">
                  <input className="input" style={{ padding: "8px 10px", fontSize: 13 }} inputMode="numeric" defaultValue={app.salary == null ? "" : String(app.salary)} onBlur={(e) => { const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10); ctx.setMeta(app.id, { salary: Number.isFinite(n) ? n : null }); }} placeholder="—" />
                </MetaField>
                <MetaField label="Résumé version">
                  <input className="input" style={{ padding: "8px 10px", fontSize: 13 }} defaultValue={app.resumeVersion ?? ""} onBlur={(e) => ctx.setMeta(app.id, { resumeVersion: e.target.value.trim() || null })} placeholder="—" />
                </MetaField>
              </div>
            </div>
          )}

          {tab === "notes" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <input className="input" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} placeholder="Add a note…" />
                <button onClick={addNote} style={{ padding: "9px 16px", background: "var(--primary)", color: "var(--on-primary)", border: "none", borderRadius: 10, font: "600 12.5px var(--sans)", cursor: "pointer" }}>Add</button>
              </div>
              {notes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#a89e8c", font: "500 13px var(--sans)" }}>No notes yet. Jot down anything you want to remember about this application.</div>
              ) : (
                notes.map((n, i) => (
                  <div key={i} style={{ padding: "13px 15px", background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 12, marginBottom: 9 }}>
                    <div style={{ font: "400 13px/1.5 var(--sans)", color: "#3f3a33" }}>{n.body}</div>
                    <div style={{ font: "500 11px var(--mono)", color: "var(--faint)", marginTop: 6 }}>{n.when}</div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "contacts" && (
            <div>
              {contacts.map((k) => (
                <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 15px", background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 12, marginBottom: 9 }}>
                  <PersonAvatar name={k.name} company={k.company} size={42} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "650 13.5px var(--sans)" }}>{k.name}</div>
                    <div style={{ font: "500 11.5px var(--sans)", color: "var(--muted-2)" }}>{[k.title, k.email].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                  {k.email && (
                    <a href={`mailto:${k.email}`} className="btn" style={{ padding: "7px 12px", fontSize: 11.5 }}>Email</a>
                  )}
                </div>
              ))}
              {contacts.length === 0 && (
                <div style={{ textAlign: "center", padding: "32px 20px 22px", color: "#a89e8c", font: "500 13px var(--sans)" }}>No contacts linked yet. Add the recruiter or hiring manager you’re talking to.</div>
              )}
              <div style={{ marginTop: 12, paddingTop: 14, borderTop: "1px solid rgba(34,31,26,.07)", display: "flex", flexDirection: "column", gap: 8 }}>
                <input className="input" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Name" />
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="input" value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="Title (optional)" />
                  <input className="input" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="Email (optional)" />
                </div>
                <button onClick={addContact} className="btn" style={{ justifyContent: "center" }}>Add contact</button>
              </div>
            </div>
          )}

          {tab === "files" && (
            <div>
              {docs.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#a89e8c", font: "500 13px var(--sans)" }}>No documents yet. Add files from the Documents screen to attach them here.</div>
              ) : (
                docs.map((d) => (
                  <div key={d.id} className="hover-border" style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 15px", background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 12, marginBottom: 9, cursor: "pointer" }}>
                    <DocBadge type={d.type} big={false} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ font: "600 13px var(--sans)" }}>{d.name}</div>
                      <div style={{ font: "500 11px var(--mono)", color: "var(--faint)", marginTop: 2 }}>{d.size} · {d.date}</div>
                    </div>
                    <IconDownload size={16} color="#b3ab9e" />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function DetailBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "12px 14px", background: "var(--card)", border: "1px solid rgba(34,31,26,.07)", borderRadius: 11 }}>
      <div style={{ font: "500 11px var(--sans)", color: "var(--muted-2)" }}>{label}</div>
      <div style={{ font: "600 13px var(--sans)", marginTop: 3 }}>{value}</div>
    </div>
  );
}

function MetaField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ font: "500 11px var(--sans)", color: "var(--muted-2)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
