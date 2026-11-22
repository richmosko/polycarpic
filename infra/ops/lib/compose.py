"""Compose as the single source (R4): the secrets block of each compose file, and `docker compose ps` / `docker inspect` readers."""
import json
import re

SECRET_LINE = re.compile(r"^  ([a-z0-9_]+)__([a-z0-9-]+): \{file: (/\S+)\}$")
SECRET_ROOT = {"prod": "/etc/polycarpic/secrets/", "staging": "/etc/polycarpic/staging-secrets/"}
FILES = {"prod": ("prod.yml", "edge.yml"), "staging": ("staging.yml",)}
GIDS = {"postgres": 999, "web": 10001, "worker": 10002, "migrate": 10003, "backup": 10004, "uploader": 10005,
        "operator": 10006, "auth": 10007, "caddy": 10010}
LONG_RUNNING = ("postgres", "web", "auth", "worker", "caddy")


class ComposeError(Exception):
    pass


def parse_secrets(ctx, project):
    """-> sorted list of (service, name, logical file path) for every compose-mounted secret under the project's root."""
    found = []
    for fname in FILES[project]:
        rel = "infra/compose/" + fname
        try:
            with open(ctx.bundle(rel), encoding="utf-8") as fh:
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
            m = SECRET_LINE.match(line)
            if not m:
                raise ComposeError("compose secrets block unreadable: %s:%d" % (rel, n))
            name, service, path = m.groups()
            if path.startswith(SECRET_ROOT[project]) and path.rsplit("/", 1)[-1] == name:
                found.append((service, name, path))
    return sorted(found)


def ps(ctx, compose_project, timeout=10):
    """Containers of a compose project: a list of dicts (Service, Name, State, Health). None when compose fails."""
    code, out, _ = ctx.run(["docker", "compose", "-p", compose_project, "ps", "-a", "--format", "json"], timeout=timeout)
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
