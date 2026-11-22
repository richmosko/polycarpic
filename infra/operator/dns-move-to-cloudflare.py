#!/usr/bin/env python3
"""POLY-97 R8: move a domain's DNS hosting from Porkbun to Cloudflare (registrar unchanged).

Three parts; each asks for a typed `yes` before it changes anything, and each can be skipped.
Every secret is typed at a hidden prompt and is never saved or printed.

  1. Cloudflare: show the zone's status, assigned name servers and records.
  2. Cloudflare: delete the leftover records imported from the old host.
  3. Porkbun: replace the domain's name servers with Cloudflare's, then read them back.

Prerequisites (done by hand, once):
  - The domain is added as a site in Cloudflare (Free plan).
  - A Cloudflare API token limited to this one zone with Zone:Read + DNS:Edit.
  - A Porkbun API key and secret key, and "API Access" switched on for the domain.
Stdlib only, Python 3.9 compatible.
"""
import json
import sys
import urllib.error
import urllib.request

DOMAIN = "polycarpic.com"
CF = "https://api.cloudflare.com/client/v4"
PB = "https://api.porkbun.com/api/json/v3"


def real_transport(method, url, headers, body):
    data = json.dumps(body).encode() if body is not None else None
    hdrs = {"User-Agent": "polycarpic-ops/1.0", "Content-Type": "application/json"}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.loads(err.read().decode("utf8", "replace"))
        except ValueError:
            return err.code, {}


class Stop(Exception):
    pass


def main(argv, *, transport=None, getpass=None, input=None, stdout=sys.stdout, stderr=sys.stderr, runner=None, env=None, home=None):
    import builtins
    import getpass as _gp
    getpass = getpass or _gp.getpass
    input = input or builtins.input
    transport = transport or real_transport

    def out(line=""):
        stdout.write(line + "\n")

    def cf(method, path, token, body=None):
        status, data = transport(method, CF + path, {"Authorization": "Bearer " + token}, body)
        if status != 200 or not data.get("success"):
            msgs = [str(e.get("message", "")) for e in (data.get("errors") or []) if isinstance(e, dict)]
            raise Stop("Cloudflare refused the request (HTTP %s): %s" % (status, "; ".join(m for m in msgs if m) or "no message"))
        return data["result"]

    def pb(path, body):
        status, data = transport("POST", PB + path, {}, body)
        if status != 200 or data.get("status") != "SUCCESS":
            raise Stop("Porkbun refused the request (HTTP %s): %s" % (status, data.get("message", "no message")))
        return data

    def show(records):
        if not records:
            out("  (no records)")
        for r in records:
            out("  %-6s %-28s -> %s%s" % (r["type"], r["name"], r["content"], " [proxied]" if r.get("proxied") else ""))

    try:
        out("=== Part 1: Cloudflare zone for %s ===" % DOMAIN)
        token = getpass("Cloudflare API token (hidden): ").strip()
        zones = cf("GET", "/zones?name=" + DOMAIN, token)
        if not zones:
            raise Stop("this token cannot see a zone named %s. Add the site in Cloudflare first, and scope the token to it." % DOMAIN)
        zone = zones[0]
        servers = zone.get("name_servers") or []
        out("zone status:          %s" % zone.get("status"))
        out("assigned name servers: %s" % ", ".join(servers))
        records = cf("GET", "/zones/%s/dns_records?per_page=100" % zone["id"], token)
        out("records in the zone now:")
        show(records)

        if records:
            out()
            out("=== Part 2: delete leftover records ===")
            out("Nothing on this domain is in use, so every record above is a leftover.")
            if input("Delete ALL of the records listed? Type yes to delete: ").strip() == "yes":
                for r in records:
                    cf("DELETE", "/zones/%s/dns_records/%s" % (zone["id"], r["id"]), token)
                    out("  deleted %s %s" % (r["type"], r["name"]))
                out("records remaining:")
                show(cf("GET", "/zones/%s/dns_records?per_page=100" % zone["id"], token))
            else:
                out("  kept; nothing deleted.")
        del token

        out()
        out("=== Part 3: point %s at Cloudflare's name servers (Porkbun) ===" % DOMAIN)
        if len(servers) < 2:
            raise Stop("Cloudflare did not report two name servers; stopping.")
        if input("Continue to the Porkbun step? Type yes to continue: ").strip() != "yes":
            out("  skipped. Name servers unchanged.")
            return 0
        creds = {"apikey": getpass("Porkbun API key (hidden): ").strip(),
                 "secretapikey": getpass("Porkbun secret key (hidden): ").strip()}
        now = pb("/domain/getNs/" + DOMAIN, creds)
        out("current name servers: %s" % ", ".join(now.get("ns", [])))
        out("new name servers:     %s" % ", ".join(servers))
        if input("Replace them? Type yes to replace: ").strip() != "yes":
            out("  kept. Name servers unchanged.")
            return 0
        body = dict(creds)
        body["ns"] = servers
        pb("/domain/updateNs/" + DOMAIN, body)
        after = pb("/domain/getNs/" + DOMAIN, creds)
        out("name servers at Porkbun now: %s" % ", ".join(after.get("ns", [])))
        ok = sorted(after.get("ns", [])) == sorted(servers)
        out("RESULT: %s" % ("name servers match Cloudflare's" if ok else "MISMATCH, check Porkbun"))
        out("Cloudflare shows the zone as active within minutes to a day.")
        return 0 if ok else 1
    except Stop as err:
        stderr.write("error: %s\n" % err)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
