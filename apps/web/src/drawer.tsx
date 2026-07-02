// Application detail drawer — right-docked, slides in over a scrim. Tabs:
// Overview (next step + move stage + progress timeline + details), Notes,
// Contacts, Files. Notes/contacts/files read & write the client overlay.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Ctx } from "./ctx";
import type { UiApplication, WorkType } from "./types";
import { STATUS, MOVE_STAGES, type UiStatus } from "./lib/status";
import { shortDate } from "./lib/format";
import { CompanyAvatar, PersonAvatar, StatusPill, NeedsReviewBadge } from "./components";
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

export function DetailDrawer({ app, ctx, onClose, from }: { app: UiApplication; ctx: Ctx; onClose: () => void; from?: DOMRect | null }) {
  const [tab, setTab] = useState<"overview" | "notes" | "contacts" | "files">("overview");
  const [noteDraft, setNoteDraft] = useState("");
  const [enter, setEnter] = useState(false);
  // Contact add form (Contacts tab)
  const [cName, setCName] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cEmail, setCEmail] = useState("");
  const raf = useRef(0);
  const closing = useRef(false); // expand mode: a reverse-morph is in flight
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // In expand mode (opened from a card) we collapse back into the source rect
  // before unmounting; the right-docked drawer just unmounts. Backdrop + close
  // button + Escape all route through here.
  const beginClose = () => {
    if (from) { closing.current = true; setEnter(false); }
    else closeRef.current();
  };

  const EASE = "cubic-bezier(.32,.72,0,1)"; // iOS panel easing (matches the company card)
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  useEffect(() => {
    // paint the start (square) geometry for one frame, then transition open
    raf.current = requestAnimationFrame(() => { raf.current = requestAnimationFrame(() => setEnter(true)); });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (from) { closing.current = true; setEnter(false); e.stopImmediatePropagation(); } // don't also close the company panel behind us
      else closeRef.current();
    };
    // capture phase so we win over the company panel's own Escape handler
    const opts: AddEventListenerOptions | undefined = from ? { capture: true } : undefined;
    window.addEventListener("keydown", onKey, opts);
    return () => { cancelAnimationFrame(raf.current); window.removeEventListener("keydown", onKey, opts); };
  }, [from]);

  const s = STATUS[app.status];
  const notes = ctx.overlay.notes[app.id] ?? [];
  const contacts = ctx.overlay.contacts.filter((c) => c.company.toLowerCase() === app.company.toLowerCase());
  const docs = ctx.overlay.docs;
  const nextDone = !!ctx.overlay.nextDone[app.id];
  const hasNext = app.nextStep && app.nextStep !== "—";
  const enr = app.enrichment;
  const recruiterLine = [enr?.recruiterName, enr?.recruiterTitle].filter(Boolean).join(" · ");
  const hasEnrichment = !!(enr && (enr.interviewDateTime || enr.interviewLink || enr.compensation || enr.location || recruiterLine || enr.recruiterEmail));

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

  const content = (
    <>
      <div className="drawer-head">
          <CompanyAvatar name={app.company} size={46} radius={13} font={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "700 16.5px var(--sans)", letterSpacing: "-.01em" }}>{app.company}</div>
            <div style={{ font: "500 13px var(--sans)", color: "#7a7468", marginTop: 1 }}>{app.role}</div>
          </div>
          <StatusPill status={app.status} />
          <button className="iconbtn" style={{ width: 32, height: 32, border: "none", background: "transparent", color: "var(--muted-2)" }} onClick={beginClose} aria-label="Close">
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
              {/* low-confidence review nudge */}
              {app.needsReview && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", marginBottom: 14, background: "rgba(192,138,42,.09)", border: "1px solid rgba(192,138,42,.22)", borderRadius: 12 }}>
                  <NeedsReviewBadge />
                  <span style={{ font: "500 12px/1.45 var(--sans)", color: "#7a5a1a" }}>The classifier wasn't fully sure here. Confirm the stage below if it's right, or fix it.</span>
                </div>
              )}
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
                <DetailBox label="Last activity" value={shortDate(app.lastActivityIso)} />
                <DetailBox label="Stage" value={s.label} />
              </div>

              {/* extracted-from-email (read-only; value-or-null, never guessed) */}
              {hasEnrichment && (
                <>
                  <div className="eyebrow" style={{ margin: "20px 0 11px" }}>Extracted from email</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    {enr!.interviewDateTime && <EnrichRow label="Interview" value={enr!.interviewDateTime} />}
                    {enr!.interviewLink && (
                      <EnrichRow label="Booking link" value={<a href={enr!.interviewLink} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", textDecoration: "none", wordBreak: "break-all" }}>{enr!.interviewLink}</a>} />
                    )}
                    {enr!.compensation && <EnrichRow label="Compensation" value={enr!.compensation} />}
                    {enr!.location && <EnrichRow label="Location" value={enr!.location} />}
                    {(recruiterLine || enr!.recruiterEmail) && (
                      <EnrichRow
                        label="Recruiter"
                        value={
                          <>
                            {recruiterLine}
                            {recruiterLine && enr!.recruiterEmail ? " · " : ""}
                            {enr!.recruiterEmail && (
                              <a href={`mailto:${enr!.recruiterEmail}`} style={{ color: "var(--primary)", textDecoration: "none" }}>{enr!.recruiterEmail}</a>
                            )}
                          </>
                        }
                      />
                    )}
                  </div>
                </>
              )}

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
                    {/* shortDate renders ISO dates; older blobs stored literal strings ("just now") which pass through */}
                    <div style={{ font: "500 11px var(--mono)", color: "var(--faint)", marginTop: 6 }}>{shortDate(n.when)}</div>
                  </div>
                ))
              )}
              <div style={{ textAlign: "center", marginTop: 4, font: "500 11px var(--sans)", color: "var(--faint)" }}>Notes are stored in this browser.</div>
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
    </>
  );

  // Opened from a card (Applications) → Apple-style expand: the tapped row
  // morphs into a centered panel over a dimmed backdrop, and collapses back
  // into the row on close. Matches the company square's open animation.
  if (from) {
    const W = Math.min(560, vw - 40);
    const H = Math.min(760, vh - 56);
    const geo: CSSProperties = enter
      ? { top: Math.max(24, (vh - H) / 2), left: (vw - W) / 2, width: W, height: H, borderRadius: 22 }
      : { top: from.top, left: from.left, width: from.width, height: from.height, borderRadius: 12 };
    return (
      <>
        <div onClick={beginClose} style={{ position: "fixed", inset: 0, zIndex: 47, background: "rgba(34,31,26,.34)", opacity: enter ? 1 : 0, transition: `opacity .44s ${EASE}` }} />
        <div
          onTransitionEnd={(e) => { if (closing.current && e.propertyName === "width") closeRef.current(); }}
          style={{
            position: "fixed",
            zIndex: 48,
            background: "var(--drawer)",
            border: "1px solid rgba(34,31,26,.08)",
            overflow: "hidden",
            boxShadow: enter ? "0 40px 90px rgba(34,31,26,.30)" : "0 2px 8px rgba(34,31,26,.10)",
            transition: `top .46s ${EASE}, left .46s ${EASE}, width .46s ${EASE}, height .46s ${EASE}, border-radius .46s ${EASE}, box-shadow .46s ${EASE}`,
            willChange: "top,left,width,height",
            display: "flex",
            flexDirection: "column",
            ...geo,
          }}
        >
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", opacity: enter ? 1 : 0, transition: `opacity .28s ease ${enter ? ".14s" : "0s"}` }}>
            {content}
          </div>
        </div>
      </>
    );
  }

  // Default (Dashboard, Calendar, …) → the familiar right-docked drawer.
  return (
    <>
      <div className={`scrim pl-fade${enter ? " enter" : ""}`} style={{ zIndex: 35, background: "rgba(34,31,26,.3)" }} onClick={beginClose} />
      <div className={`drawer pl-drawer${enter ? " enter" : ""}`} style={{ zIndex: 36 }}>
        {content}
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

function EnrichRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "11px 14px", background: "var(--card)", border: "1px solid rgba(34,31,26,.07)", borderRadius: 11 }}>
      <div style={{ font: "600 10px var(--mono)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted-2)", flex: "0 0 88px", paddingTop: 1 }}>{label}</div>
      <div style={{ font: "600 13px var(--sans)", color: "#2a2620", minWidth: 0, flex: 1 }}>{value}</div>
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
