// msgraph.js — Microsoft Graph OAuth (device/loopback PKCE) + job-mail fetch.
// Pure Node standard library (https + crypto). No external dependencies.
// OAuth bypasses the basic-auth/IMAP block, so this reads real Outlook mail.
//
// The mapping helpers (mapMessagesToThreads, domainOf, isoDate) are pure and
// unit-tested headlessly; the network functions are thin wrappers around them.

"use strict";
const https = require("https");
const crypto = require("crypto");

const AUTHORITY = "login.microsoftonline.com";
const TENANT = "consumers"; // personal Microsoft accounts (Outlook.com / live / hotmail)
const SCOPE = "openid email offline_access https://graph.microsoft.com/Mail.Read";

// Keyword search sent to Graph ($search). Broad on purpose — the app's own
// classifier refines status afterward. Single words avoid nested-quote escaping.
const SEARCH_KQL = "application OR applying OR interview OR candidacy OR candidate OR recruiting OR position OR offer";
const MAX_MESSAGES = 1000;   // safety cap across all result pages

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------
function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pkceVerifier() { return b64url(crypto.randomBytes(32)); }
function pkceChallenge(verifier) { return b64url(crypto.createHash("sha256").update(verifier).digest()); }

function buildAuthUrl(clientId, redirectUri, challenge) {
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://${AUTHORITY}/${TENANT}/oauth2/v2.0/authorize?${p.toString()}`;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function postForm(host, path, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const req = https.request(
      { host, path, method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let d = ""; res.on("data", (c) => (d += c));
        res.on("end", () => {
          let j; try { j = JSON.parse(d); } catch (e) { return reject(new Error("bad token response")); }
          if (j.error) return reject(new Error(j.error_description || j.error));
          resolve(j);
        });
      });
    req.on("error", reject); req.write(body); req.end();
  });
}

function getJson(host, path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, path, method: "GET", headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let d = ""; res.on("data", (c) => (d += c));
        res.on("end", () => {
          let j; try { j = JSON.parse(d); } catch (e) { return reject(new Error("bad graph response")); }
          if (j.error) return reject(new Error((j.error && j.error.message) || "graph error"));
          resolve(j);
        });
      });
    req.on("error", reject); req.end();
  });
}

function exchangeCode(clientId, redirectUri, code, verifier) {
  return postForm(AUTHORITY, `/${TENANT}/oauth2/v2.0/token`, {
    client_id: clientId, grant_type: "authorization_code", code,
    redirect_uri: redirectUri, code_verifier: verifier, scope: SCOPE,
  });
}
function refresh(clientId, refreshToken) {
  return postForm(AUTHORITY, `/${TENANT}/oauth2/v2.0/token`, {
    client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken, scope: SCOPE,
  });
}

// ---------------------------------------------------------------------------
// Pure mapping: Graph messages -> Provider thread shape (testable, no network)
//   thread = { threadId, domain, subject, messages:[{date, from, body}] }
// ---------------------------------------------------------------------------
function domainOf(addr) {
  const m = String(addr || "").match(/@([^>\s]+)/);
  return m ? m[1].toLowerCase() : (addr || "unknown");
}
function isoDate(s) {
  try { const d = new Date(s); return isNaN(d) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
function mapMessagesToThreads(messages) {
  const groups = new Map();
  for (const m of messages || []) {
    const conv = m.conversationId || m.id || Math.random().toString(36).slice(2);
    const ea = (m.from && m.from.emailAddress) || {};
    const addr = ea.address || "";
    const name = ea.name || addr;
    if (!groups.has(conv)) groups.set(conv, []);
    groups.get(conv).push({
      date: isoDate(m.receivedDateTime),
      from: addr && name && name !== addr ? `${name} <${addr}>` : (addr || name || "unknown"),
      domain: domainOf(addr),
      subject: m.subject || "(no subject)",
      body: String(m.bodyPreview || "").replace(/\s+/g, " ").trim().slice(0, 600),
    });
  }
  const threads = [];
  for (const [conv, msgs] of groups) {
    msgs.sort((a, b) => a.date.localeCompare(b.date));
    threads.push({
      threadId: conv,
      domain: msgs[0].domain,
      subject: msgs[0].subject,
      messages: msgs.map(({ date, from, body }) => ({ date, from, body })),
    });
  }
  threads.sort((a, b) => b.messages[b.messages.length - 1].date.localeCompare(a.messages[a.messages.length - 1].date));
  return threads;
}

// ---------------------------------------------------------------------------
// Network fetch
// ---------------------------------------------------------------------------
async function getEmail(token) {
  const me = await getJson("graph.microsoft.com", "/v1.0/me?$select=mail,userPrincipalName", token);
  return me.mail || me.userPrincipalName || "mailbox";
}

async function fetchJobThreads(token) {
  let account = "mailbox";
  try { account = await getEmail(token); } catch (e) { /* non-fatal */ }

  // Page through ALL matching mail via @odata.nextLink (previously we read a
  // single page, which silently capped results at ~100 messages).
  const search = encodeURIComponent(`"${SEARCH_KQL}"`);
  const mkPath = (top) =>
    `/v1.0/me/messages?$search=${search}` +
    `&$select=subject,from,receivedDateTime,bodyPreview,conversationId&$top=${top}`;
  const all = [];
  const seen = new Set();
  let path = mkPath(100);
  let firstPage = true;
  while (path && all.length < MAX_MESSAGES) {
    let data;
    try {
      data = await getJson("graph.microsoft.com", path, token);
    } catch (e) {
      // Some tenants cap $top on $search queries — retry once with a small page.
      if (firstPage) { firstPage = false; path = mkPath(25); continue; }
      throw e;
    }
    firstPage = false;
    for (const m of data.value || []) {
      if (m.id && seen.has(m.id)) continue;
      if (m.id) seen.add(m.id);
      all.push(m);
    }
    const next = data["@odata.nextLink"];
    path = next ? next.replace(/^https:\/\/graph\.microsoft\.com/, "") : null;
  }
  // Also search the Junk Email folder — the main /me/messages search may miss it
  // on consumer accounts. Well-known folder id "junkemail" works for all personal mailboxes.
  try {
    const junkPath = `/v1.0/me/mailFolders/junkemail/messages?$search=${search}` +
      `&$select=subject,from,receivedDateTime,bodyPreview,conversationId&$top=50`;
    const junk = await getJson("graph.microsoft.com", junkPath, token);
    for (const m of junk.value || []) {
      if (m.id && seen.has(m.id)) continue;
      if (m.id) seen.add(m.id);
      all.push(m);
    }
  } catch (e) { /* non-fatal — junk folder unavailable */ }

  return { account, threads: mapMessagesToThreads(all) };
}

module.exports = {
  SCOPE, pkceVerifier, pkceChallenge, buildAuthUrl,
  exchangeCode, refresh, getEmail, fetchJobThreads,
  mapMessagesToThreads, domainOf, isoDate,
};
