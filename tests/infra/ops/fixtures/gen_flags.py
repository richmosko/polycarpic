"""Regenerates tests/infra/ops/fixtures/flags.json: the options each docker, compose, gh and git subcommand the ops code runs really has, from the tool's own `--help` (F16, T14).
usage: gen_flags.py [--out FILE]   (needs docker with the compose plugin, gh and git on PATH; no daemon, no network)
The fakes refuse an option their subcommand lacks, as the real tool would, and the lint job compares this file with the tools' current help."""
import json
import re
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "flags.json"
TOOLS = {
    "docker": [["docker", "pull"], ["docker", "create"], ["docker", "cp"], ["docker", "rm"], ["docker", "inspect"], ["docker", "image", "inspect"]],
    "docker compose": [["docker", "compose"], ["docker", "compose", "config"], ["docker", "compose", "up"], ["docker", "compose", "run"], ["docker", "compose", "exec"],
                       ["docker", "compose", "ps"], ["docker", "compose", "restart"], ["docker", "compose", "stop"], ["docker", "compose", "rm"]],
    "gh": [["gh", "api"], ["gh", "run", "download"], ["gh", "attestation", "verify"]],
    "git": [["git", "fetch"], ["git", "cat-file"], ["git", "verify-tag"], ["git", "merge-base"], ["git", "init"], ["git", "rev-parse"], ["git", "tag"]],
}
OPT = re.compile(r"(?<![\w-])(--[A-Za-z0-9][A-Za-z0-9-]*|-[A-Za-z0-9])(?![\w-])")


def options(argv):
    help_argv = argv + (["-h"] if argv[0] == "git" else ["--help"])
    p = subprocess.run(help_argv, capture_output=True, text=True)
    found = set()
    for line in (p.stdout + p.stderr).splitlines():
        t = line.strip()
        m = re.match(r"^(-[A-Za-z0-9])?(?:\s*,\s*|\s+)?(--(?:\[no-\])?[A-Za-z0-9][\w-]*)?(?:[ =\[<]|$)", t)
        if not t.startswith("-") or not m or not (m.group(1) or m.group(2)):
            continue
        if m.group(1):
            found.add(m.group(1))
        if m.group(2):
            long = m.group(2)
            if long.startswith("--[no-]"):
                found.add("--" + long[7:])
                found.add("--no-" + long[7:])
            else:
                found.add(long)
    return sorted(found)


def main():
    out = {}
    for tool, subs in TOOLS.items():
        for argv in subs:
            out[" ".join(argv)] = options(argv)
    out["_versions"] = {t: subprocess.run(c, capture_output=True, text=True).stdout.strip().splitlines()[0] for t, c in (("docker", ["docker", "--version"]), ("compose", ["docker", "compose", "version"]),
                                                                                                                         ("gh", ["gh", "--version"]), ("git", ["git", "--version"]))}
    target = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else OUT
    target.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
    print("wrote", target, {k: len(v) for k, v in out.items() if k != "_versions"})


if __name__ == "__main__":
    main()
