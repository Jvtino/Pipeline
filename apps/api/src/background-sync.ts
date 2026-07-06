// In-app management of the always-local background-sync LaunchAgent (macOS).
//
// The web UI toggles background sync; this module (running in the local API
// process, which has filesystem + launchctl access) does the work. It is
// deliberately conservative:
//   • Only a LOCAL macOS install can install the agent. A hosted deployment
//     (DATABASE_URL set) syncs server-side already — there is nothing to toggle.
//   • It only ever touches its OWN fixed-label plist at a fixed path.
//   • It shells out to launchctl with a fixed argv via execFile (no shell), and
//     every path in the generated plist is single-quoted for the agent's shell
//     and XML-escaped — no request data can reach a command line.
//
// (A future packaged desktop build would manage this through the OS app
// lifecycle; from the current local API this is the safe, pragmatic mechanism.)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const LABEL = "com.pipeline.sync";
const MIN_INTERVAL = 5;
const MAX_INTERVAL = 1440;
const DEFAULT_INTERVAL = 30;

export type SyncMode = "local" | "hosted" | "unsupported";
export interface BackgroundSyncStatus {
  mode: SyncMode;
  supported: boolean; // can the in-app toggle install/remove the agent here?
  enabled: boolean; // is the agent currently installed?
  intervalMinutes: number | null;
  reason?: string; // why it's hosted/unsupported (shown in the UI)
}

/** Coerce a requested cadence to a safe integer number of minutes. */
export function clampInterval(m: unknown): number {
  const n = Math.round(Number(m));
  if (!Number.isFinite(n)) return DEFAULT_INTERVAL;
  return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, n));
}

/** Repo root = the nearest ancestor directory holding pnpm-workspace.yaml. */
export function findRepoRoot(from: string = dirname(fileURLToPath(import.meta.url))): string | null {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function plistPath(home: string): string {
  return join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
}

const xmlEsc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const shellArg = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`; // safe single-quote for zsh -lc

/** The launchd plist for the agent. Pure — the unit under test. */
export function renderPlist(agentPath: string, repo: string, home: string, intervalMs: number): string {
  const log = join(home, "Library", "Logs", "PipelineSync.log");
  const cmd = xmlEsc(`exec ${shellArg(agentPath)} ${shellArg(repo)}`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${cmd}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>SYNC_INTERVAL_MS</key><string>${Math.round(intervalMs)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xmlEsc(log)}</string>
  <key>StandardErrorPath</key><string>${xmlEsc(log)}</string>
</dict>
</plist>
`;
}

function readIntervalMinutes(plist: string): number | null {
  const m = plist.match(/SYNC_INTERVAL_MS<\/key>\s*<string>(\d+)<\/string>/);
  return m ? Math.round(Number(m[1]) / 60_000) : null;
}

/** Current status: which mode we're in and whether the agent is installed. */
export function backgroundSyncStatus(opts: { local: boolean; home?: string }): BackgroundSyncStatus {
  const home = opts.home ?? homedir();
  if (!opts.local) {
    return { mode: "hosted", supported: false, enabled: true, intervalMinutes: null, reason: "This deployment syncs on the server automatically — nothing to turn on." };
  }
  if (platform() !== "darwin") {
    return { mode: "unsupported", supported: false, enabled: false, intervalMinutes: null, reason: "The background-sync agent is available on macOS." };
  }
  const p = plistPath(home);
  if (!existsSync(p)) return { mode: "local", supported: true, enabled: false, intervalMinutes: null };
  let interval: number | null = DEFAULT_INTERVAL;
  try { interval = readIntervalMinutes(readFileSync(p, "utf8")); } catch { /* keep default */ }
  return { mode: "local", supported: true, enabled: true, intervalMinutes: interval };
}

/** Install (enabled) or remove (disabled) the agent. No-op + reason when unsupported. */
export async function setBackgroundSync(opts: {
  local: boolean;
  enabled: boolean;
  intervalMinutes?: number;
  home?: string;
}): Promise<BackgroundSyncStatus> {
  const status = backgroundSyncStatus(opts);
  if (!status.supported) return status; // hosted / non-macOS → do nothing, report why
  const home = opts.home ?? homedir();
  const p = plistPath(home);

  if (opts.enabled) {
    const repo = findRepoRoot();
    if (!repo) {
      return { mode: "local", supported: true, enabled: existsSync(p), intervalMinutes: null, reason: "Couldn't locate the Pipeline app folder." };
    }
    const agent = join(repo, "launchers", "mac-app", "sync-agent.sh");
    const mins = clampInterval(opts.intervalMinutes);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, renderPlist(agent, repo, home, mins * 60_000), "utf8");
    try { await execFileP("launchctl", ["unload", p]); } catch { /* not loaded yet */ }
    await execFileP("launchctl", ["load", "-w", p]);
  } else {
    try { await execFileP("launchctl", ["unload", p]); } catch { /* not loaded */ }
    rmSync(p, { force: true });
  }
  return backgroundSyncStatus(opts);
}
