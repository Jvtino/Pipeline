// imap.js — generic IMAP provider for the desktop app (any provider that allows
// an app password): iCloud, Yahoo, Fastmail, AOL, Proton (Bridge), work accounts…
// Uses imapflow (connection) + mailparser (MIME). The map-to-threads logic is a
// pure function, unit-tested headlessly; only connectAndFetch touches the network.
"use strict";
let ImapFlow, simpleParser;
try { ({ ImapFlow } = require("imapflow")); } catch (e) { /* installed via npm install */ }
try { ({ simpleParser } = require("mailparser")); } catch (e) { /* installed via npm install */ }

const HOST_PRESETS = {
  "gmail.com": "imap.gmail.com", "googlemail.com": "imap.gmail.com",
  "outlook.com": "outlook.office365.com", "hotmail.com": "outlook.office365.com",
  "live.com": "outlook.office365.com", "msn.com": "outlook.office365.com",
  "yahoo.com": "imap.mail.yahoo.com", "ymail.com": "imap.mail.yahoo.com",
  "icloud.com": "imap.mail.me.com", "me.com": "imap.mail.me.com", "mac.com": "imap.mail.me.com",
  "aol.com": "imap.aol.com", "fastmail.com": "imap.fastmail.com",
  "proton.me": "127.0.0.1", "protonmail.com": "127.0.0.1", // needs Proton Bridge
  "zoho.com": "imap.zoho.com", "gmx.com": "imap.gmx.com",
};
function hostFor(email) {
  const dom = String(email || "").split("@")[1];
  return dom ? (HOST_PRESETS[dom.toLowerCase()] || "") : "";
}

const SEARCH_TERMS = [
  { subject: "application" }, { subject: "applying" }, { subject: "interview" },
  { subject: "candidacy" }, { subject: "recruiting" }, { subject: "position" }, { subject: "offer" },
  { body: "thank you for applying" }, { body: "your application" },
];

// ---- pure mapping (testable) ----
function domainOf(addr) {
  const m = String(addr || "").match(/@([^>\s]+)/);
  return m ? m[1].toLowerCase() : (addr || "unknown");
}
function isoDate(d) {
  const dt = d instanceof Date ? d : new Date(d || Date.now());
  return isNaN(dt) ? new Date().toISOString().slice(0, 10) : dt.toISOString().slice(0, 10);
}
function normSubject(s) {
  // Strip the [external] tag FIRST — otherwise a leading "[EXTERNAL] " blocks the
  // Re/Fwd prefix stripping below and the thread fails to group with its siblings.
  let x = String(s || "").replace(/\[external\]/ig, "");
  for (let i = 0; i < 3; i++) x = x.replace(/^\s*(re|fwd|fw)\s*:\s*/i, "");
  return x.replace(/\s+/g, " ").trim().toLowerCase();
}
function bodyText(parsed) {
  let t = parsed.text || "";
  if (!t && parsed.html) t = String(parsed.html).replace(/<[^>]+>/g, " ");
  return t.replace(/\s+/g, " ").trim().slice(0, 600);
}
function mapParsedToThreads(parsedList) {
  const groups = new Map();
  for (const p of parsedList || []) {
    const fromAddr = (p.from && p.from.value && p.from.value[0] && p.from.value[0].address) || "";
    const fromText = (p.from && p.from.text) || fromAddr || "unknown";
    const subject = p.subject || "(no subject)";
    const key = domainOf(fromAddr) + "|" + normSubject(subject);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      date: isoDate(p.date),
      from: fromText,
      domain: domainOf(fromAddr),
      subject,
      body: bodyText(p),
    });
  }
  const threads = [];
  for (const [key, msgs] of groups) {
    msgs.sort((a, b) => a.date.localeCompare(b.date));
    threads.push({
      threadId: "imap-" + Buffer.from(key).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16),
      domain: msgs[0].domain,
      subject: msgs[0].subject,
      messages: msgs.map(({ date, from, body }) => ({ date, from, body })),
    });
  }
  threads.sort((a, b) => b.messages[b.messages.length - 1].date.localeCompare(a.messages[a.messages.length - 1].date));
  return threads;
}

// Spam/junk folder names used by common providers (tried in order after INBOX).
const SPAM_FOLDERS = ["Junk", "Junk Email", "[Gmail]/Spam", "Spam", "Bulk Mail"];

async function connectAndFetch({ email, pass, host, port, sinceDays }) {
  if (!ImapFlow || !simpleParser) throw new Error("IMAP support needs `npm install` (imapflow, mailparser).");
  host = host || hostFor(email);
  if (!host) throw new Error("Unknown IMAP host for this address — please specify a host.");
  const client = new ImapFlow({ host, port: port || 993, secure: true, auth: { user: email, pass }, logger: false });
  const parsed = [];
  await client.connect();
  try {
    const since = new Date(Date.now() - (sinceDays || 365) * 86400000);
    for (const folder of ["INBOX", ...SPAM_FOLDERS]) {
      if (parsed.length >= 400) break;
      try { await client.mailboxOpen(folder, { readOnly: true }); }
      catch (e) { continue; }  // folder absent on this provider — skip
      const uids = new Set();
      for (const term of SEARCH_TERMS) {
        try { (await client.search({ since, ...term }, { uid: true }) || []).forEach((u) => uids.add(u)); }
        catch (e) { /* skip a failing term */ }
      }
      const list = [...uids].sort((a, b) => b - a).slice(0, 200);
      if (list.length) {
        for await (const msg of client.fetch(list, { source: true }, { uid: true })) {
          try { parsed.push(await simpleParser(msg.source)); } catch (e) { /* skip */ }
          if (parsed.length >= 400) break;
        }
      }
    }
  } finally {
    try { await client.logout(); } catch (e) {}
  }
  return { account: email, threads: mapParsedToThreads(parsed) };
}

module.exports = { hostFor, connectAndFetch, mapParsedToThreads, domainOf, isoDate, normSubject, bodyText, HOST_PRESETS };
