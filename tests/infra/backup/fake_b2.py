#!/usr/bin/env python3
"""POLY-99 R11 fake-b2: one process, two listeners, one store. Stdlib only. Never talks to the real Backblaze.

 * S3 half (TLS, :443, the uploader reaches it as https://s3.eu-fake-001.backblazeb2.com through a network alias): a single-part PUT
   is checked against Content-MD5 (400 BadDigest) and answered with ETag "<md5 hex>"; each PUT stores a NEW VERSION (fileId).
   Every other S3 verb (HEAD, GET, DELETE, POST, list) is 403 AccessDenied, the way a writeFiles-only key is answered.
 * Native half (plain HTTP, :8080) for restore.sh and drill.sh through POLY_B2_AUTH_URL: b2_authorize_account (the READ key only),
   b2_list_file_versions, b2_download_file_by_id. Shapes follow the B2 native API v3.
 * Control (same plain listener, /_fake/...): mode, plant, log, reset.
   mode: pass | etag (PUT response ETag is 32 zeros) | refuse (PUT 403) | 5xx (PUT 500) | permissive (DELETE and PUT-over succeed) | slow (PUT waits
   `delay` ms first, then passes).
"""
import base64, hashlib, json, ssl, sys, threading, time, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

READ_KEY_ID = "0049fixturereadkeyid00000001"
READ_KEY = "K004FIXTUREREADAPPKEY0000000000000"
BUCKET_ID = "bucketid-fixture-0001"
BUCKET = "poly-test-bucket"
TOKEN = "authtoken-read-fixture"

LOCK = threading.Lock()
STATE = {"mode": "pass", "delay": 0, "n": 0, "apiUrl": None}
STORE = {}  # name -> list of version dicts, oldest first
LOG = []


def new_version(name, data, action="upload", uploaded=None):
    STATE["n"] += 1
    v = {"fileId": "4_zfake_%06d" % STATE["n"], "fileName": name, "action": action, "data": data,
         "uploadTimestamp": uploaded if uploaded is not None else int(time.time() * 1000)}
    STORE.setdefault(name, []).append(v)
    return v


def log(method, who, path):
    with LOCK:
        LOG.append("%s %s %s" % (method, who, path))


class Base(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send(self, code, body=b"", ctype="application/xml", headers=None):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            out = b""
            while True:
                size = int(self.rfile.readline().strip().split(b";")[0], 16)
                if size == 0:
                    self.rfile.readline()
                    break
                out += self.rfile.read(size)
                self.rfile.readline()
            return out
        return self.rfile.read(n) if n else b""


class S3(Base):
    def who(self):
        m = re.search(r"Credential=([^/]+)/", self.headers.get("Authorization", ""))
        return m.group(1) if m else "-"

    def deny(self):
        self.send(403, "<Error><Code>AccessDenied</Code><Message>not allowed for this key</Message></Error>")

    def do_PUT(self):
        data = self.body()
        u = urlparse(self.path)
        qs = parse_qs(u.query, keep_blank_values=True)
        special = "retention" in qs or "object-lock" in qs
        log("PUT", self.who(), u.path + ("?" + u.query if special else ""))  # rclone adds ?x-id=PutObject to every PUT; only the DR10 verbs show their query
        mode = STATE["mode"]
        if "retention" in qs or "object-lock" in qs:  # PutObjectRetention / PutObjectLockConfiguration: a writeFiles key may do neither
            return self.send(200) if mode == "permissive" else self.deny()
        if mode == "refuse":
            return self.deny()
        if mode == "5xx":
            return self.send(500, "<Error><Code>InternalError</Code></Error>")
        if mode == "slow":
            time.sleep(STATE["delay"] / 1000.0)
        md5 = hashlib.md5(data).digest()
        want = self.headers.get("Content-MD5")
        if want is None or base64.b64decode(want) != md5:
            return self.send(400, "<Error><Code>BadDigest</Code><Message>Content-MD5 mismatch</Message></Error>")
        parts = urlparse(self.path).path.lstrip("/").split("/", 1)
        name = unquote(parts[1]) if len(parts) == 2 else ""
        with LOCK:
            if STORE.get(name) and mode == "permissive":
                STORE[name][0]["data"] = data  # permissive: the first version is OVERWRITTEN in place (same fileId), what an unlocked bucket allows
            else:
                new_version(name, data)  # B2 keeps every upload as a new version
        etag = "0" * 32 if mode == "etag" else md5.hex()
        self.send(200, b"", headers={"ETag": '"%s"' % etag})

    def do_DELETE(self):
        log("DELETE", self.who(), urlparse(self.path).path)
        if STATE["mode"] == "permissive":
            parts = urlparse(self.path).path.lstrip("/").split("/", 1)
            with LOCK:
                STORE.pop(unquote(parts[1]) if len(parts) == 2 else "", None)
            return self.send(204)
        self.deny()

    def do_GET(self):
        log("GET", self.who(), urlparse(self.path).path)
        self.deny()

    def do_HEAD(self):
        log("HEAD", self.who(), urlparse(self.path).path)
        self.deny()

    def do_POST(self):
        self.body()
        log("POST", self.who(), urlparse(self.path).path)
        self.deny()


def public(v):
    return {"fileId": v["fileId"], "fileName": v["fileName"], "action": v["action"], "uploadTimestamp": v["uploadTimestamp"],
            "contentLength": len(v["data"]), "contentSha1": hashlib.sha1(v["data"]).hexdigest()}


class Native(Base):
    def json(self, code, obj):
        self.send(code, json.dumps(obj), "application/json")

    def authed(self):
        return self.headers.get("Authorization") == TOKEN

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path.startswith("/_fake/"):
            return self.control(u.path[7:], q, b"")
        if u.path.endswith("/b2_authorize_account"):
            log("GET", "native", u.path)
            auth = self.headers.get("Authorization", "")
            want = "Basic " + base64.b64encode(("%s:%s" % (READ_KEY_ID, READ_KEY)).encode()).decode()
            if auth != want:
                return self.json(401, {"code": "unauthorized", "message": "bad key"})
            host = self.headers.get("Host")
            return self.json(200, {"accountId": "acct-fixture", "authorizationToken": TOKEN, "apiInfo": {"storageApi": {
                "apiUrl": STATE["apiUrl"] or "http://%s" % host, "downloadUrl": STATE["apiUrl"] or "http://%s" % host,
                "allowed": {"buckets": [{"id": BUCKET_ID, "name": BUCKET}], "capabilities": ["listFiles", "readFiles"], "namePrefix": None}}}})
        if not self.authed():
            log("GET", "-", u.path)
            return self.json(401, {"code": "unauthorized", "message": "no token"})
        log("GET", "read", u.path + ("?" + u.query if u.query else ""))
        if u.path.endswith("/b2_list_file_versions"):
            if q.get("bucketId") != BUCKET_ID:
                return self.json(400, {"code": "bad_request", "message": "bucketId"})
            prefix = q.get("prefix", "")
            with LOCK:
                files = [public(v) for name in sorted(STORE) if name.startswith(prefix) for v in sorted(STORE[name], key=lambda x: -x["uploadTimestamp"])]
            return self.json(200, {"files": files, "nextFileName": None, "nextFileId": None})
        if u.path.endswith("/b2_download_file_by_id"):
            with LOCK:
                found = [v for vs in STORE.values() for v in vs if v["fileId"] == q.get("fileId")]
            if not found or found[0]["action"] == "hide":
                return self.json(404, {"code": "not_found", "message": "no such fileId"})
            return self.send(200, found[0]["data"], "application/octet-stream")
        self.json(404, {"code": "not_found", "message": u.path})

    def do_POST(self):
        u = urlparse(self.path)
        data = self.body()
        if u.path.startswith("/_fake/"):
            return self.control(u.path[7:], {k: v[0] for k, v in parse_qs(u.query).items()}, data)
        self.json(404, {"code": "not_found", "message": u.path})

    def control(self, what, q, data):
        if what == "mode":
            STATE["mode"] = q["v"]
            STATE["delay"] = int(q.get("delay", "0"))
            return self.json(200, {"mode": STATE["mode"]})
        if what == "plant":  # POST body = bytes; name, uploaded (ms), action
            with LOCK:
                v = new_version(q["name"], data, q.get("action", "upload"), int(q["uploaded"]) if "uploaded" in q else None)
            return self.json(200, public(v))
        if what == "api":  # C8: make b2_authorize_account answer an apiUrl/downloadUrl of the test's choosing
            STATE["apiUrl"] = q["url"] or None
            return self.json(200, {})
        if what == "log":
            with LOCK:
                return self.json(200, list(LOG))
        if what == "store":
            with LOCK:
                return self.json(200, {n: [dict(public(v), sha256=hashlib.sha256(v["data"]).hexdigest()) for v in vs] for n, vs in STORE.items()})
        if what == "object":  # raw bytes of one version by fileId, for the tests
            with LOCK:
                found = [v for vs in STORE.values() for v in vs if v["fileId"] == q["fileId"]]
            return self.send(200, found[0]["data"] if found else b"", "application/octet-stream")
        if what == "reset":
            with LOCK:
                STORE.clear(); LOG.clear(); STATE.update(mode="pass", delay=0, apiUrl=None)
            return self.json(200, {})
        self.json(404, {"code": "not_found", "message": what})


def main():
    cert, key = sys.argv[1], sys.argv[2]
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    s3 = ThreadingHTTPServer(("0.0.0.0", 443), S3)
    s3.socket = ctx.wrap_socket(s3.socket, server_side=True)
    native = ThreadingHTTPServer(("0.0.0.0", 8080), Native)
    threading.Thread(target=s3.serve_forever, daemon=True).start()
    native.serve_forever()


if __name__ == "__main__":
    main()
