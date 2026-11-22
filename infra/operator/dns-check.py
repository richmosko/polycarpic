#!/usr/bin/env python3
"""POLY-97 R9: check the live DNS zone against infra/operator/dns-allowed.json. Read-only, run on the laptop.

  dns-check.py [--ipv4 <address>] [--ipv6 <address>]

Lists every record through Cloudflare's API (all pages; fails closed when the listing is incomplete) with a read-only
token (Zone:DNS:Read) typed at a hidden prompt, then resolves both mail-alias targets through DNS-over-HTTPS and fails
on any A, AAAA or CAA answer there. Prints one line per fault and ends `DNS CHECK PASSED` (exit 0) or exits 1.
Stdlib only, Python 3.9 compatible. The token is never printed, logged or written.
"""
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

CF = "https://api.cloudflare.com/client/v4"
DOH = "https://cloudflare-dns.com/dns-query"
ALLOWED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dns-allowed.json")
DOH_CODES = {"A": 1, "AAAA": 28, "CAA": 257}


class CheckError(Exception):
    pass


def real_transport(method, url, headers, body):
    data = json.dumps(body).encode() if body is not None else None
    hdrs = {"User-Agent": "polycarpic-ops/1.0"}
    hdrs.update(headers or {})
    if data is not None:
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.loads(err.read().decode("utf8", "replace"))
        except ValueError:
            return err.code, {}


def cf_error(status, data):
    msgs = [str(e.get("message", "")) for e in (data.get("errors") or []) if isinstance(e, dict)]
    return "Cloudflare refused the request (HTTP %s): %s" % (status, "; ".join(m for m in msgs if m) or "no message")


def txt_join(content):
    """Join the 255-byte strings of a TXT value; exact bytes otherwise."""
    parts = re.findall(r'"((?:[^"\\]|\\.)*)"', content)
    return "".join(parts) if parts else content


def rel_name(fq, zone):
    fq = fq.lower().rstrip(".")
    return "@" if fq == zone else (fq[: -len(zone) - 1] if fq.endswith("." + zone) else fq)


def norm_target(value):
    return value.strip().strip('"').rstrip(".").lower()


def main(argv, *, transport=None, getpass=None, input=None, stdout=sys.stdout, stderr=sys.stderr, runner=None, env=None, home=None):
    import getpass as _gp
    getpass = getpass or _gp.getpass
    transport = transport or real_transport
    ipv4 = ipv6 = None
    args = list(argv)
    while args:
        a = args.pop(0)
        if a == "--ipv4" and args:
            ipv4 = args.pop(0)
        elif a == "--ipv6" and args:
            ipv6 = args.pop(0)
        else:
            stderr.write("usage: dns-check.py [--ipv4 <address>] [--ipv6 <address>]\n")
            return 2

    with open(ALLOWED_FILE, "r") as fh:
        allowed = json.load(fh)
    zone = allowed["zone"]
    addr_names = allowed.get("address_names", ["app", "staging"])
    table = {}
    for r in allowed["records"]:
        table.setdefault((r["name"], r["type"]), []).append(r)

    def out(line):
        stdout.write(line + "\n")

    token = getpass("Cloudflare read-only token (Zone:DNS:Read), hidden: ").strip()
    headers = {"Authorization": "Bearer " + token}
    try:
        status, data = transport("GET", "%s/zones?name=%s" % (CF, zone), headers, None)
        if status != 200 or not data.get("success") or not data.get("result"):
            raise CheckError(cf_error(status, data) if (status != 200 or not data.get("success")) else "this token cannot see the zone " + zone)
        zid = data["result"][0]["id"]
        records, page, total = [], 1, None
        while True:
            status, data = transport("GET", "%s/zones/%s/dns_records?page=%d&per_page=100" % (CF, zid, page), headers, None)
            if status != 200 or not data.get("success"):
                raise CheckError(cf_error(status, data))
            chunk = data.get("result") or []
            total = (data.get("result_info") or {}).get("total_count", total)
            records.extend(chunk)
            if not chunk or (total is not None and len(records) >= total):
                break
            page += 1
        if total is None or len(records) != total:
            raise CheckError("the listing is incomplete (fetched %d of %s records); not trusting it" % (len(records), total))
    except CheckError as err:
        out("FAIL cannot list the zone: %s" % err)
        return 1
    finally:
        del token, headers

    fails = 0

    def fail(name, typ, value, reason, fix=None):
        nonlocal fails
        fails += 1
        out("FAIL %s %s %s: %s%s" % (name, typ, value, reason, (" — fix: " + fix) if fix else ""))

    seen = {}
    for rec in records:
        name = rel_name(rec["name"], zone)
        typ = rec["type"]
        content = rec.get("content", "")
        value = txt_join(content) if typ == "TXT" else content
        seen.setdefault((name, typ), []).append((rec, value))

    for (name, typ), items in sorted(seen.items()):
        for rec, value in items:
            if "*" in name:
                fail(name, typ, value, "wildcard names are not allowed")
            if rec.get("proxied"):
                fail(name, typ, value, "proxied: true (nothing is proxied)")
        if typ == "NS" and name != "@":
            for rec, value in items:
                fail(name, typ, value, "an NS record below the apex is a delegation")
            continue
        if "*" in name:
            continue
        if name in addr_names and typ in ("A", "AAAA"):
            want = ipv4 if typ == "A" else ipv6
            if len(items) > 1:
                fail(name, typ, items[0][1], "two records for one name and type")
            for rec, value in items:
                if want is None:
                    fail(name, typ, value, "present, but --%s was not given" % ("ipv4" if typ == "A" else "ipv6"))
                elif value != want:
                    fail(name, typ, value, "expected %s (--%s)" % (want, "ipv4" if typ == "A" else "ipv6"))
            continue
        pins = table.get((name, typ))
        if not pins:
            for rec, value in items:
                reason = "a CNAME that is not one of the two pinned mail aliases" if typ == "CNAME" else "not in the allowed set"
                fail(name, typ, value, reason)
            continue
        matched, bad = set(), 0
        for rec, value in items:
            hit = None
            for i, pin in enumerate(pins):
                if typ == "CNAME":
                    ok = norm_target(value) == norm_target(pin["value"])
                elif typ == "MX":
                    ok = norm_target(value) == norm_target(pin["value"]) and rec.get("priority") == pin.get("priority", 0)
                elif typ == "TXT" and "sha256" in pin:
                    ok = hashlib.sha256(value.encode()).hexdigest() == pin["sha256"]
                elif typ == "CAA":
                    ok = " ".join(value.split()) == " ".join(pin["value"].split())
                else:
                    ok = value == pin["value"]
                if ok:
                    hit = i
                    break
            if name == "_dmarc" and "ruf=" in value:
                fail(name, typ, value, "ruf= is never allowed (forensic reports can carry sign-in links)")
                bad += 1
            elif hit is None:
                bad += 1
                if typ == "TXT" and "sha256" in pins[0]:
                    fail(name, typ, "p=…" + hashlib.sha256(value.encode()).hexdigest()[:12], "the value's hash differs from the pin",
                         "confirm a Resend key rotation, then re-pin in dns-allowed.json")
                else:
                    fail(name, typ, value, "differs from the pinned value" if len(pins) == 1 else "not one of the pinned values")
            elif hit in matched:
                fail(name, typ, value, "two records for one name and type")
            else:
                matched.add(hit)
        unmatched = [pin for i, pin in enumerate(pins) if i not in matched]
        for pin in unmatched[: max(0, len(unmatched) - bad)]:
            fail(name, typ, pin["value"], "a pinned record is missing")

    for (name, typ), pins in sorted(table.items()):
        if (name, typ) not in seen:
            for pin in pins:
                fail(name, typ, pin["value"], "a pinned record is missing")
    for name in addr_names:
        for typ in ("A", "AAAA"):
            if (name, typ) not in seen:
                out("INFO %s %s absent (allowed until the box has an address)" % (name, typ))

    # Target health: no A, AAAA or CAA answer at either mail-alias target (R-27, seceng).
    for pin in allowed["records"]:
        if pin["type"] != "CNAME":
            continue
        target = pin["value"]
        for typ in ("A", "AAAA", "CAA"):
            url = "%s?name=%s&type=%s" % (DOH, urllib.parse.quote(target), typ)
            try:
                status, data = transport("GET", url, {"accept": "application/dns-json"}, None)
            except Exception as err:  # a transport failure is a failed check, never a pass
                fail(target, typ, "", "target health could not be read (%s)" % err.__class__.__name__)
                continue
            if status != 200 or data.get("Status", 0) not in (0, 3):
                fail(target, typ, "", "target health could not be read (HTTP %s, DNS status %s)" % (status, data.get("Status")))
                continue
            for ans in data.get("Answer") or []:
                if ans.get("type") == DOH_CODES[typ]:
                    fail(target, typ, ans.get("data", ""), "the mail alias target now answers %s: its operator could serve HTTPS on our sibling name (R-27)" % typ,
                         "stop and ask seceng; do not re-pin")

    if fails:
        out("%d DNS CHECKS FAILED" % fails)
        return 1
    out("DNS CHECK PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
