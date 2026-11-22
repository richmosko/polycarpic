"""Compose as the single source (R4): the secrets block of each compose file, and `docker compose ps` readers."""
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
            with open(ctx.path(ctx.bundle_path(rel)), encoding="utf-8") as fh:
                lines = fh.read().split("\n")
        except OSError:
            raise ComposeError("compose file unreadable: " + rel)
        inside = False
        for n, line in enumerate(lines, 1):
            if line == "secrets:":
                inside = True
                continue
            if not inside:
                continue
            if line.strip() == "":
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


def project_name(project):
    return "polycarpic-" + project


def ps(ctx, compose_project, timeout=10):
    """Containers of a compose project: a list of dicts (Service, State, Health, ID, ...). None when compose fails."""
    code, out, _ = ctx.call(["docker", "compose", "-p", compose_project, "ps", "-a", "--format", "json"], timeout=timeout)
    if code != 0:
        return None
    text = out.decode("utf-8", "replace").strip()
    if not text:
        return []
    try:
        if text.startswith("["):
            rows = json.loads(text)
        else:
            rows = [json.loads(line) for line in text.split("\n") if line.strip()]
    except ValueError:
        return None
    return [r for r in rows if isinstance(r, dict)]


def inspect_image(ctx, container_id, timeout=10):
    code, out, _ = ctx.call(["docker", "inspect", "--format", "{{.Config.Image}}", container_id], timeout=timeout)
    return out.decode("utf-8", "replace").strip() if code == 0 else None
