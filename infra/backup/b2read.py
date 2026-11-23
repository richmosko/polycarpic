#!/usr/bin/env python3
"""b2read.py: what restore.sh and drill.sh read from the bucket, and what they check in an archive (POLY-99 R7, R8). Stdlib only.

Runs on the laptop with the READ key. It picks a VERSION (fileId), never a name, and names its local files by fileId (C5).

  list    --credential F --bucket B --instance I [--prefix P]     one record per version: `<fileId> <action> <uploadMs> <iso> <key>`
  get     --credential F --bucket B --file-id ID --out PATH         one object by fileId
  choose  --now EPOCH [--before EPOCH] [--set TS]  (records on stdin)    the newest complete nightly set, or the reasons it is refused
  check-time --kind base|dump --file F --ts TS --before SECONDS    the time INSIDE the archive (pg_dump header, or backup_label START TIME) must
                         lie in [TS - 60 s, TS + SECONDS]; prints `<epoch> <START WAL file or ->` or exits 4 (a replayed old file)
  epoch ISO              a YYYY-MM-DDTHH:MM:SSZ time as epoch seconds
  s3probe --credential READKEY --box-credential BOXKEY --bucket B     DR10: with the BOX key, try to delete, overwrite and change retention; prints
                         `refused <verb>` or `ALLOWED <verb>` per verb. The probe writes <instance>/drill/probe-<TS> (never a backup object).

Exit: 0 done; 2 usage or a refused POLY_B2_AUTH_URL; 3 selection refused; 4 integrity; 5 the bucket refused, or a key or URL failed validation.
Credential files are two lines (key id, application key) and are read here only: no key reaches an argv or an environment.
"""
import base64
import calendar
import datetime
import hashlib
import hmac
import json
import os
import re
import struct
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_AUTH = "https://api.backblazeb2.com"
LOOPBACK = re.compile(r"http://127\.0\.0\.1:[0-9]{1,5}")
API_URL = re.compile(r"https://[a-z0-9-]+\.backblazeb2\.com")
FILE_ID = re.compile(r"[A-Za-z0-9_-]+")
TS = re.compile(r"[0-9]{8}T[0-9]{6}Z")
NAME = {
    "dump": re.compile(r"(base|dump|globals)-([0-9]{2})-([0-9]{1,20})-([0-9]{8}T[0-9]{6}Z)\.age"),
    "premigration": re.compile(r"(dump|globals)-([0-9]{2})-([0-9]{1,20})-([0-9]{8}T[0-9]{6}Z)\.age"),
    "wal": re.compile(r"wal-([0-9]{2})-([0-9]{1,20})-([0-9A-F]{24}(?:\.[0-9A-F]{8}\.backup|\.partial)?|[0-9A-F]{8}\.history)\.age"),
}
LATE = 4 * 3600


def die(code, text):
    sys.stderr.write("b2read: %s\n" % text)
    sys.exit(code)


def ts_epoch(ts):
    return calendar.timegm((int(ts[0:4]), int(ts[4:6]), int(ts[6:8]), int(ts[9:11]), int(ts[11:13]), int(ts[13:15]), 0, 0, 0))


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000.0, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_credential(path):
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().split("\n")
    if len(lines) < 2 or not lines[0] or not lines[1]:
        die(2, "credential file must hold the key id and the application key on two lines")
    return lines[0], lines[1]


def auth_url():
    url = os.environ.get("POLY_B2_AUTH_URL")
    if url is None:
        return DEFAULT_AUTH, False
    if url != DEFAULT_AUTH and not LOOPBACK.fullmatch(url):
        die(2, "POLY_B2_AUTH_URL must be http://127.0.0.1:<port> or %s" % DEFAULT_AUTH)
    if url != DEFAULT_AUTH:
        sys.stderr.write("WARN B2 auth URL overridden: %s\n" % url)
    return url, url != DEFAULT_AUTH


def http(url, headers=None, limit=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        return urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as err:
        die(5, "B2 answered %d for %s" % (err.code, urllib.parse.urlsplit(url).path.rsplit("/", 1)[-1]))
    except (urllib.error.URLError, OSError) as err:
        die(5, "B2 not reachable (%s)" % err.__class__.__name__)


class Session:
    def __init__(self, credential, bucket):
        key_id, key = read_credential(credential)
        base, override = auth_url()
        basic = base64.b64encode(("%s:%s" % (key_id, key)).encode()).decode()
        with http(base + "/b2api/v3/b2_authorize_account", {"Authorization": "Basic " + basic}) as resp:
            doc = json.loads(resp.read())
        api = doc["apiInfo"]["storageApi"]
        for field in ("apiUrl", "downloadUrl"):
            value = api.get(field, "")
            if not (API_URL.fullmatch(value) or (override and LOOPBACK.fullmatch(value))):
                die(5, "%s from b2_authorize_account is not a backblazeb2.com URL" % field)
        self.api, self.download, self.token = api["apiUrl"], api["downloadUrl"], doc["authorizationToken"]
        self.s3 = api.get("s3ApiUrl")
        buckets = (api.get("allowed") or {}).get("buckets") or []
        match = [b for b in buckets if b.get("name") == bucket]
        if not match:
            die(5, "the read key is not restricted to bucket %s" % bucket)
        self.bucket_id = match[0]["id"]

    def versions(self, prefix):
        out, start = [], {}
        while True:
            q = dict(bucketId=self.bucket_id, prefix=prefix, maxFileCount="1000", **start)
            with http("%s/b2api/v3/b2_list_file_versions?%s" % (self.api, urllib.parse.urlencode(q)), {"Authorization": self.token}) as resp:
                doc = json.loads(resp.read())
            out.extend(doc.get("files", []))
            if not doc.get("nextFileName"):
                return out
            start = dict(startFileName=doc["nextFileName"], startFileId=doc["nextFileId"])


def valid_key(instance, key):
    """<instance>/<M>/<dir>/<R2 name>[.sha256], else None. -> (major, dir, name, is_sibling)"""
    parts = key.split("/")
    if len(parts) != 4 or parts[0] != instance or not re.fullmatch(r"[0-9]{2}", parts[1]) or parts[2] not in NAME:
        return None
    name, sibling = parts[3], False
    if name.endswith(".sha256"):
        name, sibling = name[:-7], True
    m = NAME[parts[2]].fullmatch(name)
    if not m:
        return None
    major = m.group(1) if parts[2] == "wal" else m.group(2)
    return (parts[1], parts[2], name, sibling) if major == parts[1] else None


def cmd_list(args):
    s = Session(args["--credential"], args["--bucket"])
    instance = args["--instance"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,62}", instance):
        die(2, "bad --instance")
    for f in s.versions(args.get("--prefix", instance + "/")):
        if f.get("action") not in ("upload", "hide") or f.get("fileName", "").startswith(instance + "/drill/"):
            continue  # the drill's own probe objects are not backups
        if not FILE_ID.fullmatch(f.get("fileId", "")) or valid_key(instance, f.get("fileName", "")) is None:
            die(5, "refused object key in the bucket listing")
        print("%s %s %d %s %s" % (f["fileId"], f["action"], f["uploadTimestamp"], iso(f["uploadTimestamp"]), f["fileName"]))


def cmd_get(args):
    fid = args["--file-id"]
    if not FILE_ID.fullmatch(fid):
        die(2, "bad --file-id")
    s = Session(args["--credential"], args["--bucket"])
    url = "%s/b2api/v3/b2_download_file_by_id?%s" % (s.download, urllib.parse.urlencode({"fileId": fid}))
    fd = os.open(args["--out"], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as out, http(url, {"Authorization": s.token}) as resp:
        while True:
            block = resp.read(1 << 20)
            if not block:
                break
            out.write(block)


def read_records(stream):
    recs = []
    for line in stream.read().split("\n"):
        if not line:
            continue
        fid, action, ms, _iso, key = line.split(" ", 4)
        recs.append((fid, action, int(ms), key))
    return recs


def cmd_choose(args):
    now = int(args["--now"])
    before = int(args["--before"]) if "--before" in args else None
    want = args.get("--set")
    recs = read_records(sys.stdin)
    if before is not None:
        recs = [r for r in recs if r[2] <= before * 1000]
        sys.stderr.write("WARN restoring as of --before: later versions are ignored\n")
    sets = {}
    for fid, action, ms, key in recs:
        inst, major, d, rest = key.split("/")
        if d != "dump":
            continue
        name = rest[:-7] if rest.endswith(".sha256") else rest
        m = NAME["dump"].fullmatch(name)
        sets.setdefault((m.group(2), m.group(3), m.group(4)), {}).setdefault(m.group(1), []).append((fid, action, ms, key))
    complete = {k: v for k, v in sets.items() if set(v) == {"base", "dump", "globals"}}
    if want:
        complete = {k: v for k, v in complete.items() if k[2] == want}
    if not complete:
        print("refused: no complete nightly set (base, dump and globals) in the bucket")
        sys.exit(3)
    newest = lambda item: max(r[2] for vs in item[1].values() for r in vs)
    (major, sysid, ts), objs = max(complete.items(), key=newest)
    refusals = []
    tsec = ts_epoch(ts)
    if tsec > now:
        refusals.append("set %s is dated in the future" % ts)
    late = False
    for kind, vs in objs.items():
        for fid, action, ms, key in vs:
            if ms < tsec * 1000:
                refusals.append("%s was uploaded before its TS %s" % (key, ts))
            elif ms > (tsec + LATE) * 1000:
                late = True
    if late and not want:
        refusals.append("set %s was uploaded more than 4 h after its TS (name it with --set %s to accept it)" % (ts, ts))
    if not want:
        day = ts[:8]
        same = sorted(k[2] for k in complete if k[2][:8] == day)
        if len(same) > 1:
            refusals.append("two complete nightly sets on %s: %s" % (day, " ".join(same)))
    if refusals:
        for line in refusals:
            print("refused: " + line)
        for kind in ("base", "dump", "globals"):
            for fid, action, ms, key in sorted(objs[kind], key=lambda r: r[2]):
                print("version %s %s %s%s" % (fid, iso(ms), key, " hide marker" if action == "hide" else ""))
        sys.exit(3)
    if late:
        sys.stderr.write("WARN late upload\n")
    print("set %s %s %s" % (ts, sysid, major))
    for kind in ("base", "dump", "globals"):
        for fid, action, ms, key in sorted(objs[kind], key=lambda r: r[2]):
            print("ver %s %s %s %s %d %s" % (key.rsplit("/", 1)[1], key, fid, action, ms, iso(ms)))


def read_int(f, size):
    sign = f.read(1)[0]
    value = int.from_bytes(f.read(size), "little")
    return -value if sign else value


def dump_time(path):
    with open(path, "rb") as f:
        if f.read(5) != b"PGDMP":
            die(4, "not a pg_dump custom archive")
        vmaj, vmin = f.read(1)[0], f.read(1)[0]
        if vmaj > 1 or (vmaj == 1 and vmin > 0):
            f.read(1)  # revision
        int_size = f.read(1)[0]
        if (vmaj, vmin) >= (1, 7):
            f.read(1)  # offset size
        f.read(1)  # format
        if (vmaj, vmin) >= (1, 15):
            f.read(1)  # compression algorithm
        else:
            read_int(f, int_size)
        sec, mi, hour, mday, mon, year, _ = (read_int(f, int_size) for _ in range(7))
    return calendar.timegm((year + 1900, mon + 1, mday, hour, mi, sec, 0, 0, 0))


def base_time(path):
    start, wal = None, ""
    with tarfile.open(path, mode="r|gz") as tar:
        for member in tar:
            if member.name.lstrip("./") == "backup_label":
                text = tar.extractfile(member).read(8192).decode("utf-8", "replace")
                m = re.search(r"^START TIME: (\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)", text, re.M)
                w = re.search(r"\(file ([0-9A-F]{24})\)", text)
                if m:
                    start = calendar.timegm(tuple(int(x) for x in m.groups()) + (0, 0, 0))
                wal = w.group(1) if w else ""
                break
    if start is None:
        die(4, "backup_label not found in the base archive")
    return start, wal


def cmd_check_time(args):
    ts = args["--ts"]
    if not TS.fullmatch(ts):
        die(2, "bad --ts")
    try:
        if args["--kind"] == "base":
            when, wal = base_time(args["--file"])
        else:
            when, wal = dump_time(args["--file"]), ""
    except (OSError, tarfile.TarError, struct.error, IndexError, ValueError) as err:
        die(4, "cannot read the archive time (%s)" % err.__class__.__name__)
    lo, hi = ts_epoch(ts) - 60, ts_epoch(ts) + int(args["--before"])
    if not lo <= when <= hi:
        die(4, "archive time %s is outside the window of its name's TS %s (a replayed file?)" % (iso(when * 1000), ts))
    print("%d %s" % (when, wal or "-"))


def cmd_epoch(args):
    m = re.fullmatch(r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z", args["FILE"])
    if not m:
        die(2, "bad time")
    print(calendar.timegm(tuple(int(x) for x in m.groups()) + (0, 0, 0)))


def sigv4(method, url, body, headers, key_id, key):
    u = urllib.parse.urlsplit(url)
    host = u.netloc
    m = re.fullmatch(r"s3\.([a-z0-9-]+)\.backblazeb2\.com", host)
    region = m.group(1) if m else "us-east-1"
    now = datetime.datetime.now(datetime.timezone.utc)
    amz, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    payload = hashlib.sha256(body).hexdigest()
    hdrs = {k.lower(): v for k, v in headers.items()}
    hdrs.update({"host": host, "x-amz-date": amz, "x-amz-content-sha256": payload})
    names = sorted(hdrs)
    query = "&".join("%s=%s" % (urllib.parse.quote(k, safe=""), urllib.parse.quote(v, safe="")) for k, v in sorted(urllib.parse.parse_qsl(u.query, keep_blank_values=True)))
    canonical = "\n".join([method, urllib.parse.quote(u.path, safe="/"), query, "".join("%s:%s\n" % (k, hdrs[k].strip()) for k in names), ";".join(names), payload])
    scope = "%s/%s/s3/aws4_request" % (day, region)
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    k = ("AWS4" + key).encode()
    for part in (day, region, "s3", "aws4_request"):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    hdrs["authorization"] = "AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s" % (key_id, scope, ";".join(names), sig)
    return hdrs


def s3_status(method, url, body, headers, key_id, key):
    req = urllib.request.Request(url, data=body if method == "PUT" else None, method=method, headers=sigv4(method, url, body, headers, key_id, key))
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status
    except urllib.error.HTTPError as err:
        return err.code
    except (urllib.error.URLError, OSError):
        die(5, "the bucket's S3 endpoint is not reachable")


def cmd_s3probe(args):
    s = Session(args["--credential"], args["--bucket"])
    _, override = auth_url()
    endpoint = s.s3 or ""
    if not (re.fullmatch(r"https://s3\.[a-z0-9-]+\.backblazeb2\.com", endpoint) or (override and LOOPBACK.fullmatch(endpoint))):
        die(5, "b2_authorize_account returned no usable s3ApiUrl")
    key_id, key = read_credential(args["--box-credential"])
    instance = args.get("--instance", "polycarpic-prod")
    name = "%s/drill/probe-%s" % (instance, datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    obj = "%s/%s/%s" % (endpoint, args["--bucket"], name)
    body = b"drill probe\n"
    md5 = lambda b: {"Content-MD5": base64.b64encode(hashlib.md5(b).digest()).decode()}
    status = s3_status("PUT", obj, body, md5(body), key_id, key)
    if not 200 <= status < 300:
        print("ALLOWED setup (the box key could not write the probe object: HTTP %d)" % status)
        return
    first = [f for f in s.versions(name) if f.get("fileName") == name and f.get("action") == "upload"]
    if not first:
        print("ALLOWED setup (the probe object is not listed)")
        return
    original = sorted(first, key=lambda f: f["uploadTimestamp"])[0]["fileId"]

    def digest(fid):
        with http("%s/b2api/v3/b2_download_file_by_id?%s" % (s.download, urllib.parse.urlencode({"fileId": fid})), {"Authorization": s.token}) as resp:
            return hashlib.sha256(resp.read()).hexdigest()

    refused = [
        ("delete", "DELETE", obj, b"", {}),
        ("retention", "PUT", obj + "?retention", b"<Retention><Mode>GOVERNANCE</Mode><RetainUntilDate>2000-01-01T00:00:00Z</RetainUntilDate></Retention>", {}),
        ("object-lock", "PUT", "%s/%s?object-lock" % (endpoint, args["--bucket"]), b"<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>", {}),
    ]
    for label, method, url, payload, hdrs in refused:
        code = s3_status(method, url, payload, hdrs, key_id, key)
        print(("ALLOWED %s (HTTP %d)" if 200 <= code < 300 else "refused %s (HTTP %d)") % (label, code))
    # a plain PUT adds a version; it must leave the first version as it was (Object Lock holds it)
    other = b"drill probe, second write\n"
    s3_status("PUT", obj, other, md5(other), key_id, key)
    try:
        intact = digest(original) == hashlib.sha256(body).hexdigest()
    except SystemExit:
        intact = False
    print("refused overwrite (the first version is intact)" if intact else "ALLOWED overwrite (the first version changed or is gone)")


def parse(argv):
    if not argv:
        die(2, "usage: b2read.py list|get|choose|check-time|epoch ...")
    cmd, rest, args = argv[0], argv[1:], {}
    i = 0
    while i < len(rest):
        if rest[i].startswith("--"):
            if i + 1 >= len(rest):
                die(2, "%s needs a value" % rest[i])
            args[rest[i]] = rest[i + 1]
            i += 2
        else:
            args["FILE"] = rest[i]
            i += 1
    return cmd, args


def main(argv):
    sys.dont_write_bytecode = True
    cmd, args = parse(argv)
    table = {"list": cmd_list, "get": cmd_get, "choose": cmd_choose, "check-time": cmd_check_time, "epoch": cmd_epoch, "s3probe": cmd_s3probe}
    if cmd not in table:
        die(2, "unknown command %s" % cmd)
    table[cmd](args)


if __name__ == "__main__":
    main(sys.argv[1:])
