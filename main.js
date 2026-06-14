// main.js — Electron main process (multi-provider).
// Providers: Google (gmail.js) + Microsoft (msgraph.js) via OAuth, and any other
// mailbox via generic IMAP (imap.js). Connect several at once; their applications
// merge into one view. Credentials/tokens are encrypted with the OS keychain
// (Electron safeStorage) and stored only in the user-data dir — never in the repo.

"use strict";
const { app, BrowserWindow, ipcMain, shell, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");

const gmail = require("./gmail");
const msgraph = require("./msgraph");
const imap = require("./imap");

const OAUTH = { google: gmail, microsoft: msgraph };
const accountsPath = () => path.join(app.getPath("userData"), "pipeline-accounts.json");

// ---------------------------------------------------------------------------
// Config (Azure / Google client IDs)
// ---------------------------------------------------------------------------
function loadConfig() {
  let raw = {};
  for (const p of [path.join(__dirname, "config.json"), path.join(app.getPath("userData"), "config.json")]) {
    try { raw = JSON.parse(fs.readFileSync(p, "utf8")); break; } catch (e) { /* try next */ }
  }
  // Normalize + env overrides; accept legacy flat {clientId} as Microsoft.
  const microsoft = raw.microsoft || (raw.clientId ? { clientId: raw.clientId } : {});
  const google = raw.google || {};
  if (process.env.MS_CLIENT_ID) microsoft.clientId = process.env.MS_CLIENT_ID;
  if (process.env.GOOGLE_CLIENT_ID) google.clientId = process.env.GOOGLE_CLIENT_ID;
  if (process.env.GOOGLE_CLIENT_SECRET) google.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return { microsoft, google };
}

// ---------------------------------------------------------------------------
// Encrypted account store
// ---------------------------------------------------------------------------
function encryptSecret(obj) {
  const s = JSON.stringify(obj);
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    return { enc: true, data: safeStorage.encryptString(s).toString("base64") };
  }
  return { enc: false, data: Buffer.from(s, "utf8").toString("base64") };
}
function decryptSecret(rec) {
  const buf = Buffer.from(rec.data, "base64");
  const s = rec.enc ? safeStorage.decryptString(buf) : buf.toString("utf8");
  return JSON.parse(s);
}
function loadAccounts() { try { return JSON.parse(fs.readFileSync(accountsPath(), "utf8")); } catch (e) { return []; } }
function saveAccounts(list) { try { fs.writeFileSync(accountsPath(), JSON.stringify(list), { mode: 0o600 }); } catch (e) {} }
function addAccount(provider, email, secret) {
  const list = loadAccounts().filter((a) => !(a.provider === provider && a.email === email)); // de-dupe
  list.push({ id: crypto.randomBytes(6).toString("hex"), provider, email, secret: encryptSecret(secret) });
  saveAccounts(list);
}
function updateSecret(id, secret) {
  const list = loadAccounts();
  const a = list.find((x) => x.id === id);
  if (a) { a.secret = encryptSecret(secret); saveAccounts(list); }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 880, minWidth: 720, backgroundColor: "#07090e", title: "Pipeline",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "index.html"));
}
app.whenReady().then(() => {
  // dev runs show the Pipeline icon in the Dock (packaged builds use icon.icns)
  if (process.platform === "darwin" && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, "build", "icon.png")); } catch (e) {}
  }
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

// ---------------------------------------------------------------------------
// OAuth (loopback + PKCE)
// ---------------------------------------------------------------------------
function startLoopback() {
  return new Promise((resolve) => {
    let ok, fail;
    const codePromise = new Promise((res, rej) => { ok = res; fail = rej; });
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://localhost");
      const code = u.searchParams.get("code");
      const err = u.searchParams.get("error_description") || u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!doctype html><meta charset=utf-8><body style=\"font-family:-apple-system,sans-serif;background:#07090e;color:#e8edf5;text-align:center;padding-top:90px\">" +
        (code ? "<h2>Connected ✓</h2><p>You can close this tab and return to Pipeline.</p>" :
                "<h2>Sign-in failed</h2><p>" + (err || "Unknown error") + "</p>") + "</body>");
      if (code) ok(code); else fail(new Error(err || "no code returned"));
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, codePromise }));
  });
}

async function connectOAuth(provider) {
  const mod = OAUTH[provider];
  const conf = loadConfig()[provider] || {};
  if (!conf.clientId) throw new Error(`No ${provider} client ID configured — see DESKTOP.md (config.json).`);
  if (provider === "google" && !conf.clientSecret) throw new Error("Google needs clientId + clientSecret in config.json.");
  const verifier = mod.pkceVerifier();
  const challenge = mod.pkceChallenge(verifier);
  const { server, port, codePromise } = await startLoopback();
  const redirectUri = `http://localhost:${port}`;
  try {
    await shell.openExternal(mod.buildAuthUrl(conf.clientId, redirectUri, challenge));
    const code = await codePromise;
    const tokens = provider === "google"
      ? await gmail.exchangeCode(conf.clientId, conf.clientSecret, redirectUri, code, verifier)
      : await msgraph.exchangeCode(conf.clientId, redirectUri, code, verifier);
    tokens.obtained_at = Date.now();
    let email = "mailbox";
    try { email = await mod.getEmail(tokens.access_token); } catch (e) {}
    addAccount(provider, email, tokens);
    return { ok: true, email };
  } finally { try { server.close(); } catch (e) {} }
}

async function validAccessToken(acct, secret) {
  const expired = Date.now() - (secret.obtained_at || 0) > (secret.expires_in || 3600) * 1000 - 60000;
  if (secret.access_token && !expired) return secret.access_token;
  if (!secret.refresh_token) return null;
  const conf = loadConfig()[acct.provider] || {};
  const nt = acct.provider === "google"
    ? await gmail.refresh(conf.clientId, conf.clientSecret, secret.refresh_token)
    : await msgraph.refresh(conf.clientId, secret.refresh_token);
  nt.obtained_at = Date.now();
  if (!nt.refresh_token) nt.refresh_token = secret.refresh_token;
  updateSecret(acct.id, nt);
  return nt.access_token;
}

async function fetchForAccount(acct) {
  const secret = decryptSecret(acct.secret);
  if (acct.provider === "imap") return imap.connectAndFetch(secret);
  const token = await validAccessToken(acct, secret);
  if (!token) throw new Error("token expired — reconnect");
  return OAUTH[acct.provider].fetchJobThreads(token);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle("pipeline:listAccounts", async () =>
  loadAccounts().map((a) => ({ id: a.id, provider: a.provider, email: a.email })));

ipcMain.handle("pipeline:connect", async (_e, { provider, opts } = {}) => {
  try {
    if (provider === "imap") {
      const res = await imap.connectAndFetch(opts);   // validates creds
      addAccount("imap", opts.email, opts);
      return { ok: true, email: res.account || opts.email };
    }
    return await connectOAuth(provider);
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

ipcMain.handle("pipeline:disconnect", async (_e, id) => {
  saveAccounts(loadAccounts().filter((a) => a.id !== id));
  return { ok: true };
});

ipcMain.handle("pipeline:openExternal", (_e, url) => {
  if (typeof url === "string" && url.startsWith("https://")) shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle("pipeline:fetchThreads", async () => {
  const accts = loadAccounts();
  if (!accts.length) return { error: "not connected" };
  const threads = [];
  const connected = [];
  const errors = [];
  for (const a of accts) {
    try {
      const r = await fetchForAccount(a);
      for (const t of r.threads || []) threads.push({ ...t, threadId: a.id + ":" + t.threadId });
      connected.push(a.email);
    } catch (e) { errors.push(`${a.email}: ${String((e && e.message) || e)}`); }
  }
  threads.sort((x, y) => y.messages[y.messages.length - 1].date.localeCompare(x.messages[x.messages.length - 1].date));
  const account = connected.length <= 1 ? (connected[0] || "mailbox") : `${connected.length} mailboxes`;
  return { account, threads, accounts: connected, errors };
});
