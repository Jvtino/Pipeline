// gmail.js — Google (Gmail) OAuth (PKCE, loopback) + job-mail fetch.
// Pure Node standard library (https + crypto). No external dependencies.
// Uses Gmail's message.snippet + metadata headers, so there's no base64/MIME
// decoding — the mapping is simple and unit-tested headlessly.
"use strict";
const https = require("https");
const crypto = require("crypto");

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_Q =
  'in:anywhere newer_than:1y (subject:(application OR applying OR interview OR candidacy OR ' +
  'recruiting OR position OR offer) OR "thank you for applying" OR "your application" ' +
  'OR "received your application")';
const MAX_THREADS = 200;
const MAX_IDS = 800;   // message-list paging cap

function b64url(b) { return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function pkceVerifier() { return b64url(crypto.randomBytes(32)); }
function pkceChallenge(v) { return b64url(crypto.createHash("sha256").update(v).digest()); }

function buildAuthUrl(clientId, redirectUri, challenge) {
  const p = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent",
    code_challenge: challenge, code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

function postForm(host, path, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const req = https.request(
      { host, path, method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => {
        let j; try { j = JSON.parse(d); } catch (e) { return reject(new Error("bad token response")); }
        if (j.error) return reject(new Error(j.error_description || j.error));
        resolve(j);
      }); });
    req.on("error", reject); req.write(body); req.end();
  });
}
function getJson(host, path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path, method: "GET", headers: { Authorization: `Bearer ${token}` } },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => {
        let j; try { j = JSON.parse(d); } catch (e) { return reject(new Error("bad gmail response")); }
        if (j.error) return reject(new Error((j.error && j.error.message) || "gmail error"));
        resolve(j);
      }); });
    req.on("error", reject); req.end();
  });
}

function exchangeCode(clientId, clientSecret, redirectUri, code, verifier) {
  return postForm("oauth2.googleapis.com", "/token", {
    client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri,
    grant_type: "authorization_code", code_verifier: verifier,
  });
}
function refresh(clientId, clientSecret, refreshToken) {
  return postForm("oauth2.googleapis.com", "/token", {
    client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token",
  });
}

// ---- pure mapping (testable) ----
function header(headers, name) {
  const h = (headers || []).find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}
function domainOf(from) {
  const m = String(from || "").match(/@([^>\s]+)/);
  return m ? m[1].toLowerCase() : "unknown";
}
function isoFromInternal(ms, dateHeader) {
  let d = ms ? new Date(Number(ms)) : new Date(dateHeader || Date.now());
  if (isNaN(d)) d = new Date();
  return d.toISOString().slice(0, 10);
}
function mapGmailThread(thread) {
  const msgs = (thread.messages || []).map((m) => {
    const hs = (m.payload && m.payload.headers) || [];
    const from = header(hs, "From");
    return {
      date: isoFromInternal(m.internalDate, header(hs, "Date")),
      from: from || "unknown",
      domain: domainOf(from),
      subject: header(hs, "Subject") || "(no subject)",
      body: String(m.snippet || "").replace(/\s+/g, " ").trim().slice(0, 600),
    };
  });
  msgs.sort((a, b) => a.date.localeCompare(b.date));
  return {
    threadId: thread.id,
    domain: (msgs[0] || {}).domain || "unknown",
    subject: (msgs[0] || {}).subject || "(no subject)",
    messages: msgs.map(({ date, from, body }) => ({ date, from, body })),
  };
}

async function getEmail(token) {
  const p = await getJson("gmail.googleapis.com", "/gmail/v1/users/me/profile", token);
  return p.emailAddress || "mailbox";
}

async function fetchJobThreads(token) {
  let account = "mailbox";
  try { account = await getEmail(token); } catch (e) {}

  // Page through the full message list (previously one page silently capped results).
  const ids = [];
  const idSet = new Set();
  let pageToken = "";
  do {
    const list = await getJson("gmail.googleapis.com",
      `/gmail/v1/users/me/messages?q=${encodeURIComponent(GMAIL_Q)}&maxResults=100` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""), token);
    for (const m of list.messages || []) {
      if (m.threadId && !idSet.has(m.threadId)) { idSet.add(m.threadId); ids.push(m.threadId); }
    }
    pageToken = list.nextPageToken || "";
  } while (pageToken && idSet.size < MAX_IDS);

  const threads = [];
  for (const id of ids.slice(0, MAX_THREADS)) {
    try {
      const t = await getJson("gmail.googleapis.com",
        `/gmail/v1/users/me/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, token);
      threads.push(mapGmailThread(t));
    } catch (e) { /* skip a bad thread */ }
  }
  threads.sort((a, b) => b.messages[b.messages.length - 1].date.localeCompare(a.messages[a.messages.length - 1].date));
  return { account, threads };
}

module.exports = {
  SCOPE, pkceVerifier, pkceChallenge, buildAuthUrl, exchangeCode, refresh,
  getEmail, fetchJobThreads, mapGmailThread, domainOf, header, isoFromInternal,
};
