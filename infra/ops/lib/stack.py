"""Running a release (POLY-100 R4, R6-R8): compose argv built from a release directory, health (R7), and the pointers a healthy run writes.

Every compose argv fixes the project, the file and the env files itself; a release directory appears only as the value of
`-f`, `--env-file` or `--project-directory` (S7). The host executes nothing from a release.
"""
import os
import re

from lib import compose, compose_guard, release as rel
from lib.release import Refusal

HEALTH_WAIT = 120
POLL = 5
FETCH = "fetch('http://127.0.0.1:3000/api/v1/health',{signal:AbortSignal.timeout(5000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))"
PREMIGRATION = re.compile(r"premigration-set [0-9]{8}T[0-9]{6}Z dump-[^ =]+\.age=[0-9a-f]{64} globals-[^ =]+\.age=[0-9a-f]{64}")
APP_SERVICES = ("migrate", "web", "auth", "worker")


def base(judged, project=None):
    """The fixed head of every compose call that starts or reads containers: the project and the SAVED, judged render (F4); never a bundle's file.
    The file's sha256 is re-read first (a changed file is the refusal `unjudged`)."""
    compose_guard.verify(judged, project)
    return ["docker", "compose", "-p", "polycarpic-" + judged.project, "-f", judged.path]


def refs(rdir):
    """The four image references of a release, from its images.env."""
    out = {}
    for line in (open(os.path.join(rdir, "images.env"), encoding="utf-8").read().splitlines()):
        k, _, v = line.partition("=")
        out[k] = v
    return out


def kinds(images_env):
    return {"app": images_env["POLY_APP_IMAGE"], "postgres": images_env["POLY_POSTGRES_IMAGE"], "tools": images_env["POLY_TOOLS_IMAGE"],
            "caddy": images_env["POLY_CADDY_IMAGE"]}


def oneoff_name(project, svc):
    return "polycarpic-%s-%s" % (project, svc)


def run_argv(judged, project, svc, command):
    """A one-off run. `compose run` has no --no-build (it has --pull and --build); --pull never keeps it from resolving a tag (T14). Named (F15)."""
    return base(judged, project) + ["--profile", "*", "run", "--rm", "--no-deps", "-T", "--pull", "never", "--name", oneoff_name(project, svc)] + [svc] + command


def up_argv(judged, project, services=(), extra=()):
    return base(judged, project) + ["up", "-d", "--pull", "never", "--no-build"] + list(extra) + list(services)


def healthy_once(ctx, project, want_refs, services, budget=30):
    """One read of the project. A child that times out, dies or prints garbage is a failed read: not healthy (F2).
    `budget` is a number or a function giving min(30 s, what is left of the window) at the moment each child starts (G7);
    with nothing left the read is "not healthy"."""
    def child():
        t = budget() if callable(budget) else budget
        if t <= 0:
            raise TimeoutError("the health window is spent")
        return t
    try:
        rows = compose.ps(ctx, "polycarpic-" + project, timeout=child())
        if rows is None:
            return False
        for svc in services:
            row = compose.running(rows, svc)
            if not row or row.get("Health") != "healthy":
                return False
            if svc in want_refs and compose.image_ref(compose.inspect(ctx, row.get("Name", ""), timeout=child())) != want_refs[svc]:
                return False
    except (TimeoutError, OSError, ValueError, KeyError, TypeError, AttributeError):
        return False
    return True


def wait_healthy(ctx, project, rdir, services, wait=HEALTH_WAIT, check_http=True, extra=None, judged=None):
    """R7: every long-running service running, healthy and on this release's image; then web answers 200 on its health route.
    `extra`, when given, is one more thing that must be true in the same poll (the probe through Caddy, A13)."""
    env = refs(rdir)
    want = {"postgres": env["POLY_POSTGRES_IMAGE"], "web": env["POLY_APP_IMAGE"], "auth": env["POLY_APP_IMAGE"], "worker": env["POLY_APP_IMAGE"],
            "caddy": env["POLY_CADDY_IMAGE"]}
    start = ctx.epoch()

    def child():  # each health child gets min(30 s, what is left of the window), worked out just before it starts (G7)
        return min(30, int(wait - (ctx.epoch() - start)))

    while True:
        if healthy_once(ctx, project, want, services, child):
            ok = True
            if check_http:
                try:
                    t = child()
                    if t <= 0:
                        raise TimeoutError("the health window is spent")
                    code, out, _ = ctx.run(base(judged, project) + ["exec", "-T", "web", "node", "-e", FETCH], timeout=t)
                    ok = code == 0 and out.strip() == "200"
                except (TimeoutError, OSError):
                    ok = False
            try:
                ok = ok and (extra is None or bool(extra()))
            except (TimeoutError, OSError):
                ok = False
            if ok:
                return True
        if ctx.epoch() - start >= wait:
            return False
        ctx.sleep(POLL)


def services_for(project, edge=False):
    svcs = ["postgres", "web", "auth", "worker"]
    return svcs + ["caddy"] if edge else svcs


def tree(rdir):
    """The tree hash of a release directory; an unhashable tree (a link or odd file) is the refusal `release-tree`, never "-" (F6)."""
    h = rel.tree_hash(rdir)
    if h is None:
        raise Refusal("release-tree")
    return h
