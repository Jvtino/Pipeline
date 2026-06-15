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

import os, re, sys, ssl, json, email, imaplib, hashlib
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime, parseaddr
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

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
    for _ in range(3):
        s = re.sub(r"(?i)^\s*(re|fwd|fw)\s*:\s*", "", s)
    s = re.sub(r"(?i)\[external\]", "", s)
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
# HTTP server (static files + /api/threads)
# ----------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    # The UI is a single self-contained page, so we serve ONLY index.html and the
    # API — never arbitrary files. A generic file server would otherwise hand out
    # .imap_pw, config.json, .git/… to anything that can reach 127.0.0.1:PORT.
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/threads":
            return self.handle_threads()
        if path in ("/", "/index.html"):
            return self.serve_index()
        return self.send_error(404, "Not found")

    def serve_index(self):
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html"), "rb") as f:
                body = f.read()
        except OSError:
            return self.send_error(404, "index.html not found")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def handle_threads(self):
        cfg = get_config()
        if not (cfg["user"] and cfg["password"] and cfg["host"]):
            return self.send_json(
                {"error": "not configured",
                 "hint": "set IMAP_USER and IMAP_PASSWORD (and IMAP_HOST for an unlisted provider)"})
        try:
            threads = fetch_threads(cfg)
        except imaplib.IMAP4.error as e:
            return self.send_json({"error": "imap login or search failed", "detail": str(e)})
        except Exception as e:
            return self.send_json({"error": "fetch failed", "detail": str(e)})
        return self.send_json(threads, headers={"X-Mail-Account": cfg["user"]})

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

    def log_message(self, fmt, *args):  # quieter logs — only the API line
        # str() so a non-str first arg (e.g. an HTTPStatus on error responses)
        # can't raise "argument of type 'HTTPStatus' is not iterable".
        first = str(args[0]) if args else ""
        if "/api/threads" in first:
            super().log_message(fmt, *args)


if __name__ == "__main__":
    cfg = get_config()
    port = int(os.environ.get("PORT", "8000"))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"\n  Pipeline  →  http://localhost:{port}\n")
    if cfg["user"] and cfg["host"]:
        print(f"  IMAP: {cfg['user']}  via  {cfg['host']}:{cfg['port']}  (folder: {cfg['folder']})")
    else:
        print("  IMAP: not configured — showing demo data.")
        print("  Set IMAP_USER and IMAP_PASSWORD to read a real mailbox.")
    print("\n  Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.")
