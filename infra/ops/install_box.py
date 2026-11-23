#!/usr/bin/python3 -I
"""Box side of the polycarpic-ops install (POLY-98 R2, A1). Run as root: install_box.py <id>, tar on stdin.

Extracts the bundle itself with tarfile's data filter (members that are absolute, hold .. or are links are refused before
anything is written), sets modes and owners, renames the tree to /opt/polycarpic/ops/<id> and swaps `current` atomically.
"""
import os
import re
import shutil
import stat
import sys
import tarfile
import tempfile

ID = re.compile(r"(git-[0-9a-f]{12}|sha256-[0-9a-f]{12})")
EXECUTABLES = {"infra/ops/polycarpic-ops", "infra/ops/install_box.py", "infra/provision.sh", "infra/provision-check.sh",
               "infra/postgres/gate-check.sh"}
# scripts the containers run from the bundle (mounted read-only; their uids are not root): executable, but a bundle need not carry them
RUNNABLE = {"infra/backup/backup.sh", "infra/backup/upload.sh", "infra/postgres/archive-wal.sh"}
LINK = "/usr/local/sbin/polycarpic-ops"


class InstallError(Exception):
    pass


def _filter(member, dest):
    if member.issym() or member.islnk():
        raise InstallError("refused tar member %s: links are not allowed" % member.name)
    if member.name.startswith("/") or ".." in member.name.split("/"):
        raise InstallError("refused tar member %s: absolute or parent path" % member.name)
    if not (member.isfile() or member.isdir()):
        raise InstallError("refused tar member %s: not a file or directory" % member.name)
    return tarfile.data_filter(member, dest)


def _replace_link(target, path):
    tmp = path + ".new"
    try:
        os.unlink(tmp)
    except FileNotFoundError:
        pass
    os.symlink(target, tmp)
    os.replace(tmp, path)


def install(stream, bundle_id, root="/", out=sys.stdout):
    if not ID.fullmatch(bundle_id):
        raise InstallError("bad id")
    opt = os.path.join(root, "opt/polycarpic")
    ops = os.path.join(opt, "ops")
    current = os.path.join(ops, "current")
    os.umask(0o022)
    for d in (opt, ops):
        os.makedirs(d, mode=0o755, exist_ok=True)
        os.chmod(d, 0o755)
    previous = os.path.basename(os.readlink(current)) if os.path.islink(current) else None
    if previous == bundle_id and os.path.isdir(os.path.join(ops, bundle_id)):
        while stream.read(1 << 16):
            pass
        out.write("polycarpic-ops %s already installed\n" % bundle_id)
        return 0
    staging = tempfile.mkdtemp(prefix=".ops-incoming.", dir=opt)
    try:
        with tarfile.open(fileobj=stream, mode="r|") as tar:
            tar.extractall(staging, filter=_filter)
        for base, dirs, files in os.walk(staging):
            os.chmod(base, 0o755)
            os.lchown(base, 0, 0)
            for n in files:
                p = os.path.join(base, n)
                rel = os.path.relpath(p, staging)
                os.chmod(p, 0o755 if rel in EXECUTABLES or rel in RUNNABLE else 0o644)
                os.lchown(p, 0, 0)
        for need in EXECUTABLES:
            if not os.path.isfile(os.path.join(staging, need)):
                raise InstallError("bundle is missing " + need)
        final = os.path.join(ops, bundle_id)
        if os.path.exists(final):
            shutil.rmtree(final)
        os.rename(staging, final)
        staging = None
        _replace_link(bundle_id, current)
        sbin = os.path.join(root, LINK.lstrip("/"))
        os.makedirs(os.path.dirname(sbin), exist_ok=True)
        _replace_link("/opt/polycarpic/ops/current/infra/ops/polycarpic-ops", sbin)
        keep = {bundle_id, previous, "current"}
        for n in os.listdir(ops):
            if n not in keep and (n.startswith("git-") or n.startswith("sha256-")):
                shutil.rmtree(os.path.join(ops, n), ignore_errors=True)
    finally:
        if staging:
            shutil.rmtree(staging, ignore_errors=True)
    out.write("installed polycarpic-ops %s at /opt/polycarpic/ops/current (previous: %s)\n" % (bundle_id, previous or "none"))
    return 0


def main(argv):
    if len(argv) != 1:
        sys.stderr.write("usage: install_box.py <id>  (tar on stdin)\n")
        return 2
    if os.geteuid() != 0:
        sys.stderr.write("install_box.py: run as root\n")
        return 4
    try:
        return install(sys.stdin.buffer, argv[0])
    except (InstallError, tarfile.TarError, OSError) as err:
        sys.stderr.write("install_box.py: %s\n" % err)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
