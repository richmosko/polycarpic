#!/usr/bin/env python3
"""POLY-99 R11 fake box: what `ssh <host> sudo polycarpic-ops backup list-premigration|fetch-premigration <name>` answers, from a directory.

This stands in for the box side ONLY in restore.sh's tests (restore.sh is the unit under test there). The real runner is tested in
tests/infra/ops/test_backup.py and, end to end, by the criterion 5 round trip.
BOX_DIR holds premigration/<files> and spool.sha256 (`<sha256> premigration/<name>` lines). BOX_LIST, when set, is printed verbatim by list.
"""
import hashlib, os, re, sys

box = os.environ["BOX_DIR"]
args = sys.argv[1:]
if args[:2] != ["backup", "list-premigration"] and args[:2] != ["backup", "fetch-premigration"]:
    sys.stderr.write("polycarpic-ops: unknown subcommand: %s\n" % " ".join(args))
    sys.exit(2)
record = {}
rp = os.path.join(box, "spool.sha256")
if os.path.exists(rp):
    for line in open(rp).read().splitlines():
        h, p = line.split(" ", 1)
        record[p] = h
if args[1] == "list-premigration":
    if os.environ.get("BOX_LIST") is not None:
        sys.stdout.write(os.environ["BOX_LIST"])
        sys.exit(0)
    names = sorted(os.listdir(os.path.join(box, "premigration")))
    sets = {}
    for n in names:
        m = re.fullmatch(r"(dump|globals)-(\d\d)-(\d+)-(\d{8}T\d{6}Z)\.age", n)
        if m:
            sets.setdefault(m.group(4), {})[m.group(1)] = n
    for ts in sorted(sets):
        s = sets[ts]
        if "dump" in s and "globals" in s:
            up = "uploaded" if all(os.path.exists(os.path.join(box, "premigration", s[k] + ".sha256")) for k in s) else "pending"
            print("%s %s %s %s %s %s" % (ts, s["dump"], record.get("premigration/" + s["dump"], "0" * 64), s["globals"], record.get("premigration/" + s["globals"], "0" * 64), up))
    sys.exit(0)
name = args[2]
p = os.path.join(box, "premigration", name)
sys.stdout.flush()
sys.stdout.buffer.write(open(p, "rb").read())
