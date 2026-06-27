#!/usr/bin/env python3
"""
Pipeline — OAuth providers for the web backend (Google Gmail + Microsoft Graph).

This is the Python counterpart of the desktop app's gmail.js / msgraph.js. It
implements the OAuth 2.0 Authorization Code + PKCE flow and the job-mail fetch,
returning the SAME unified thread shape the rest of the app understands:

    { threadId, domain, subject, messages:[{date, from, body}] }

Why this exists: the IMAP web path can't read personal Outlook.com mail anymore
(Microsoft disabled basic-auth/app-password IMAP in 2024) and Gmail IMAP needs an
app password. OAuth fixes both. server.py wires the auth routes; this module does
the protocol + mapping. The mapping helpers are pure and unit-tested headlessly
(see test/providers_test.py).

Zero dependencies — Python standard library only (urllib + hashlib + secrets).
"""

import os, re, json, base64, hashlib, secrets, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone

BODY_CHARS = 600


# ---------------------------------------------------------------------------
# Provider definitions
# ---------------------------------------------------------------------------
# Microsoft uses the "consumers" tenant for personal accounts (outlook/live/hotmail).
MS_TENANT = "consumers"
GMAIL_Q = (
    'in:anywhere newer_than:1y (subject:(application OR applying OR interview OR '
    'candidacy OR recruiting OR position OR offer) OR "thank you for applying" '
    'OR "your application" OR "received your application")'
)
MS_SEARCH_KQL = (
    "application OR applying OR interview OR candidacy OR candidate OR "
    "recruiting OR position OR offer"
)

PROVIDERS = {
    "google": {
        "label": "Google",
        "scope": "https://www.googleapis.com/auth/gmail.readonly",
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "needs_secret": True,   # Google "Web application" clients require a client secret
        # Google-specific auth params (offline + consent to always receive a refresh token)
        "extra_auth": {"access_type": "offline", "prompt": "consent"},
    },
    "microsoft": {
        "label": "Microsoft",
        "scope": "openid email offline_access https://graph.microsoft.com/Mail.Read",
        "auth_url": "https://login.microsoftonline.com/%s/oauth2/v2.0/authorize" % MS_TENANT,
        "token_url": "https://login.microsoftonline.com/%s/oauth2/v2.0/token" % MS_TENANT,
        "needs_secret": False,  # public client (PKCE), no secret
        "extra_auth": {"response_mode": "query", "prompt": "select_account"},
    },
}


# ---------------------------------------------------------------------------
# PKCE
# ---------------------------------------------------------------------------
def _b64url(b):
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")

def pkce_verifier():
    return _b64url(secrets.token_bytes(32))

def pkce_challenge(verifier):
    return _b64url(hashlib.sha256(verifier.encode("ascii")).digest())


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib urllib; returns parsed JSON even on 4xx/5xx error bodies)
# ---------------------------------------------------------------------------
def _request(method, url, headers=None, data=None, timeout=30):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8") or "{}"
            return r.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace") or "{}"
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw[:300]}

def _post_form(url, form):
    data = urllib.parse.urlencode(form).encode("utf-8")
    status, j = _request("POST", url, {"Content-Type": "application/x-www-form-urlencoded"}, data)
    err = j.get("error_description") or j.get("error")
    if err and not j.get("access_token"):
        raise RuntimeError(str(err))
    return j

def _get_json(url, token):
    status, j = _request("GET", url, {"Authorization": "Bearer %s" % token})
    if isinstance(j, dict) and j.get("error"):
        e = j["error"]
        raise RuntimeError(e.get("message") if isinstance(e, dict) else str(e))
    return j


# ---------------------------------------------------------------------------
# OAuth flow (provider-agnostic)
# ---------------------------------------------------------------------------
def build_auth_url(provider, client_id, redirect_uri, challenge, state):
    p = PROVIDERS[provider]
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": p["scope"],
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
    }
    params.update(p.get("extra_auth", {}))
    return p["auth_url"] + "?" + urllib.parse.urlencode(params)

def exchange_code(provider, conf, redirect_uri, code, verifier):
    p = PROVIDERS[provider]
    form = {
        "client_id": conf["clientId"],
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "code_verifier": verifier,
        "scope": p["scope"],
    }
    if p["needs_secret"]:
        form["client_secret"] = conf.get("clientSecret", "")
    tokens = _post_form(p["token_url"], form)
    tokens["obtained_at"] = int(datetime.now(timezone.utc).timestamp() * 1000)
    return tokens

def refresh(provider, conf, refresh_token):
    p = PROVIDERS[provider]
    form = {
        "client_id": conf["clientId"],
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "scope": p["scope"],
    }
    if p["needs_secret"]:
        form["client_secret"] = conf.get("clientSecret", "")
    tokens = _post_form(p["token_url"], form)
    tokens["obtained_at"] = int(datetime.now(timezone.utc).timestamp() * 1000)
    return tokens

def valid_access_token(provider, conf, secret, on_refresh=None):
    """Return a usable access token, refreshing if needed. on_refresh(new_secret)
    lets the caller persist rotated tokens."""
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    expires_ms = (secret.get("expires_in") or 3600) * 1000
    expired = now_ms - (secret.get("obtained_at") or 0) > expires_ms - 60000
    if secret.get("access_token") and not expired:
        return secret["access_token"]
    if not secret.get("refresh_token"):
        return None
    nt = refresh(provider, conf, secret["refresh_token"])
    if not nt.get("refresh_token"):
        nt["refresh_token"] = secret["refresh_token"]
    if on_refresh:
        on_refresh(nt)
    return nt.get("access_token")


# ---------------------------------------------------------------------------
# Pure mapping helpers (no network — unit-tested)
# ---------------------------------------------------------------------------
def domain_of(addr):
    m = re.search(r"@([^>\s]+)", str(addr or ""))
    return m.group(1).lower() if m else (str(addr) if addr else "unknown")

def iso_date(s):
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d.astimezone(timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def _iso_from_ms(ms, fallback_iso=None):
    try:
        d = datetime.fromtimestamp(int(ms) / 1000, timezone.utc)
        return d.strftime("%Y-%m-%d")
    except Exception:
        return iso_date(fallback_iso) if fallback_iso else datetime.now(timezone.utc).strftime("%Y-%m-%d")

def _clean(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()[:BODY_CHARS]

def _gmail_header(headers, name):
    for h in headers or []:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""

def map_gmail_thread(thread):
    msgs = []
    for m in thread.get("messages", []) or []:
        hs = (m.get("payload") or {}).get("headers") or []
        frm = _gmail_header(hs, "From")
        msgs.append({
            "date": _iso_from_ms(m.get("internalDate"), _gmail_header(hs, "Date")),
            "from": frm or "unknown",
            "domain": domain_of(frm),
            "subject": _gmail_header(hs, "Subject") or "(no subject)",
            "body": _clean(m.get("snippet")),
        })
    msgs.sort(key=lambda x: x["date"])
    first = msgs[0] if msgs else {}
    return {
        "threadId": thread.get("id", ""),
        "domain": first.get("domain", "unknown"),
        "subject": first.get("subject", "(no subject)"),
        "messages": [{"date": m["date"], "from": m["from"], "body": m["body"]} for m in msgs],
    }

def map_graph_messages(messages):
    groups = {}
    for m in messages or []:
        conv = m.get("conversationId") or m.get("id") or secrets.token_hex(4)
        ea = (m.get("from") or {}).get("emailAddress") or {}
        addr = ea.get("address") or ""
        name = ea.get("name") or addr
        frm = ("%s <%s>" % (name, addr)) if (addr and name and name != addr) else (addr or name or "unknown")
        groups.setdefault(conv, []).append({
            "date": iso_date(m.get("receivedDateTime")),
            "from": frm,
            "domain": domain_of(addr),
            "subject": m.get("subject") or "(no subject)",
            "body": _clean(m.get("bodyPreview")),
        })
    threads = []
    for conv, msgs in groups.items():
        msgs.sort(key=lambda x: x["date"])
        threads.append({
            "threadId": conv,
            "domain": msgs[0]["domain"],
            "subject": msgs[0]["subject"],
            "messages": [{"date": m["date"], "from": m["from"], "body": m["body"]} for m in msgs],
        })
    threads.sort(key=lambda t: t["messages"][-1]["date"], reverse=True)
    return threads


# ---------------------------------------------------------------------------
# Network fetch
# ---------------------------------------------------------------------------
def get_email(provider, token):
    if provider == "google":
        p = _get_json("https://gmail.googleapis.com/gmail/v1/users/me/profile", token)
        return p.get("emailAddress") or "mailbox"
    me = _get_json("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", token)
    return me.get("mail") or me.get("userPrincipalName") or "mailbox"

def _fetch_gmail(token):
    account = "mailbox"
    try:
        account = get_email("google", token)
    except Exception:
        pass
    # Page the message list → unique thread ids.
    ids, seen, page_token = [], set(), ""
    while True:
        url = ("https://gmail.googleapis.com/gmail/v1/users/me/messages?q=%s&maxResults=100"
               % urllib.parse.quote(GMAIL_Q))
        if page_token:
            url += "&pageToken=" + urllib.parse.quote(page_token)
        data = _get_json(url, token)
        for m in data.get("messages", []) or []:
            tid = m.get("threadId")
            if tid and tid not in seen:
                seen.add(tid); ids.append(tid)
        page_token = data.get("nextPageToken") or ""
        if not page_token or len(seen) >= 800:
            break
    threads = []
    for tid in ids[:200]:
        try:
            t = _get_json(
                "https://gmail.googleapis.com/gmail/v1/users/me/threads/%s"
                "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date" % tid,
                token)
            threads.append(map_gmail_thread(t))
        except Exception:
            continue
    threads.sort(key=lambda t: t["messages"][-1]["date"] if t["messages"] else "", reverse=True)
    return {"account": account, "threads": threads}

def _fetch_graph(token):
    account = "mailbox"
    try:
        account = get_email("microsoft", token)
    except Exception:
        pass
    search = urllib.parse.quote('"%s"' % MS_SEARCH_KQL)
    select = "subject,from,receivedDateTime,bodyPreview,conversationId"
    all_msgs, seen = [], set()
    url = ("https://graph.microsoft.com/v1.0/me/messages?$search=%s&$select=%s&$top=100"
           % (search, urllib.parse.quote(select)))
    first_page = True
    while url and len(all_msgs) < 1000:
        try:
            data = _get_json(url, token)
        except Exception:
            if first_page:   # some tenants cap $top on $search — retry smaller once
                first_page = False
                url = ("https://graph.microsoft.com/v1.0/me/messages?$search=%s&$select=%s&$top=25"
                       % (search, urllib.parse.quote(select)))
                continue
            raise
        first_page = False
        for m in data.get("value", []) or []:
            mid = m.get("id")
            if mid and mid in seen:
                continue
            if mid:
                seen.add(mid)
            all_msgs.append(m)
        url = data.get("@odata.nextLink") or None
    # Junk folder too — consumer search can miss it.
    try:
        junk = _get_json(
            "https://graph.microsoft.com/v1.0/me/mailFolders/junkemail/messages?$search=%s&$select=%s&$top=50"
            % (search, urllib.parse.quote(select)), token)
        for m in junk.get("value", []) or []:
            mid = m.get("id")
            if mid and mid in seen:
                continue
            if mid:
                seen.add(mid)
            all_msgs.append(m)
    except Exception:
        pass
    return {"account": account, "threads": map_graph_messages(all_msgs)}

def fetch_job_threads(provider, token):
    return _fetch_gmail(token) if provider == "google" else _fetch_graph(token)
