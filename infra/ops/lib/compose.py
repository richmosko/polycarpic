"""Compose as the single source (R4): the secrets block of each compose file, and `docker compose ps` / `docker inspect` readers."""
import json
import os
import re

SECRET_LINE = re.compile(r"  ([a-z0-9_]+)__([a-z0-9-]+): \{file: (/\S+)\}")
SECRET_ROOT = {"prod": "/etc/polycarpic/secrets/", "staging": "/etc/polycarpic/staging-secrets/"}
FILES = {"prod": ("prod.yml", "edge.yml"), "staging": ("staging.yml",)}
GIDS = {"postgres": 999, "web": 10001, "worker": 10002, "migrate": 10003, "backup": 10004, "uploader": 10005,
        "operator": 10006, "auth": 10007, "caddy": 10010}
LONG_RUNNING = ("postgres", "web", "auth", "worker", "caddy")


class ComposeError(Exception):
    pass


def opts(ctx, project_dir=None):
    """G11: the two options every compose call names, so neither the caller's directory nor a `.env` anywhere decides anything: `--project-directory`
    (the render home, root 0755 and empty, or a bundle file's own directory) and an explicit `--env-file /dev/null` where no file is ruled."""
    from lib import dirs
    # read-only: the render home is checked, never created or repaired here (only the commands that deploy do that); before the first deploy it does not
    # exist yet, and `/` stands in, with the explicit empty env file that keeps any `.env` out of it
    return ["--project-directory", project_dir or dirs.peek(ctx, dirs.RENDER_HOME) or "/", "--env-file", "/dev/null"]


def file_opts(ctx, cfile):
    """The options for a call that names `-f cfile`: the render home for a saved render, the file's own directory for a bundle's file."""
    if "/state/deploy/" in cfile and os.path.basename(cfile).startswith("render-"):
        return opts(ctx)
    return opts(ctx, os.path.dirname(cfile))


def release_current(ctx, project):
    """R-b: the compose directory of the project's current release (`releases/<project>-current`, a root symlink), else None."""
    link = ctx.p("/opt/polycarpic/releases/%s-current" % project)
    return link if os.path.islink(link) else None


def compose_source(ctx, project, fname, bundle_path):
    """-> (file path, extra compose args). With a `current` the file is that release's saved, judged render (F4, S33), never a bundle's compose file:
    a render that is missing or unreadable is `ComposeError("state")`. With no `current` at all, the ops bundle's file."""
    from lib import compose_guard, release
    try:
        cur = release.load_pointer(ctx, project, "current")
    except release.Refusal:
        raise ComposeError("state")
    if not cur:
        return bundle_path, []
    path = ctx.p("%s/%s/render-%s.json" % (compose_guard.STATE, project, cur["digest"].split(":", 1)[1][:12]))
    if not compose_guard.pair_ok(path):  # G5: the file and the hash beside it, compared before use
        raise ComposeError("state")
    return path, []


def parse_secrets(ctx, project):
    """-> sorted list of (service, name, logical file path) for every compose-mounted secret under the project's root."""
    found = []
    for fname in FILES[project]:
        rel = "infra/compose/" + fname
        try:
            link = release_current(ctx, project)
            with open(("%s/%s" % (link, rel)) if link else ctx.bundle(rel), encoding="utf-8") as fh:
                lines = fh.read().split("\n")
        except OSError:
            raise ComposeError("compose file unreadable: " + rel)
        inside = False
        for n, line in enumerate(lines, 1):
            if line == "secrets:":
                inside = True
                continue
            if not inside or line.strip() == "":
                continue
            if not line.startswith(" "):
                inside = False
                continue
            m = SECRET_LINE.fullmatch(line)
            if not m:
                raise ComposeError("compose secrets block unreadable: %s:%d" % (rel, n))
            name, service, path = m.groups()
            if path.startswith(SECRET_ROOT[project]) and path.rsplit("/", 1)[-1] == name:
                found.append((service, name, path))
    return sorted(found)


def ps(ctx, compose_project, timeout=10):
    """Containers of a compose project: a list of dicts (Service, Name, State, Health). None when compose fails."""
    try:
        argv = ["docker", "compose", "-p", compose_project] + opts(ctx) + ["ps", "-a", "--format", "json"]
    except Exception:  # a render home that is not as ruled (S37): no answer is a failed `ps`
        return None
    code, out, _ = ctx.run(argv, timeout=timeout)
    if code != 0:
        return None
    rows = []
    for raw in out.split("\n"):
        raw = raw.strip()
        if not raw:
            continue
        try:
            row = json.loads(raw)
        except ValueError:
            return None
        rows.extend(row if isinstance(row, list) else [row])
    return [r for r in rows if isinstance(r, dict)]


def running(rows, service):
    """The container row of a running service, else None."""
    for r in rows or []:
        if r.get("Service") == service and r.get("State") == "running":
            return r
    return None


def inspect(ctx, name, timeout=10):
    """`docker inspect <name>`: the first object (Config.Image, Created, Image, State.StartedAt), or None."""
    code, out, _ = ctx.run(["docker", "inspect", name], timeout=timeout)
    if code != 0:
        return None
    try:
        data = json.loads(out)
    except ValueError:
        return None
    return data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else None


def image_ref(info):
    return ((info or {}).get("Config") or {}).get("Image") or ""
