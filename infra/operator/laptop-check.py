#!/usr/bin/env python3
"""POLY-97 R8: the laptop holds no Hetzner API token.

Fails if `hcloud context list` shows any context, if HCLOUD_TOKEN is set, or if hcloud's config file holds a token.
Runs at the deploy gate and in the monthly window, beside dns-check.py. Stdlib only, Python 3.9 compatible.
Never prints a token.
"""
import os
import re
import subprocess
import sys

TOKEN_LINE = re.compile(r"^\s*token\s*=\s*([\"'])(.+?)\1", re.M)


def real_runner(argv, env=None, stdin=None):
    try:
        done = subprocess.run(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
    except FileNotFoundError:
        return 127, ""
    return done.returncode, done.stdout


def config_paths(env, home):
    if env.get("HCLOUD_CONFIG"):
        return [env["HCLOUD_CONFIG"]]
    return [os.path.join(home, ".config", "hcloud", "cli.toml"),
            os.path.join(home, "Library", "Application Support", "hcloud", "cli.toml")]


def main(argv, *, transport=None, getpass=None, input=None, stdout=sys.stdout, stderr=sys.stderr, runner=None, env=None, home=None):
    env = os.environ if env is None else env
    home = home or env.get("HOME") or os.path.expanduser("~")
    runner = runner or real_runner
    failed = 0

    def out(text):
        stdout.write(text + "\n")

    code, listing = runner(["hcloud", "context", "list"], env=dict(env))
    if code == 127:
        out("PASS hcloud is not installed, so it holds no context")
    elif code != 0:
        out("FAIL `hcloud context list` failed (exit %d): cannot tell whether a context exists — fix: run it by hand and delete every context" % code)
        failed += 1
    else:
        names = []
        for line in listing.splitlines()[1:]:
            parts = line.split()
            if parts:
                names.append(parts[-1])
        if names:
            for name in names:
                out("FAIL hcloud context %s exists — fix: hcloud context delete %s, then delete the token in the Hetzner console" % (name, name))
            failed += len(names)
        else:
            out("PASS hcloud holds no context")

    if "HCLOUD_TOKEN" in env:
        out("FAIL HCLOUD_TOKEN is set in the environment — fix: unset HCLOUD_TOKEN and remove it from your shell profile")
        failed += 1
    else:
        out("PASS HCLOUD_TOKEN is not set")

    for path in config_paths(env, home):
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r") as fh:
                text = fh.read()
        except OSError as err:
            out("FAIL %s cannot be read (%s) — fix: check the file by hand" % (path, err.strerror))
            failed += 1
            continue
        if TOKEN_LINE.search(text):
            out("FAIL %s holds an API token — fix: hcloud context delete <name>, or delete the file, then delete the token in the Hetzner console" % path)
            failed += 1
        else:
            out("PASS %s holds no token" % path)

    if failed:
        out("%d LAPTOP CHECKS FAILED" % failed)
        return 1
    out("LAPTOP CHECK PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
