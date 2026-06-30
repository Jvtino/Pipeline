// Onboarding / Connect takeover. Shown on first run or after Disconnect. The
// provider buttons start the real OAuth flow (which navigates away), so there's
// no faked scan counter here — the post-connect toast is handled by App via the
// ?connect= redirect. A subtle "explore with demo data" path keeps the app
// usable without connecting (the API ships demo data out of the box).
import { Logo } from "./lib/icons";
import { IconMail, IconShield } from "./lib/icons";

export function Onboarding({ onDemo }: { onDemo: () => void }) {
  return (
    <div className="onboarding">
      <div style={{ width: 452, maxWidth: "100%", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 11, marginBottom: 8 }}>
          <Logo size={30} />
          <span style={{ font: "600 24px var(--serif)" }}>Pipeline</span>
        </div>
        <div style={{ font: "500 28px/1.18 var(--serif)", color: "var(--text)", marginTop: 18 }}>
          Connect your inbox to
          <br />
          see where you stand.
        </div>
        <div style={{ font: "400 14px/1.6 var(--sans)", color: "#7a7468", marginTop: 12, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
          Pipeline reads your mail <b style={{ color: "#3f4a44" }}>read-only</b> and turns every job-application email into a clean, organized board — automatically.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 26 }}>
          <a href="/auth/google/start" style={provBtn}>
            <IconMail size={18} color="#c06a57" />
            Connect Gmail
          </a>
          <a href="/auth/microsoft/start" style={provBtn}>
            <IconMail size={18} color="#6c7d96" />
            Connect Outlook
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 20, font: "500 12px var(--sans)", color: "var(--muted-2)" }}>
          <IconShield size={13} color="#2f9266" />
          We store derived records only — never your raw email.
        </div>
        <button onClick={onDemo} style={{ marginTop: 18, background: "transparent", border: "none", color: "var(--primary)", font: "600 12.5px var(--sans)", cursor: "pointer" }}>
          Skip — explore with demo data
        </button>
      </div>
    </div>
  );
}

const provBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  width: "100%",
  padding: 13,
  background: "#fff",
  border: "1px solid rgba(34,31,26,.14)",
  borderRadius: 12,
  font: "600 14px var(--sans)",
  color: "#3f4a44",
  cursor: "pointer",
  textDecoration: "none",
  boxShadow: "0 2px 8px -2px rgba(34,31,26,.1)",
};
