"""POLY-97 R3 / R8 harness for the operator tools. Stdlib only (Python 3.9 compatible).

Contract the tools must meet (test-plan.md, "Contract pins"):
  * infra/operator/<name>.py defines  main(argv, *, transport, getpass, input, stdout, stderr, runner=None, env=None, home=None) -> int
    and runs nothing at import time (`if __name__ == "__main__": sys.exit(main(sys.argv[1:], ...real ones...))`).
  * transport(method, url, headers, body) -> (status:int, parsed_json) is the only way a tool reaches a provider.
  * every credential part (key ids included) is read through `getpass`; `input` is for typed confirmations only.
Nothing here can reach a network: urlopen and socket.create_connection raise, so a missed injection fails loudly.
"""
import base64
import contextlib
import importlib.util
import io
import json
import os
import socket
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[3]
OPDIR = ROOT / "infra" / "operator"
ZONE = "polycarpic.com"
BUCKET = "polycarpic-hetzner-backups"
BUCKET_ID = "4a48fe8875c6214145260818"

# Fixture secrets: none of these may appear in any output or file a tool writes (R10).
SECRETS = {
    "b2_master_id": "0049fixturemasterid000000001",
    "b2_master_key": "K004FIXTUREMASTERKEYxxxxxxxxxxxxxx",
    "b2_token": "4_0049fixtureAUTHTOKEN_0000_0000000000_acct",
    "cf_token": "cfFIXTURETOKENabcdefghijklmnopqrstuvwx",
    "pb_key": "pk1_fixtureporkbunkey0000000000000000",
    "pb_secret": "sk1_fixtureporkbunsecret00000000000000",
}
NEW_KEY_SECRET = {"polycarpic-put-only": "K004NEWPUTONLYSECRETxxxxxxxxxxxxxxx", "polycarpic-read": "K004NEWREADSECRETxxxxxxxxxxxxxxxxx"}

DKIM = ("p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCqge5nT0o5S6dlEmfjwdQo6aWJU+vHgyHDsEH5E68k"
        "ZyrQakA9zP2fLKgR7PQBrnWfi71lY97U2zig65FfUm6AfF8nQGtNjEpt/AQbnnCkGLlAxm7azPgHyiLeCeuT"
        "F0I91khaVi53MOp3EMS2O20TwDaILCOOllFCrQVbeaFpYwIDAQAB")
IPV4, IPV6 = "203.0.113.7", "2001:db8:1::7"
# The allowed set of R9 plus Addendum 1 (three CAA rows; DMARC without rua until the Principal turns on DMARC Management).
ALLOWED = [
    ("@", "TXT", "v=spf1 -all"),
    ("@", "MX", ".", 0),
    ("@", "CAA", '0 issue "letsencrypt.org"'),
    ("@", "CAA", '0 issue "sectigo.com"'),
    ("@", "CAA", '0 issuewild ";"'),
    ("_dmarc", "TXT", "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=r"),
    ("send.mail", "CNAME", "send.forge.rmta.net"),
    ("rsend.mail", "CNAME", "rsend-euw1.forge.rmta.net"),
    ("resend._domainkey.mail", "TXT", DKIM),
]


def load(name):
    path = OPDIR / (name + ".py")
    if not path.exists():
        raise AssertionError("infra/operator/%s.py does not exist" % name)
    spec = importlib.util.spec_from_file_location("op_" + name.replace("-", "_"), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "main"):
        raise AssertionError("infra/operator/%s.py defines no main(argv, *, transport, getpass, input, stdout, stderr, ...)" % name)
    return mod


def fqdn(name):
    return ZONE if name == "@" else (name if name.endswith(ZONE) else name + "." + ZONE)


def rel(fq):
    return "@" if fq == ZONE else fq[: -len(ZONE) - 1]


class FakeCF(object):
    """Cloudflare v4: zones, paginated dns_records, create/delete. Records are stored as the API returns them (FQDN names)."""

    def __init__(self, records=None, token=SECRETS["cf_token"], page_size=100, lie_total=None, fail_list=False):
        self.token, self.page_size, self.lie_total, self.fail_list = token, page_size, lie_total, fail_list
        self.records, self.n = [], 0
        for r in records or []:
            self.add(**r)

    def add(self, type, name, content, ttl=3600, proxied=False, priority=None, data=None):
        self.n += 1
        rec = {"id": "rec%03d" % self.n, "type": type, "name": fqdn(name), "content": content, "ttl": ttl, "proxied": proxied}
        if priority is not None:
            rec["priority"] = priority
        self.records.append(rec)
        return rec

    def __call__(self, method, url, headers, body):
        if headers.get("Authorization") != "Bearer " + self.token:
            return 403, {"success": False, "errors": [{"code": 9109, "message": "Invalid access token"}]}
        u = urlparse(url)
        q = parse_qs(u.query)
        if u.path.endswith("/zones") and method == "GET":
            return 200, {"success": True, "result": [{"id": "zone1", "name": ZONE, "status": "active", "name_servers": ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]}]}
        if u.path.endswith("/dns_records") and method == "GET":
            if self.fail_list:
                return 200, {"success": False, "errors": [{"code": 1000, "message": "list failed"}], "result": []}
            page = int(q.get("page", ["1"])[0])
            per = min(self.page_size, int(q.get("per_page", ["100"])[0]))
            chunk = self.records[(page - 1) * per: page * per]
            total = len(self.records) if self.lie_total is None else self.lie_total
            return 200, {"success": True, "result": chunk, "result_info": {"page": page, "per_page": per, "count": len(chunk), "total_count": total, "total_pages": max(1, -(-total // per))}}
        if u.path.endswith("/dns_records") and method == "POST":
            if body.get("type") == "MX" and "priority" not in body:
                return 400, {"success": False, "errors": [{"message": "priority required"}]}
            rec = self.add(body["type"], rel(body["name"]) if body["name"].endswith(ZONE) else body["name"], body["content"], body.get("ttl", 1), body.get("proxied", False), body.get("priority"))
            return 200, {"success": True, "result": rec}
        if "/dns_records/" in u.path and method == "DELETE":
            rid = u.path.rsplit("/", 1)[1]
            self.records = [r for r in self.records if r["id"] != rid]
            return 200, {"success": True, "result": {"id": rid}}
        return 404, {"success": False, "errors": [{"message": "FAKE: unrouted %s %s" % (method, url)}]}


def good_zone():
    """A zone holding exactly the allowed set and both app records, as Cloudflare returns them (TXT and CAA content quoted)."""
    cf = FakeCF()
    for r in ALLOWED:
        name, typ, val = r[0], r[1], r[2]
        content = '"%s"' % val if typ == "TXT" else val
        cf.add(typ, name, content, priority=(r[3] if len(r) > 3 else None))
    for sub in ("app", "staging"):
        cf.add("A", sub, IPV4, ttl=300)
        cf.add("AAAA", sub, IPV6, ttl=300)
    return cf


class FakeDoH(object):
    """Cloudflare's JSON DNS-over-HTTPS endpoint: answers for the CNAME targets, empty by default (today's truth)."""

    def __init__(self, answers=None):
        self.answers, self.seen = answers or {}, []

    def __call__(self, method, url, headers, body):
        q = parse_qs(urlparse(url).query)
        name, typ = q["name"][0].rstrip("."), q["type"][0].upper()
        self.seen.append((name, typ))
        ans = self.answers.get((name, typ))
        return 200, ({"Status": 0, "Answer": ans} if ans else {"Status": 0})


class FakeB2(object):
    """Backblaze B2 native API v2 (the shapes in the prototypes' real runs, secrets replaced)."""

    def __init__(self, bucket=None, keys=None):
        self.master = (SECRETS["b2_master_id"], SECRETS["b2_master_key"])
        self.regenerated = False
        self.bucket = {
            "bucketId": BUCKET_ID, "bucketName": BUCKET, "bucketType": "allPrivate",
            "fileLockConfiguration": {"isClientAuthorizedToRead": True, "value": {"isFileLockEnabled": True, "defaultRetention": {"mode": "compliance", "period": {"duration": 35, "unit": "days"}}}},
            "lifecycleRules": [{"daysFromHidingToDeleting": 1, "daysFromUploadingToHiding": 36, "fileNamePrefix": ""}],
            "defaultServerSideEncryption": {"isClientAuthorizedToRead": True, "value": {"mode": "SSE-B2", "algorithm": "AES256"}},
        }
        self.bucket.update(bucket or {})
        self.keys, self.requests, self.created, self.deleted, self.n = list(keys or []), [], [], [], 0
        self.fail_create = None

    def add_key(self, name, caps, bucket=True, secret=None):
        self.n += 1
        k = {"applicationKeyId": "0049fixturekey%010d" % self.n, "keyName": name, "capabilities": list(caps), "bucketId": BUCKET_ID if bucket else None, "namePrefix": None}
        self.keys.append(k)
        return k

    def regenerate_master(self):
        self.regenerated = True

    def __call__(self, method, url, headers, body):
        self.requests.append((method, url, dict(headers), body))
        ep = urlparse(url).path.rsplit("/", 1)[1]
        if ep == "b2_authorize_account":
            ident = base64.b64decode(headers["Authorization"].split(" ", 1)[1]).decode()
            if ident != "%s:%s" % self.master or self.regenerated:
                return 401, {"code": "unauthorized", "status": 401, "message": "Invalid credentials"}
            return 200, {"accountId": "49fixture", "authorizationToken": SECRETS["b2_token"], "apiUrl": "https://api000.backblazeb2.com",
                         "allowed": {"capabilities": ["listKeys", "writeKeys", "deleteKeys", "listBuckets"], "bucketId": None, "bucketName": None, "namePrefix": None}}
        if headers.get("Authorization") != SECRETS["b2_token"]:
            return 401, {"code": "bad_auth_token", "status": 401, "message": "bad token"}
        if ep == "b2_list_buckets":
            return 200, {"buckets": [self.bucket]}
        if ep == "b2_list_keys":
            return 200, {"keys": [dict(k) for k in self.keys]}
        if ep == "b2_create_key":
            if self.fail_create:
                return 400, {"code": "bad_request", "status": 400, "message": self.fail_create}
            k = self.add_key(body["keyName"], body["capabilities"], bucket=bool(body.get("bucketId")))
            k["bucketId"] = body.get("bucketId")
            self.created.append(dict(body))
            secret = NEW_KEY_SECRET.get(body["keyName"], "K004TEMPKEYSECRETxxxxxxxxxxxxxxxxxxx")
            out = dict(k)
            out["applicationKey"] = secret
            return 200, out
        if ep == "b2_delete_key":
            self.deleted.append(body["applicationKeyId"])
            self.keys = [k for k in self.keys if k["applicationKeyId"] != body["applicationKeyId"]]
            return 200, {"applicationKeyId": body["applicationKeyId"]}
        return 404, {"code": "not_found", "status": 404, "message": "FAKE: unrouted " + ep}


class Net(object):
    """Routes one transport by host so a tool gets Cloudflare, the DoH endpoint, Backblaze and Porkbun from a single callable."""

    def __init__(self, **by_host):
        self.by_host, self.log = by_host, []

    def __call__(self, method, url, headers, body):
        self.log.append((method, url))
        host = urlparse(url).netloc
        for key, h in self.by_host.items():
            if key in host:
                return h(method, url, headers or {}, body)
        raise AssertionError("FAKE: no route for %s %s" % (method, url))


class ToolTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self._cwd = os.getcwd()
        os.chdir(self.tmp)
        self.addCleanup(self._cleanup)

        def deny(*a, **k):
            raise AssertionError("a tool reached the network instead of its injected transport")

        self._orig = (urllib.request.urlopen, socket.create_connection)
        urllib.request.urlopen, socket.create_connection = deny, deny

    def _cleanup(self):
        urllib.request.urlopen, socket.create_connection = self._orig
        os.chdir(self._cwd)
        self._tmp.cleanup()

    def tool(self, name, argv, transport, secrets=(), answers=None, runner=None, env_extra=None):
        """Run main() with injected everything. `secrets` feed getpass in order; `answers` maps a prompt substring to a typed reply
        (default 'yes'; a prompt containing 'done' gets 'done'). Returns (rc, stdout, stderr)."""
        mod = load(name)
        out, err = io.StringIO(), io.StringIO()
        self.gp_prompts, self.in_prompts = [], []
        vals = list(secrets)

        def fake_getpass(prompt=""):
            self.gp_prompts.append(prompt)
            if not vals:
                raise AssertionError("getpass asked more than the test supplied: %r" % prompt)
            return vals.pop(0)

        def fake_input(prompt=""):
            self.in_prompts.append(prompt)
            for k, v in (answers or {}).items():
                if k.lower() in prompt.lower():
                    return v(prompt) if callable(v) else v
            return "done" if "done" in prompt.lower() else "yes"

        env_before = dict(os.environ)
        rc = mod.main(list(argv), transport=transport, getpass=fake_getpass, input=fake_input, stdout=out, stderr=err,
                      runner=runner, env=dict({"HOME": str(self.tmp), "PATH": os.environ.get("PATH", "")}, **(env_extra or {})), home=str(self.tmp))
        self.assertEqual(dict(os.environ), env_before, "a tool changed the process environment")
        return rc, out.getvalue(), err.getvalue()

    def assertNoSecrets(self, text, secrets, where="output"):
        for s in secrets:
            self.assertNotIn(s, text, "%s leaks a fixture secret (%s...)" % (where, s[:8]))

    def assertNoSecretsOnDisk(self, secrets):
        for root, _, files in os.walk(str(self.tmp)):
            for f in files:
                data = (Path(root) / f).read_bytes().decode("utf8", "replace")
                self.assertNoSecrets(data, secrets, "file " + f)

    def lines(self, text):
        return [l for l in text.splitlines() if l.strip()]

    def line(self, text, *needles):
        for l in text.splitlines():
            if all(n.lower() in l.lower() for n in needles):
                return l
        self.fail("no output line contains %r\n---\n%s" % (needles, text))
