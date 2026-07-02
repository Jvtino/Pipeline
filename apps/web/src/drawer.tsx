// Application detail drawer — right-docked, slides in over a scrim. Tabs:
// Overview (next step + move stage + progress timeline + details), Email
// (stored per-message previews from the server), Notes, Contacts, Files.
// Notes/contacts/files read & write the client overlay.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Ctx } from "./ctx";
import type { UiApplication, WorkType, DetailTab } from "./types";
import { STATUS, MOVE_STAGES, type UiStatus } from "./lib/status";
import { shortDate } from "./lib/format";
import { getMessages, getEvents, type ThreadMessage, type StatusEvent } from "./api";
import { deriveContacts, mergeContacts } from "./lib/derive";
import { CompanyAvatar, PersonAvatar, StatusPill, NeedsReviewBadge, ExpandMorph } from "./components";
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

/** "Jordan Lee <jl@acme.com>" → "Jordan Lee"; a bare address passes through. */
function senderName(from: string): string {
  const name = from.replace(/<[^>]*>/g, "").replace(/["']/g, "").trim();
  return name || from.replace(/[<>]/g, "").trim();
}

function humanSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DetailDrawer({ app, ctx, onClose, from }: { app: UiApplication; ctx: Ctx; onClose: () => void; from?: DOMRect | null }) {
  const [tab, setTab] = useState<DetailTab>("overview");
  // Email tab: fetched lazily on first open; keyed by app so a reused drawer refetches.
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [msgState, setMsgState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  useEffect(() => {
    setMessages(null);
    setMsgState("idle");
  }, [app.id]);
  // Real stage history: recorded sync transitions + the user's manual moves.
  const [events, setEvents] = useState<StatusEvent[] | null>(null);
  useEffect(() => {
    setEvents(null);
    if (!app.threadId) return;
    getEvents(app.threadId).then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, [app.id, app.threadId]);
  const history = useMemo(() => {
    const fromSync = (events ?? []).map((e) => ({ status: e.status as UiStatus, when: e.occurredAt, via: "from email" }));
    const fromMoves = (ctx.overlay.moves[app.id] ?? []).map((m) => ({ status: m.status, when: m.when, via: "moved by you" }));
    return [...fromSync, ...fromMoves].sort((a, b) => a.when.localeCompare(b.when));
  }, [events, ctx.overlay.moves, app.id]);
  useEffect(() => {
    if (tab !== "email" || msgState !== "idle" || !app.threadId) return;
    setMsgState("loading");
    getMessages(app.threadId)
      .then((r) => { setMessages(r.messages); setMsgState("ready"); })
      .catch(() => setMsgState("error"));
  }, [tab, msgState, app.threadId]);
  const [noteDraft, setNoteDraft] = useState("");
  // Inline company rename (fixes a misattributed card by hand).
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const saveRename = () => {
    if (nameDraft.trim() && nameDraft.trim() !== app.company) ctx.renameCompany(app.id, nameDraft);
    setEditingName(false);
  };
  const [enter, setEnter] = useState(false);
  // Contact add form (Contacts tab)
  const [cName, setCName] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cEmail, setCEmail] = useState("");
  const raf = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // The right-docked mode drives its own enter class + Escape handling; in
  // expand mode the shared ExpandMorph owns geometry, Escape and the reverse
  // morph, so this effect only handles the docked case.
  useEffect(() => {
    raf.current = requestAnimationFrame(() => { raf.current = requestAnimationFrame(() => setEnter(true)); });
    if (from) return () => cancelAnimationFrame(raf.current);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf.current); window.removeEventListener("keydown", onKey); };
  }, [from]);

  const s = STATUS[app.status];
  const notes = ctx.overlay.notes[app.id] ?? [];
  // This application's extracted contact + the company's manual entries (manual wins on collision).
  const contacts = mergeContacts(
    deriveContacts([app]),
    ctx.overlay.contacts.filter((c) => c.company.toLowerCase() === app.company.toLowerCase()),
  );
  const docs = ctx.overlay.docs;
  const syncedDocs = app.threadId ? ctx.syncedDocs.filter((d) => d.threadId === app.threadId) : [];
  const nextDone = !!ctx.overlay.nextDone[app.id];
  const hasNext = app.nextStep && app.nextStep !== "—";
  const enr = app.enrichment;
  const recruiterLine = [enr?.recruiterName, enr?.recruiterTitle].filter(Boolean).join(" · ");
  const hasEnrichment = !!(enr && (enr.interviewDateTime || enr.interviewLink || enr.compensation || enr.location || recruiterLine || enr.recruiterEmail || enr.recruiterPhone));

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

  const content = (close: () => void) => (
    <>
      <div className="drawer-head">
          <CompanyAvatar name={app.company} size={46} radius={13} font={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {editingName ? (
              <input
                className="input"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setEditingName(false); }}
                onBlur={saveRename}
                style={{ padding: "5px 9px", font: "700 15px var(--sans)", width: "100%", maxWidth: 260 }}
              />
            ) : (
              <div
                title="Click to correct the company name"
                onClick={() => { setNameDraft(app.company); setEditingName(true); }}
                style={{ font: "700 16.5px var(--sans)", letterSpacing: "-.01em", cursor: "text", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                {app.company}
                <span aria-hidden style={{ font: "500 11px var(--sans)", color: "var(--faint)" }}>✎</span>
              </div>
            )}
            <div style={{ font: "500 13px var(--sans)", color: "#7a7468", marginTop: 1 }}>{app.role}</div>
          </div>
          <StatusPill status={app.status} />
          <button className="iconbtn" style={{ width: 32, height: 32, border: "none", background: "transparent", color: "var(--muted-2)" }} onClick={close} aria-label="Close">
            <IconX size={17} />
          </button>
        </div>

        <div className="drawer-tabs">
          {(["overview", "email", "notes", "contacts", "files"] as const).map((t) => (
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

              {/* timeline — recorded history (sync transitions + manual moves) when we
                  have it, the inferred stage ladder otherwise */}
              <div className="eyebrow" style={{ margin: "22px 0 14px" }}>Application progress</div>
              {history.length > 0
                ? history.map((e, i, arr) => {
                    const st = STATUS[e.status];
                    const current = i === arr.length - 1;
                    return (
                      <div key={i} style={{ display: "flex", gap: 14 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" }}>
                          <span style={{ width: 15, height: 15, borderRadius: "50%", flex: "0 0 auto", background: current ? st.dot : "#fbf8f2", border: `2px solid ${st.dot}` }} />
                          {i < arr.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 26, margin: "3px 0", background: "#e2dccf" }} />}
                        </div>
                        <div style={{ flex: 1, paddingBottom: 16 }}>
                          <div style={{ font: "600 13.5px var(--sans)", color: "#2a2620" }}>{st.label}</div>
                          <div style={{ font: "500 12px var(--sans)", color: "var(--muted)", marginTop: 2 }}>{shortDate(e.when)} · {e.via}</div>
                        </div>
                      </div>
                    );
                  })
                : timelineFor(app).map((e, i, arr) => {
                    const color = e.state === "done" ? STATUS.offer.dot : e.state === "rejected" ? STATUS.rejected.dot : e.state === "current" ? s.dot : null;
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
                    {enr!.recruiterPhone && (
                      <EnrichRow
                        label="Phone"
                        value={<a href={`tel:${enr!.recruiterPhone.replace(/[^+\d]/g, "")}`} style={{ color: "var(--primary)", textDecoration: "none" }}>{enr!.recruiterPhone}</a>}
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

              {/* escape hatch for junk cards — removes from the board only, never the mailbox */}
              <div style={{ marginTop: 22, paddingTop: 14, borderTop: "1px solid rgba(34,31,26,.07)", textAlign: "center" }}>
                <button
                  onClick={() => { if (window.confirm(`Hide ${app.company} from your board? Your mailbox is untouched — this only removes the card.`)) ctx.hideApp(app.id); }}
                  style={{ border: "none", background: "transparent", cursor: "pointer", font: "600 12px var(--sans)", color: "#a85544", padding: "6px 10px" }}
                >
                  Hide from board
                </button>
              </div>
            </div>
          )}

          {tab === "email" && (
            <div>
              {!app.threadId ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#a89e8c", font: "500 13px var(--sans)" }}>This entry was added by hand — there are no synced emails for it.</div>
              ) : msgState === "loading" || msgState === "idle" ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#a89e8c", font: "500 13px var(--sans)" }}>Loading emails…</div>
              ) : msgState === "error" ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#a89e8c", font: "500 13px var(--sans)" }}>Couldn't load the emails for this application. Try again in a moment.</div>
              ) : !messages || messages.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#a89e8c", font: "500 13px var(--sans)" }}>No emails stored yet — run a sync and the thread's messages will appear here.</div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} style={{ padding: "13px 15px", background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 12, marginBottom: 9 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                      <div style={{ font: "650 13px var(--sans)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{senderName(m.from)}</div>
                      <div style={{ font: "500 11px var(--mono)", color: "var(--faint)", flex: "0 0 auto" }}>{shortDate(m.date)}</div>
                    </div>
                    <div style={{ font: "400 12.5px/1.55 var(--sans)", color: "#3f3a33", marginTop: 6 }}>{m.bodyPreview || "(no preview)"}</div>
                    {m.attachments.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
                        {m.attachments.map((a, j) => (
                          <span key={j} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "#f4ede0", border: "1px solid rgba(192,138,42,.22)", borderRadius: 8, font: "600 11px var(--sans)", color: "#6e5a2a" }}>
                            <IconDownload size={11} color="#a8842f" />
                            {a.name}
                            {humanSize(a.size) && <span style={{ color: "#a89e8c", fontWeight: 500 }}>{humanSize(a.size)}</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
              <div style={{ textAlign: "center", marginTop: 4, font: "500 11px var(--sans)", color: "var(--faint)" }}>Pipeline stores short previews only — never your full emails.</div>
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
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ font: "650 13.5px var(--sans)" }}>{k.name}</span>
                      {k.source === "email" && (
                        <span style={{ padding: "2px 7px", borderRadius: 6, background: "rgba(47,146,102,.12)", font: "600 9.5px var(--sans)", color: "#1f7a52" }}>from email</span>
                      )}
                    </div>
                    <div style={{ font: "500 11.5px var(--sans)", color: "var(--muted-2)" }}>{[k.title, k.email, k.phone].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                  {k.email && (
                    <a href={`mailto:${k.email}`} className="btn" style={{ padding: "7px 12px", fontSize: 11.5 }}>Email</a>
                  )}
                </div>
              ))}
              {contacts.length === 0 && (
                <div style={{ textAlign: "center", padding: "32px 20px 22px", color: "#a89e8c", font: "500 13px var(--sans)" }}>No contacts yet — recruiters found in this thread's emails appear here automatically, or add one below.</div>
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
              {syncedDocs.length > 0 && (
                <>
                  <div className="eyebrow" style={{ margin: "0 0 10px" }}>From this thread's emails</div>
                  {syncedDocs.map((d, i) => (
                    <div key={`${d.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 15px", background: "var(--card)", border: "1px solid var(--card-border)", borderRadius: 12, marginBottom: 9 }}>
                      <DocBadge type={/\.([a-z0-9]{2,5})$/i.exec(d.name)?.[1]?.toUpperCase() ?? "FILE"} big={false} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: "600 13px var(--sans)" }}>{d.name}</div>
                        <div style={{ font: "500 11px var(--mono)", color: "var(--faint)", marginTop: 2 }}>{humanSize(d.size) ?? "—"} · {shortDate(d.date)}</div>
                      </div>
                    </div>
                  ))}
                  {docs.length > 0 && <div className="eyebrow" style={{ margin: "14px 0 10px" }}>Your uploads</div>}
                </>
              )}
              {docs.length === 0 && syncedDocs.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#a89e8c", font: "500 13px var(--sans)" }}>No files yet — attachments the company emails you appear here after a sync, and uploads from the Documents screen show here too.</div>
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

  // Opened from a card (Applications) → Apple-style expand via the shared
  // ExpandMorph (the same animation as the company square, so they can't drift).
  if (from) {
    return (
      <ExpandMorph from={from} height={760} vhMargin={56} zIndex={47} background="var(--drawer)" captureEscape onClosed={() => closeRef.current()}>
        {(beginClose, morphEnter) => (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", opacity: morphEnter ? 1 : 0, transition: `opacity .28s ease ${morphEnter ? ".14s" : "0s"}` }}>
            {content(beginClose)}
          </div>
        )}
      </ExpandMorph>
    );
  }

  // Default (Dashboard, Calendar, …) → the familiar right-docked drawer.
  return (
    <>
      <div className={`scrim pl-fade${enter ? " enter" : ""}`} style={{ zIndex: 35, background: "rgba(34,31,26,.3)" }} onClick={() => closeRef.current()} />
      <div className={`drawer pl-drawer${enter ? " enter" : ""}`} style={{ zIndex: 36 }}>
        {content(() => closeRef.current())}
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
