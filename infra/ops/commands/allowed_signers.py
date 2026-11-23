"""allowed-signers install: the SSH keys that may sign a release tag (POLY-100 R11, S9).

Reads the file on stdin from the laptop. Every line must be exactly `<principal> namespaces="git" ssh-ed25519 <base64>`; any other
option (cert-authority above all, valid-before, a second namespace) or key type exits 2 with nothing written. The file is never fetched.
"""
import base64
import binascii
import hashlib
import os
import re

HELP = "allowed-signers install (reads the signers file on stdin; prints each fingerprint)"
DEST = "/etc/polycarpic/allowed_signers"
LINE = re.compile(r'([A-Za-z0-9][A-Za-z0-9_.@+-]{0,63}) namespaces="git" ssh-ed25519 ([A-Za-z0-9+/]{1,500}={0,2})')
MAX = 64 * 1024


def add_arguments(parser):
    parser.add_argument("action", choices=["install"])


def _fingerprint(b64):
    try:
        blob = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        return None
    if not blob.startswith(b"\x00\x00\x00\x0bssh-ed25519") or len(blob) != 51:
        return None
    return "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")


def run(args, ctx):
    text = ctx.stdin.read(MAX + 1)
    if len(text) > MAX:
        ctx.err("allowed-signers: input is larger than 64 KiB; nothing written")
        return 2
    lines = [l for l in text.split("\n") if l != ""]
    prints = []
    for n, line in enumerate(lines, 1):
        m = LINE.fullmatch(line)
        fp = _fingerprint(m.group(2)) if m else None
        if not fp:
            ctx.err("allowed-signers: line %d is not `<principal> namespaces=\"git\" ssh-ed25519 <key>`; nothing written" % n)
            return 2
        prints.append((m.group(1), fp))
    if not prints:
        ctx.err("allowed-signers: no key given; nothing written")
        return 2
    dest = ctx.p(DEST)
    if os.path.exists(dest) and ctx.confirm("%s exists; type yes to replace:" % DEST) != "yes":
        ctx.err("not replaced")
        return 1
    tmp = dest + ".new"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    ctx.chown(tmp, 0, 0)
    os.chmod(tmp, 0o644)
    os.replace(tmp, dest)
    for who, fp in prints:
        ctx.out("%s %s" % (who, fp))
    ctx.out("allowed-signers: %d key(s) installed at %s" % (len(prints), DEST))
    return 0
