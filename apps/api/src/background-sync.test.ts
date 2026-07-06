import { describe, it, expect } from "vitest";
import { clampInterval, renderPlist, backgroundSyncStatus, setBackgroundSync, findRepoRoot } from "./background-sync";

describe("background-sync", () => {
  it("clampInterval keeps a safe integer cadence", () => {
    expect(clampInterval(30)).toBe(30);
    expect(clampInterval(1)).toBe(5); // floor
    expect(clampInterval(99999)).toBe(1440); // ceiling
    expect(clampInterval("nonsense")).toBe(30); // default
    expect(clampInterval(45.6)).toBe(46); // rounded
  });

  it("renderPlist produces a valid, correctly-escaped launchd plist", () => {
    const xml = renderPlist("/Users/me/Pipeline/launchers/mac-app/sync-agent.sh", "/Users/me/Pipeline", "/Users/me", 1_800_000);
    expect(xml).toContain("<key>Label</key><string>com.pipeline.sync</string>");
    expect(xml).toContain("<key>SYNC_INTERVAL_MS</key><string>1800000</string>");
    expect(xml).toContain("<key>RunAtLoad</key><true/>");
    expect(xml).toContain("<key>KeepAlive</key><true/>");
    // paths are single-quoted for the agent's shell, inside the exec string
    expect(xml).toContain("exec '/Users/me/Pipeline/launchers/mac-app/sync-agent.sh' '/Users/me/Pipeline'");
  });

  it("renderPlist XML-escapes special characters in paths", () => {
    const xml = renderPlist("/tmp/a & b/agent.sh", "/tmp/a & b", "/home/x", 60_000);
    expect(xml).toContain(" &amp; "); // the ampersand is XML-escaped
    expect(xml).not.toContain(" & "); // and never left raw (would break the plist XML)
  });

  it("reports 'hosted' when not in local mode — nothing to toggle", () => {
    const s = backgroundSyncStatus({ local: false });
    expect(s.mode).toBe("hosted");
    expect(s.supported).toBe(false);
    expect(s.reason).toMatch(/server/i);
  });

  it("reports 'unsupported' off macOS and never shells out", async () => {
    // The test runner is Linux/CI (non-darwin): status is unsupported and a
    // set() call is a safe no-op that never touches launchctl or the filesystem.
    if (process.platform === "darwin") return; // the guard is what we're testing
    const s = backgroundSyncStatus({ local: true });
    expect(s.mode).toBe("unsupported");
    expect(s.supported).toBe(false);
    const after = await setBackgroundSync({ local: true, enabled: true, intervalMinutes: 30 });
    expect(after.supported).toBe(false); // no-op, no throw, no launchctl
  });

  it("findRepoRoot locates the monorepo root", () => {
    expect(findRepoRoot()).toBeTruthy(); // resolves pnpm-workspace.yaml from the api package
  });
});
