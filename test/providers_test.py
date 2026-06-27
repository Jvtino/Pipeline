#!/usr/bin/env python3
"""
Headless unit tests for providers.py — the pure OAuth-mapping + URL-building
functions (no network). Mirrors test/mappers.test.js for the Node modules.

    python3 -m unittest discover -s test -p '*_test.py'
"""
import os, sys, unittest, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import providers as P


class ThreadShapeMixin:
    def assert_thread_shape(self, t):
        self.assertIsInstance(t["threadId"], str)
        self.assertIsInstance(t["domain"], str)
        self.assertIsInstance(t["subject"], str)
        self.assertTrue(t["messages"])
        for m in t["messages"]:
            self.assertRegex(m["date"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertEqual(set(m.keys()), {"date", "from", "body"})  # exact unified shape


class TestHelpers(unittest.TestCase):
    def test_domain_of(self):
        self.assertEqual(P.domain_of("Careers <Careers@Stripe.com>"), "stripe.com")
        self.assertEqual(P.domain_of("careers@stripe.com"), "stripe.com")
        self.assertEqual(P.domain_of("no-at"), "no-at")
        self.assertEqual(P.domain_of(""), "unknown")

    def test_iso_date(self):
        self.assertEqual(P.iso_date("2026-06-15T10:00:00Z"), "2026-06-15")
        self.assertRegex(P.iso_date("garbage"), r"^\d{4}-\d{2}-\d{2}$")

    def test_iso_from_ms(self):
        self.assertEqual(P._iso_from_ms("1717200000000"), "2024-06-01")
        self.assertRegex(P._iso_from_ms(None, "not-a-date"), r"^\d{4}-\d{2}-\d{2}$")

    def test_pkce(self):
        v = P.pkce_verifier()
        c = P.pkce_challenge(v)
        # base64url: no padding, no +/ characters
        for s in (v, c):
            self.assertNotIn("=", s)
            self.assertNotIn("+", s)
            self.assertNotIn("/", s)
        self.assertEqual(P.pkce_challenge(v), c)  # deterministic for a given verifier


class TestAuthUrl(unittest.TestCase):
    def _params(self, url):
        return dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))

    def test_google_auth_url(self):
        url = P.build_auth_url("google", "gid", "http://localhost:8000/auth/google/callback", "chal", "st")
        self.assertTrue(url.startswith("https://accounts.google.com/o/oauth2/v2/auth?"))
        p = self._params(url)
        self.assertEqual(p["client_id"], "gid")
        self.assertEqual(p["redirect_uri"], "http://localhost:8000/auth/google/callback")
        self.assertEqual(p["code_challenge"], "chal")
        self.assertEqual(p["code_challenge_method"], "S256")
        self.assertEqual(p["state"], "st")
        self.assertEqual(p["access_type"], "offline")   # google-specific
        self.assertEqual(p["prompt"], "consent")
        self.assertIn("gmail.readonly", p["scope"])

    def test_microsoft_auth_url(self):
        url = P.build_auth_url("microsoft", "mid", "http://localhost:8000/auth/microsoft/callback", "chal", "st")
        self.assertIn("login.microsoftonline.com/consumers/oauth2/v2.0/authorize", url)
        p = self._params(url)
        self.assertEqual(p["client_id"], "mid")
        self.assertEqual(p["code_challenge_method"], "S256")
        self.assertEqual(p["response_mode"], "query")
        self.assertIn("Mail.Read", p["scope"])


class TestGmailMapping(unittest.TestCase, ThreadShapeMixin):
    def test_map_thread_sorts_and_derives_meta(self):
        t = P.map_gmail_thread({"id": "thr1", "messages": [
            {"internalDate": "1718000000000", "snippet": "schedule a call",
             "payload": {"headers": [{"name": "From", "value": "Rec <rec@acme.com>"},
                                     {"name": "Subject", "value": "Re: Engineer"}]}},
            {"internalDate": "1717200000000", "snippet": "thank you for applying",
             "payload": {"headers": [{"name": "From", "value": "Careers <careers@acme.com>"},
                                     {"name": "Subject", "value": "Engineer"}]}},
        ]})
        self.assert_thread_shape(t)
        self.assertEqual(t["threadId"], "thr1")
        self.assertEqual(t["domain"], "acme.com")
        self.assertEqual(t["subject"], "Engineer")
        self.assertEqual([m["date"] for m in t["messages"]], ["2024-06-01", "2024-06-10"])

    def test_missing_fields(self):
        t = P.map_gmail_thread({"id": "x", "messages": [{"internalDate": "1717200000000"}]})
        self.assertEqual(t["messages"][0]["from"], "unknown")
        self.assertEqual(t["messages"][0]["body"], "")
        self.assertEqual(t["domain"], "unknown")


class TestGraphMapping(unittest.TestCase, ThreadShapeMixin):
    def test_group_sort_format(self):
        threads = P.map_graph_messages([
            {"conversationId": "c1", "subject": "Offer", "receivedDateTime": "2026-06-15T10:00:00Z",
             "from": {"emailAddress": {"name": "Talent", "address": "talent@contoso.com"}},
             "bodyPreview": "we are pleased to offer you"},
            {"conversationId": "c1", "subject": "Interview", "receivedDateTime": "2026-06-10T10:00:00Z",
             "from": {"emailAddress": {"name": "Rec", "address": "rec@contoso.com"}}, "bodyPreview": "interview"},
            {"conversationId": "c2", "subject": "Other", "receivedDateTime": "2026-06-12T10:00:00Z",
             "from": {"emailAddress": {"address": "jobs@globex.io"}}, "bodyPreview": "thanks"},
        ])
        self.assertEqual(len(threads), 2)
        for t in threads:
            self.assert_thread_shape(t)
        self.assertEqual(threads[0]["threadId"], "c1")               # newest-activity first
        c1 = threads[0]
        self.assertEqual([m["date"] for m in c1["messages"]], ["2026-06-10", "2026-06-15"])
        self.assertEqual(c1["messages"][0]["from"], "Rec <rec@contoso.com>")
        self.assertEqual(threads[1]["messages"][0]["from"], "jobs@globex.io")

    def test_empty_and_missing(self):
        self.assertEqual(P.map_graph_messages([]), [])
        self.assertEqual(P.map_graph_messages(None), [])
        t = P.map_graph_messages([{"conversationId": "z", "receivedDateTime": "2026-01-01T00:00:00Z"}])
        self.assertEqual(t[0]["domain"], "unknown")
        self.assertEqual(t[0]["subject"], "(no subject)")


if __name__ == "__main__":
    unittest.main()
