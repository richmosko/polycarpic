"""The token's expiry (POLY-100 R10): one `gh api -i rate_limit` call per run, through the same token handling as every gh call."""
import datetime
import os
import re

from lib import release as rel

EXPIRY = re.compile(r"(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{4})")


def refresh(ctx, tok, work):
    """Rewrite state/deploy/token-expiry from the `github-authentication-token-expiration` header, or delete it. Never stops the run."""
    path = ctx.p(rel.STATE + "/token-expiry")
    stamp = None
    try:
        code, out, _ = rel.gh(ctx, tok, work, ["api", "-i", "rate_limit"], timeout=60)
        if code == 0:
            head = out.replace("\r\n", "\n").split("\n\n", 1)[0]  # the header block ends at the first blank line
            for line in head.split("\n"):
                name, _, value = line.partition(":")
                if name.strip().lower() != "github-authentication-token-expiration":
                    continue
                m = EXPIRY.fullmatch(value.strip())
                if not m:
                    continue
                when = datetime.datetime.strptime(m.group(1) + " " + m.group(2), "%Y-%m-%d %H:%M:%S")
                zone = m.group(3)
                if zone != "UTC":
                    off = datetime.timedelta(hours=int(zone[1:3]), minutes=int(zone[3:5]))
                    when = when - off if zone[0] == "+" else when + off
                stamp = when.strftime("%Y-%m-%dT%H:%M:%SZ")
    except (rel.Transient, ValueError):
        stamp = None
    if stamp:
        rel.write(ctx, path, stamp + "\n")
        return
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
