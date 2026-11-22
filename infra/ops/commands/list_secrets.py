"""list-secrets: which service mounts which secret, and whether the file is there with the right mode (R5). Stat only."""
import os
import stat

from lib import compose

HELP = "table of every compose-mounted secret file: state, mode, owner, size (--staging for staging)"
ROW = "%-9s %-25s %-8s %-4s %-13s %5s"


def add_arguments(parser):
    parser.add_argument("--staging", action="store_true")


def run(args, ctx):
    project = "staging" if args.staging else "prod"
    rows = []
    n_set = n_missing = n_wrong = 0
    for svc, name, path in compose.parse_secrets(ctx, project):
        real = ctx.p(path)
        try:
            st = os.lstat(real)
        except OSError:
            rows.append((ROW % (svc, name, "missing", "", "", "")).rstrip())
            n_missing += 1
            continue
        try:
            gid = os.stat(os.path.dirname(real)).st_gid
        except OSError:
            gid = compose.GIDS.get(svc)
        owner = ("root" if st.st_uid == ctx.trusted_uid else str(st.st_uid)) + ":" + str(st.st_gid)
        ok = stat.S_ISREG(st.st_mode) and stat.S_IMODE(st.st_mode) == 0o440 and st.st_uid == ctx.trusted_uid and st.st_gid == gid
        n_set += ok
        n_wrong += not ok
        rows.append(ROW % (svc, name, "set" if ok else "WRONG", "%04o" % stat.S_IMODE(st.st_mode), owner, st.st_size))
    ctx.out(ROW % ("SERVICE", "NAME", "STATE", "MODE", "OWNER", "BYTES"))
    for r in rows:
        ctx.out(r)
    last = "%d files: %d set, %d missing" % (len(rows), n_set, n_missing)
    if n_wrong:
        last += "; %d wrong: run provision-check" % n_wrong
    ctx.out(last)
    return 1 if n_wrong else 0
