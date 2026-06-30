import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { loadOrCreateLocalSecrets, localStateDir, localDbDir } from "./local-state";

describe("local-state persistence", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pipeline-localstate-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates secrets on first run and returns the SAME ones on the next run", () => {
    const first = loadOrCreateLocalSecrets(dir);
    expect(Buffer.from(first.masterKey, "base64").length).toBe(32); // valid AES-256 key
    expect(first.sessionSecret.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, "secrets.json"))).toBe(true);

    // A "restart" — reads the persisted file rather than regenerating.
    const second = loadOrCreateLocalSecrets(dir);
    expect(second).toEqual(first);
  });

  it("regenerates when the secrets file is corrupt or incomplete", () => {
    writeFileSync(join(dir, "secrets.json"), "not json at all");
    const a = loadOrCreateLocalSecrets(dir);
    expect(Buffer.from(a.masterKey, "base64").length).toBe(32);

    // A structurally-present but invalid master key is also rejected + replaced.
    writeFileSync(join(dir, "secrets.json"), JSON.stringify({ masterKey: "tooshort", sessionSecret: "" }));
    const b = loadOrCreateLocalSecrets(dir);
    expect(Buffer.from(b.masterKey, "base64").length).toBe(32);
    expect(b.sessionSecret.length).toBeGreaterThan(0);
  });

  it("localStateDir honours PIPELINE_HOME and otherwise defaults to ~/.pipeline", () => {
    expect(localStateDir({ PIPELINE_HOME: "/custom/path" } as NodeJS.ProcessEnv)).toBe("/custom/path");
    expect(localStateDir({} as NodeJS.ProcessEnv)).toBe(join(homedir(), ".pipeline"));
  });

  it("localDbDir returns and creates <dir>/db", () => {
    const db = localDbDir(dir);
    expect(db).toBe(join(dir, "db"));
    expect(statSync(db).isDirectory()).toBe(true);
  });
});
