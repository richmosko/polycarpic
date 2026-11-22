#!/usr/bin/env python3
"""POLY-97 R8/R9: write the allowed DNS set (infra/operator/dns-allowed.json) into the Cloudflare zone.

  dns-records.py [--ipv4 <address>] [--ipv6 <address>]

Writes the mail and lock-down records, and the A and AAAA records of `app` and `staging` (TTL 300, never proxied)
when an address is given. Idempotent: a record that already exists is left alone. It only ever creates records of
the allowed set, never deletes or overwrites, and refuses to write when a record in the way holds another value.
The token (zone-scoped DNS edit, deleted after use) is typed at a hidden prompt and is never printed or saved.
Stdlib only, Python 3.9 compatible.
"""
import ipaddress
import json
import os
import re
import sys
import urllib.error
import urllib.request

CF = "https://api.cloudflare.com/client/v4"
ALLOWED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dns-allowed.json")


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


class ApiError(Exception):
    pass


def api(transport, method, url, headers, body=None):
    status, data = transport(method, url, headers, body)
    if status != 200 or not data.get("success"):
        msgs = [str(e.get("message", "")) for e in (data.get("errors") or []) if isinstance(e, dict)]
        raise ApiError("Cloudflare refused the request (HTTP %s): %s" % (status, "; ".join(m for m in msgs if m) or "no message"))
    return data


def txt_join(content):
    parts = re.findall(r'"((?:[^"\\]|\\.)*)"', content)
    return "".join(parts) if parts else content


def caa_parts(value):
    """`0 issue "letsencrypt.org"` -> (0, "issue", "letsencrypt.org")."""
    m = re.match(r'^\s*(\d+)\s+(\w+)\s+"(.*)"\s*$', value)
    if not m:
        raise ValueError("not a CAA value: " + value)
    return int(m.group(1)), m.group(2), m.group(3)


def existing_value(rec):
    """The zone's value for a record: CAA from `data` when the reply has it, else its `content`."""
    d = rec.get("data")
    if rec.get("type") == "CAA" and isinstance(d, dict) and d.get("tag"):
        return '%s %s "%s"' % (d.get("flags", 0), d["tag"], d.get("value", ""))
    return rec.get("content", "")


def norm(typ, value):
    if typ == "TXT":
        return txt_join(value)
    if typ == "CAA":
        return " ".join(value.split())
    return value.strip().strip('"').rstrip(".").lower()


def main(argv, *, transport=None, getpass=None, input=None, stdout=sys.stdout, stderr=sys.stderr, runner=None, env=None, home=None):
    import getpass as _gp
    getpass = getpass or _gp.getpass
    import builtins
    input = input or builtins.input
    transport = transport or real_transport
    ipv4 = ipv6 = None
    args = list(argv)
    while args:
        a = args.pop(0)
        try:
            if a == "--ipv4" and args:
                ipv4 = str(ipaddress.IPv4Address(args.pop(0)))
            elif a == "--ipv6" and args:
                ipv6 = str(ipaddress.IPv6Address(args.pop(0)))
            else:
                raise ValueError(a)
        except ValueError:
            stderr.write("usage: dns-records.py [--ipv4 <address>] [--ipv6 <address>]\n")
            return 2

    with open(ALLOWED_FILE, "r") as fh:
        allowed = json.load(fh)
    zone = allowed["zone"]

    def out(line):
        stdout.write(line + "\n")

    def fq(name):
        return zone if name == "@" else name + "." + zone

    def rel(name):
        name = name.lower().rstrip(".")
        return "@" if name == zone else (name[: -len(zone) - 1] if name.endswith("." + zone) else name)

    # desired: (name, type, value, priority, ttl)
    desired = []
    for r in allowed["records"]:
        desired.append((r["name"], r["type"], r["value"], r.get("priority"), 3600))
    for name in allowed.get("address_names", ["app", "staging"]):
        if ipv4:
            desired.append((name, "A", ipv4, None, 300))
        if ipv6:
            desired.append((name, "AAAA", ipv6, None, 300))

    token = getpass("Cloudflare token (zone-scoped DNS edit), hidden: ").strip()
    headers = {"Authorization": "Bearer " + token}
    try:
        zones = api(transport, "GET", "%s/zones?name=%s" % (CF, zone), headers)
        if not zones.get("result"):
            raise ApiError("this token cannot see the zone " + zone)
        zid = zones["result"][0]["id"]
        base = "%s/zones/%s/dns_records" % (CF, zid)

        def list_all():
            records, page = [], 1
            while True:
                data = api(transport, "GET", "%s?page=%d&per_page=100" % (base, page), headers)
                chunk = data.get("result") or []
                records.extend(chunk)
                total = (data.get("result_info") or {}).get("total_count")
                if not chunk or (total is not None and len(records) >= total):
                    break
                page += 1
            return records

        existing = list_all()
        to_create, conflicts = [], []
        for name, typ, value, prio, ttl in desired:
            same = [e for e in existing if rel(e["name"]) == name.lower() and e["type"] == typ]
            if any(norm(typ, existing_value(e)) == norm(typ, value) for e in same):
                out("exists   %s %s %s" % (name, typ, value))
            elif same and typ != "CAA":
                conflicts.append((name, typ, value, [norm(typ, existing_value(e)) for e in same]))
            else:
                to_create.append((name, typ, value, prio, ttl))
        for name, typ, value, held in conflicts:
            out("CONFLICT %s %s wants %s but the zone holds %s; this tool never overwrites or deletes: resolve it by hand" % (name, typ, value, ", ".join(held)))
        if conflicts:
            return 1
        if not to_create:
            out("nothing to create")
            return 0

        out("Records to create (zone %s):" % zone)
        for name, typ, value, prio, ttl in to_create:
            out("  %-6s %-24s %s%s" % (typ, name, value if len(value) <= 70 else value[:67] + "...", "" if prio is None else "  (priority %s)" % prio))
        if input("Create these records? Type yes to create: ").strip() != "yes":
            out("Nothing changed.")
            return 0
        for name, typ, value, prio, ttl in to_create:
            body = {"type": typ, "name": fq(name), "ttl": ttl}
            if typ == "CAA":
                flags, tag, val = caa_parts(value)
                body["data"] = {"flags": flags, "tag": tag, "value": val}
            else:
                body["content"] = '"%s"' % value if typ == "TXT" else value
            if typ in ("A", "AAAA", "CNAME"):
                body["proxied"] = False
            if prio is not None:
                body["priority"] = prio
            api(transport, "POST", base, headers, body)
            out("created  %s %s" % (name, typ))

        after = list_all()
        missing = [(n, t) for n, t, v, p, ttl in desired
                   if not any(rel(e["name"]) == n.lower() and e["type"] == t and norm(t, existing_value(e)) == norm(t, v) for e in after)]
        for n, t in missing:
            out("MISSING after write: %s %s" % (n, t))
        out("RESULT: %s" % ("all records in place" if not missing else "%d record(s) missing" % len(missing)))
        return 1 if missing else 0
    except ApiError as err:
        stderr.write("error: %s\n" % err)
        return 1
    finally:
        del token, headers


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
