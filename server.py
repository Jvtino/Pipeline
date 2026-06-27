#!/usr/bin/env python3
"""
Pipeline — local backend.

Serves the static UI (index.html) AND a live data endpoint:

    GET /api/threads  ->  [{ threadId, domain, subject, messages:[{date,from,body}] }, ...]

It reads a real mailbox over IMAP using an *app password* and returns the
exact thread shape the frontend already understands — so the UI classifies and
groups the live data with no changes. If no credentials are configured (or the
connection fails) it returns a small {error} object and the UI falls back to
demo data.

Zero dependencies — Python standard library only.

Run:
    IMAP_USER="you@gmail.com" IMAP_PASSWORD="your-app-password" python3 server.py
    # then open http://localhost:8000

Config (environment variables):
    IMAP_USER         full email address                (required)
    IMAP_PASSWORD     app password, NOT your login pw    (required)
    IMAP_HOST         override server (auto-detected for common providers)
    IMAP_PORT         default 993
    IMAP_FOLDER       default "INBOX"  (Gmail tip: "[Gmail]/All Mail" to include archived)
    IMAP_SINCE_DAYS   how far back to look, default 365
    PORT              web server port, default 8000
"""

import os, re, sys, ssl, json, email, imaplib, hashlib, secrets, urllib.parse
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime, parseaddr
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

import providers   # Gmail + Microsoft Graph OAuth (zero-dependency, see providers.py)

# IMAP host auto-detection from the email domain, so users usually only need
# to provide IMAP_USER + IMAP_PASSWORD.
HOST_PRESETS = {
    "gmail.com": "imap.gmail.com",      "googlemail.com": "imap.gmail.com",
    "outlook.com": "outlook.office365.com", "hotmail.com": "outlook.office365.com",
    "live.com": "outlook.office365.com",    "msn.com": "outlook.office365.com",
    "yahoo.com": "imap.mail.yahoo.com",
    "icloud.com": "imap.mail.me.com",   "me.com": "imap.mail.me.com", "mac.com": "imap.mail.me.com",
    "aol.com": "imap.aol.com",
    "proton.me": "127.0.0.1", "protonmail.com": "127.0.0.1",  # requires Proton Bridge locally
}

# Subject / body terms that catch most job-application mail. Each runs as a
# separate IMAP search (ANDed with SINCE) and the results are unioned.
SEARCH_TERMS = [
    ("SUBJECT", "application"), ("SUBJECT", "applying"), ("SUBJECT", "candidacy"),
    ("SUBJECT", "candidate"),   ("SUBJECT", "interview"), ("SUBJECT", "position"),
    ("SUBJECT", "recruiting"),  ("SUBJECT", "your role"),
    ("TEXT", "thank you for applying"), ("TEXT", "received your application"),
    ("TEXT", "your application"),       ("TEXT", "move forward with your application"),
]

MAX_MESSAGES = 300       # safety cap on how many emails we pull
BODY_CHARS   = 600       # snippet length stored per message


# ----------------------------------------------------------------------------
# config
# ----------------------------------------------------------------------------
def _read_file(name):
    """Read a trimmed value from a file next to this script (if present)."""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), name)) as f:
            return f.read().strip()
    except Exception:
        return ""

def get_config():
    # Credentials may come from env vars OR local git-ignored files (.imap_user /
    # .imap_pw) so the password never has to be typed on a command line or shared.
    user = os.environ.get("IMAP_USER", "").strip() or _read_file(".imap_user")
    pw   = os.environ.get("IMAP_PASSWORD", "")     or _read_file(".imap_pw")
    # Last resort: prompt in an interactive terminal (input hidden, never stored).
    if user and not pw and sys.stdin and sys.stdin.isatty():
        import getpass
        try:
            pw = getpass.getpass("App password for %s: " % user)
        except Exception:
            pass
    host = os.environ.get("IMAP_HOST", "").strip()
    if user and not host:
        host = HOST_PRESETS.get(user.split("@")[-1].lower(), "")
    return {
        "user": user, "password": pw, "host": host,
        "port": int(os.environ.get("IMAP_PORT", "993")),
        "folder": os.environ.get("IMAP_FOLDER", "INBOX"),
        "since_days": int(os.environ.get("IMAP_SINCE_DAYS", "365")),
    }


# ----------------------------------------------------------------------------
# OAuth config + local single-user account store
# ----------------------------------------------------------------------------
# This backend is LOCAL-FIRST and SINGLE-USER: it runs on your own machine, does
# the OAuth loopback flow in your browser, and stores tokens in a git-ignored
# file (0600) next to this script. Tokens are NOT encrypted at rest here (the
# desktop app uses the OS keychain) — they're protected by file permissions and
# the fact that the file never leaves your machine. Deleting the file = sign out.
APP_PORT = int(os.environ.get("PORT", "8000"))
ACCOUNTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".pipeline-accounts.json")
_pending = {}   # state -> {provider, verifier}  (in-memory; single-user, single-process)

def load_oauth_config():
    """Provider client IDs/secrets from config.json (same file the desktop uses),
    with env-var overrides. Only OAuth providers need entries here."""
    raw = {}
    for p in (os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json"),
              os.path.join(os.path.expanduser("~"), ".pipeline", "config.json")):
        try:
            with open(p) as f:
                raw = json.load(f); break
        except Exception:
            continue
    microsoft = raw.get("microsoft") or ({"clientId": raw["clientId"]} if raw.get("clientId") else {})
    google = raw.get("google") or {}
    if os.environ.get("MS_CLIENT_ID"):        microsoft["clientId"] = os.environ["MS_CLIENT_ID"]
    if os.environ.get("GOOGLE_CLIENT_ID"):    google["clientId"] = os.environ["GOOGLE_CLIENT_ID"]
    if os.environ.get("GOOGLE_CLIENT_SECRET"): google["clientSecret"] = os.environ["GOOGLE_CLIENT_SECRET"]
    return {"google": google, "microsoft": microsoft}

def provider_configured(conf, provider):
    c = conf.get(provider) or {}
    if not c.get("clientId"):
        return False
    if providers.PROVIDERS[provider]["needs_secret"] and not c.get("clientSecret"):
        return False
    return True

def load_accounts():
    try:
        with open(ACCOUNTS_FILE) as f:
            a = json.load(f)
            return a if isinstance(a, list) else []
    except Exception:
        return []

def save_accounts(lst):
    try:
        with open(ACCOUNTS_FILE, "w") as f:
            json.dump(lst, f)
        os.chmod(ACCOUNTS_FILE, 0o600)
    except Exception:
        pass

def add_account(provider, email_addr, secret):
    lst = [a for a in load_accounts() if not (a.get("provider") == provider and a.get("email") == email_addr)]
    lst.append({"id": secrets.token_hex(6), "provider": provider, "email": email_addr, "secret": secret})
    save_accounts(lst)

def update_account_secret(acct_id, secret):
    lst = load_accounts()
    for a in lst:
        if a.get("id") == acct_id:
            a["secret"] = secret
    save_accounts(lst)

def redirect_uri(provider):
    return "http://localhost:%d/auth/%s/callback" % (APP_PORT, provider)


# ----------------------------------------------------------------------------
# email parsing helpers
# ----------------------------------------------------------------------------
def header(msg, name):
    raw = msg.get(name, "")
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw or ""

def decode_part(part):
    payload = part.get_payload(decode=True) or b""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, "replace")
    except Exception:
        return payload.decode("utf-8", "replace")

def strip_html(html):
    html = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html)
    html = re.sub(r"(?s)<[^>]+>", " ", html)
    html = html.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#39;", "'")
    return re.sub(r"&[a-zA-Z#0-9]+;", " ", html)

def get_body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            disp = str(part.get("Content-Disposition", ""))
            if part.get_content_type() == "text/plain" and "attachment" not in disp:
                return decode_part(part)
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                return strip_html(decode_part(part))
        return ""
    body = decode_part(msg)
    return strip_html(body) if msg.get_content_type() == "text/html" else body

def clean(text):
    return re.sub(r"\s+", " ", text).strip()

def iso_date(msg):
    try:
        dt = parsedate_to_datetime(msg.get("Date"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def domain_of(addr):
    _, e = parseaddr(addr)
    return e.split("@")[-1].lower() if "@" in e else (e or "unknown")

def norm_subject(s):
    # Strip the [external] tag FIRST — a leading "[EXTERNAL] " would otherwise
    # block the Re/Fwd prefix stripping and split a thread from its siblings.
    s = re.sub(r"(?i)\[external\]", "", s)
    for _ in range(3):
        s = re.sub(r"(?i)^\s*(re|fwd|fw)\s*:\s*", "", s)
    return clean(s).lower()


# ----------------------------------------------------------------------------
# IMAP fetch
# ----------------------------------------------------------------------------
def search_uids(M, since):
    sd = since.strftime("%d-%b-%Y")
    found = set()
    for key, val in SEARCH_TERMS:
        try:
            typ, data = M.uid("SEARCH", None, "SINCE", sd, key, '"%s"' % val)
            if typ == "OK" and data and data[0]:
                found.update(int(u) for u in data[0].split())
        except Exception:
            continue
    return sorted(found, reverse=True)  # newest first

def fetch_messages(M, uids):
    out = []
    for i in range(0, len(uids[:MAX_MESSAGES]), 40):
        batch = ",".join(str(u) for u in uids[i:i + 40])
        try:
            typ, data = M.uid("FETCH", batch, "(BODY.PEEK[])")
        except Exception:
            continue
        if typ != "OK" or not data:
            continue
        for part in data:
            if isinstance(part, tuple) and len(part) > 1 and part[1]:
                try:
                    out.append(email.message_from_bytes(part[1]))
                except Exception:
                    pass
    return out

def build_threads(parsed):
    """Group messages into one thread per (sender domain + normalized subject)."""
    groups = {}
    for m in parsed:
        key = m["domain"] + "|" + norm_subject(m["subject"])
        groups.setdefault(key, []).append(m)

    threads = []
    for key, items in groups.items():
        items.sort(key=lambda x: x["date"])  # oldest first
        threads.append({
            "threadId": hashlib.md5(key.encode()).hexdigest()[:12],
            "domain": items[0]["domain"],
            "subject": items[0]["subject"],  # original subject usually has the role
            "messages": [
                {"date": it["date"], "from": it["from"], "body": it["body"]}
                for it in items
            ],
        })
    threads.sort(key=lambda t: t["messages"][-1]["date"], reverse=True)
    return threads

def fetch_threads(cfg):
    M = imaplib.IMAP4_SSL(cfg["host"], cfg["port"], ssl_context=ssl.create_default_context())
    try:
        M.login(cfg["user"], cfg["password"])
        M.select(cfg["folder"], readonly=True)
        since = datetime.now(timezone.utc) - timedelta(days=cfg["since_days"])
        messages = fetch_messages(M, search_uids(M, since))
        parsed = []
        for msg in messages:
            frm = header(msg, "From")
            parsed.append({
                "subject": header(msg, "Subject"),
                "from": frm,
                "domain": domain_of(frm),
                "date": iso_date(msg),
                "body": clean(get_body(msg))[:BODY_CHARS],
            })
        return build_threads(parsed)
    finally:
        try:
            M.logout()
        except Exception:
            pass


# ----------------------------------------------------------------------------
# Unified fetch across all connected mailboxes (OAuth accounts + IMAP)
# ----------------------------------------------------------------------------
def _imap_cfg_from_account(secret):
    user = secret.get("email", "")
    host = secret.get("host") or HOST_PRESETS.get(user.split("@")[-1].lower(), "")
    return {"user": user, "password": secret.get("pass", ""), "host": host,
            "port": int(secret.get("port") or 993),
            "folder": secret.get("folder") or "INBOX",
            "since_days": int(secret.get("since_days") or 365)}

def fetch_all_threads():
    """Fetch + merge every connected mailbox into one unified thread list.
    Returns {threads, connected, errors}. Each thread id is namespaced by account
    so ids never collide across mailboxes."""
    conf = load_oauth_config()
    accounts = load_accounts()
    threads, connected, errors = [], [], []
    for a in accounts:
        prov, secret, aid = a.get("provider"), a.get("secret") or {}, a.get("id", "")
        try:
            if prov in ("google", "microsoft"):
                token = providers.valid_access_token(
                    prov, conf.get(prov, {}), secret,
                    on_refresh=lambda nt, _id=aid: update_account_secret(_id, nt))
                if not token:
                    raise RuntimeError("token expired — reconnect")
                r = providers.fetch_job_threads(prov, token)
            elif prov == "imap":
                r = {"account": secret.get("email", "mailbox"),
                     "threads": fetch_threads(_imap_cfg_from_account(secret))}
            else:
                continue
            for t in r.get("threads", []):
                if not t.get("messages"):
                    continue
                t = dict(t); t["threadId"] = aid + ":" + str(t.get("threadId", ""))
                threads.append(t)
            connected.append(r.get("account") or a.get("email"))
        except Exception as e:
            errors.append("%s: %s" % (a.get("email", prov), e))
    # Legacy single-mailbox path: IMAP via env vars when no accounts are stored.
    if not accounts:
        cfg = get_config()
        if cfg["user"] and cfg["password"] and cfg["host"]:
            try:
                for t in fetch_threads(cfg):
                    if t.get("messages"):
                        threads.append(t)
                connected.append(cfg["user"])
            except Exception as e:
                errors.append("%s: %s" % (cfg["user"], e))
    threads.sort(key=lambda t: t["messages"][-1]["date"] if t.get("messages") else "", reverse=True)
    return {"threads": threads, "connected": connected, "errors": errors}

def esc_html(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


# ----------------------------------------------------------------------------
# HTTP server (static UI + JSON API + OAuth routes)
# ----------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    # We serve ONLY an allowlist of static files (index.html, classify.js) plus the
    # API/auth routes — never arbitrary files. A generic file server would otherwise
    # hand out .imap_pw, config.json, .pipeline-accounts.json, .git/… to anything
    # that can reach 127.0.0.1:PORT.
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/threads":
            return self.handle_threads()
        if path == "/api/accounts":
            return self.handle_accounts()
        if path.startswith("/auth/"):
            parts = path.strip("/").split("/")        # ["auth", <provider>, <action>]
            if len(parts) == 3 and parts[1] in providers.PROVIDERS:
                if parts[2] == "start":    return self.handle_auth_start(parts[1])
                if parts[2] == "callback": return self.handle_auth_callback(parts[1])
            return self.send_error(404, "Not found")
        if path in ("/", "/index.html"):
            return self.serve_static("index.html", "text/html; charset=utf-8")
        if path == "/classify.js":
            return self.serve_static("classify.js", "application/javascript; charset=utf-8")
        return self.send_error(404, "Not found")

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api/disconnect":   return self.handle_disconnect()
        if path == "/api/imap/connect": return self.handle_imap_connect()
        return self.send_error(404, "Not found")

    def _read_json_body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
        except Exception:
            return {}

    def serve_static(self, name, content_type):
        # Explicit allowlist (index.html, classify.js) — NOT a generic file server,
        # so secrets like config.json / .pipeline-accounts.json / .git can't leak.
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), name), "rb") as f:
                body = f.read()
        except OSError:
            return self.send_error(404, "%s not found" % name)
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def handle_threads(self):
        cfg = get_config()
        has_env_imap = bool(cfg["user"] and cfg["password"] and cfg["host"])
        if not load_accounts() and not has_env_imap:
            return self.send_json(
                {"error": "not configured",
                 "hint": "connect a mailbox (Google / Microsoft / IMAP), or set IMAP_USER + IMAP_PASSWORD"})
        try:
            res = fetch_all_threads()
        except Exception as e:
            return self.send_json({"error": "fetch failed", "detail": str(e)})
        if not res["connected"] and res["errors"]:
            return self.send_json({"error": "mailbox connection failed", "detail": "; ".join(res["errors"])})
        conn = res["connected"]
        label = conn[0] if len(conn) == 1 else ("%d mailboxes" % len(conn) if conn else "mailbox")
        headers = {"X-Mail-Account": label}
        if res["errors"]:
            headers["X-Mail-Errors"] = ("; ".join(res["errors"]))[:300]
        return self.send_json(res["threads"], headers=headers)

    def handle_accounts(self):
        conf = load_oauth_config()
        accts = [{"id": a["id"], "provider": a["provider"], "email": a["email"]} for a in load_accounts()]
        return self.send_json({
            "configured": {p: provider_configured(conf, p) for p in providers.PROVIDERS},
            "accounts": accts,
        })

    def handle_auth_start(self, provider):
        conf = load_oauth_config()
        if not provider_configured(conf, provider):
            # NB: the 2nd arg (reason phrase) must be latin-1 / ASCII; put detail
            # text (which may contain non-ASCII) in the 3rd arg (HTML body).
            return self.send_error(400, "Provider not configured",
                                   "%s OAuth is not configured. See WEB-OAUTH.md / config.json." % provider)
        verifier = providers.pkce_verifier()
        state = secrets.token_urlsafe(16)
        _pending[state] = {"provider": provider, "verifier": verifier}
        url = providers.build_auth_url(provider, conf[provider]["clientId"],
                                       redirect_uri(provider), providers.pkce_challenge(verifier), state)
        self.send_response(302)
        self.send_header("Location", url)
        self.end_headers()

    def handle_auth_callback(self, provider):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        code = (qs.get("code") or [""])[0]
        state = (qs.get("state") or [""])[0]
        err = (qs.get("error_description") or qs.get("error") or [""])[0]
        pend = _pending.pop(state, None)
        if err or not code or not pend or pend["provider"] != provider:
            return self._auth_done_page(False, err or "sign-in was cancelled or the session expired")
        try:
            conf = load_oauth_config()
            tokens = providers.exchange_code(provider, conf[provider], redirect_uri(provider), code, pend["verifier"])
            email_addr = "mailbox"
            try:
                email_addr = providers.get_email(provider, tokens.get("access_token"))
            except Exception:
                pass
            add_account(provider, email_addr, tokens)
            return self._auth_done_page(True, email_addr)
        except Exception as e:
            return self._auth_done_page(False, str(e))

    def _auth_done_page(self, ok, detail):
        inner = ("<h2>Connected ✓</h2><p>%s</p><p>Returning to Pipeline…</p>" % esc_html(detail)
                 if ok else
                 "<h2>Sign-in failed</h2><p>%s</p><p><a style='color:#4f9cff' href='/'>Back to Pipeline</a></p>"
                 % esc_html(detail))
        body = ("<!doctype html><meta charset=utf-8>"
                + ("<meta http-equiv=refresh content='1;url=/'>" if ok else "")
                + "<body style=\"font-family:-apple-system,sans-serif;background:#07090e;"
                  "color:#e8edf5;text-align:center;padding-top:90px\">" + inner + "</body>")
        raw = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def handle_disconnect(self):
        acct_id = (self._read_json_body() or {}).get("id")
        save_accounts([a for a in load_accounts() if a.get("id") != acct_id])
        return self.send_json({"ok": True})

    def handle_imap_connect(self):
        data = self._read_json_body() or {}
        email_addr = (data.get("email") or "").strip()
        pw = data.get("pass") or ""
        host = (data.get("host") or "").strip() or HOST_PRESETS.get(email_addr.split("@")[-1].lower(), "")
        if not email_addr or not pw:
            return self.send_json({"ok": False, "error": "enter your email and app password"})
        if not host:
            return self.send_json({"ok": False, "error": "unknown IMAP host for this address — please specify one"})
        cfg = {"user": email_addr, "password": pw, "host": host,
               "port": 993, "folder": "INBOX", "since_days": 365}
        try:
            fetch_threads(cfg)   # validate credentials by actually connecting
        except Exception as e:
            return self.send_json({"ok": False, "error": str(e)})
        add_account("imap", email_addr, {"email": email_addr, "pass": pw, "host": host})
        return self.send_json({"ok": True, "email": email_addr})

    def send_json(self, obj, headers=None):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # quieter logs — only API + auth lines
        # str() so a non-str first arg (e.g. an HTTPStatus on error responses)
        # can't raise "argument of type 'HTTPStatus' is not iterable".
        first = str(args[0]) if args else ""
        if "/api/" in first or "/auth/" in first:
            super().log_message(fmt, *args)


if __name__ == "__main__":
    cfg = get_config()
    oconf = load_oauth_config()
    httpd = ThreadingHTTPServer(("127.0.0.1", APP_PORT), Handler)
    print(f"\n  Pipeline  →  http://localhost:{APP_PORT}\n")
    accts = load_accounts()
    if accts:
        print("  Connected mailboxes: " + ", ".join("%s (%s)" % (a["email"], a["provider"]) for a in accts))
    oauth_on = [p for p in providers.PROVIDERS if provider_configured(oconf, p)]
    print("  OAuth ready: " + (", ".join(oauth_on) if oauth_on else "none — add client IDs to config.json (see WEB-OAUTH.md)"))
    if cfg["user"] and cfg["host"]:
        print(f"  IMAP (env): {cfg['user']}  via  {cfg['host']}:{cfg['port']}  (folder: {cfg['folder']})")
    if not accts and not (cfg["user"] and cfg["host"]):
        print("  No mailbox connected yet — showing demo data. Click “Connect email” in the app.")
    print("\n  Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.")
