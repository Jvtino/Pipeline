// New Application modal — centered, scrim, fade+rise enter. Company & role are
// required; on save the parent adds the row to the overlay, flags it NEW,
// navigates to Applications and toasts.
import { useEffect, useRef, useState } from "react";
import { NEW_APP_STATUSES, STATUS, type UiStatus } from "./lib/status";
import { localIsoDate } from "./lib/format";
import type { WorkType } from "./types";
import { IconX } from "./lib/icons";

export interface NewAppForm {
  company: string;
  role: string;
  status: UiStatus;
  dateIso: string; // applied date (YYYY-MM-DD) — drives the label AND the metrics
  source: string;
  workType: WorkType | null;
  location: string;
  salary: number | null;
  resumeVersion: string;
}

const SOURCES = ["LinkedIn", "Company site", "Referral", "Job board", "Glassdoor", "Recruiter"];
const WORK_TYPES: { value: WorkType | ""; label: string }[] = [
  { value: "", label: "—" },
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "Onsite" },
];

export function NewApplicationModal({ onClose, onSave }: { onClose: () => void; onSave: (f: NewAppForm) => void }) {
  const [form, setForm] = useState<NewAppForm>({ company: "", role: "", status: "applied", dateIso: localIsoDate(Date.now()), source: "LinkedIn", workType: null, location: "", salary: null, resumeVersion: "" });
  const [err, setErr] = useState(false);
  const [enter, setEnter] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    raf.current = requestAnimationFrame(() => setEnter(true));
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const set = <K extends keyof NewAppForm>(k: K, v: NewAppForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => {
    if (!form.company.trim() || !form.role.trim()) {
      setErr(true);
      return;
    }
    onSave({ ...form, company: form.company.trim(), role: form.role.trim() });
  };

  return (
    <>
      <div className={`scrim pl-fade${enter ? " enter" : ""}`} style={{ zIndex: 54, background: "rgba(34,31,26,.42)" }} onClick={onClose} />
      <div className={`modal pl-modal${enter ? " enter" : ""}`}>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <div style={{ font: "600 18px var(--serif)" }}>Add an application</div>
            <div style={{ font: "500 12.5px var(--sans)", color: "var(--muted-2)", marginTop: 3 }}>Track one the inbox scan missed — or that never produced an email.</div>
          </div>
          <button className="iconbtn" style={{ width: 30, height: 30, border: "none", background: "transparent", color: "var(--muted-2)" }} onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>

        <div style={{ marginTop: 18 }}>
          <label className="field-label">Company</label>
          <input className="input" style={{ marginTop: 6 }} value={form.company} onChange={(e) => set("company", e.target.value)} placeholder="e.g. Notion" autoFocus />
        </div>
        <div style={{ marginTop: 13 }}>
          <label className="field-label">Role / title</label>
          <input className="input" style={{ marginTop: 6 }} value={form.role} onChange={(e) => set("role", e.target.value)} placeholder="e.g. Senior Product Designer" />
        </div>
        <div style={{ display: "flex", gap: 11, marginTop: 13 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">Status</label>
            <select className="select" style={{ marginTop: 6 }} value={form.status} onChange={(e) => set("status", e.target.value as UiStatus)}>
              {NEW_APP_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS[s].label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">Date applied</label>
            <input type="date" className="input" style={{ marginTop: 6 }} value={form.dateIso} onChange={(e) => set("dateIso", e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 11, marginTop: 13 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">Source</label>
            <select className="select" style={{ marginTop: 6 }} value={form.source} onChange={(e) => set("source", e.target.value)}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">Work type</label>
            <select className="select" style={{ marginTop: 6 }} value={form.workType ?? ""} onChange={(e) => set("workType", (e.target.value || null) as WorkType | null)}>
              {WORK_TYPES.map((w) => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 11, marginTop: 13 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">Location</label>
            <input className="input" style={{ marginTop: 6 }} value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Berlin / Remote" />
          </div>
          <div style={{ flex: 1 }}>
            <label className="field-label">Salary</label>
            <input className="input" style={{ marginTop: 6 }} inputMode="numeric" value={form.salary == null ? "" : String(form.salary)} onChange={(e) => { const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10); set("salary", Number.isFinite(n) ? n : null); }} placeholder="e.g. 120000" />
          </div>
        </div>
        <div style={{ marginTop: 13 }}>
          <label className="field-label">Résumé version</label>
          <input className="input" style={{ marginTop: 6 }} value={form.resumeVersion} onChange={(e) => set("resumeVersion", e.target.value)} placeholder="e.g. Frontend résumé" />
        </div>

        {err && <div style={{ font: "500 12px var(--sans)", color: "#a85544", marginTop: 12 }}>Add a company and role to continue.</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button className="btn" style={{ flex: 1, justifyContent: "center", color: "#3f4a44" }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={save}>Add application</button>
        </div>
      </div>
    </>
  );
}
