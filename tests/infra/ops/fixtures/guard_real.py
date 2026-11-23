"""Runs the installed compose guard on two real renders: guard_real.py <project> <raw.json> <plain.json> -> prints PASS or the refusal name."""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "infra" / "ops"))
from lib import compose_guard as g  # noqa: E402
from lib.release import Refusal  # noqa: E402

project, raw_path, plain_path = sys.argv[1:4]
rel = "/rel/sha256-x"
load = lambda p: json.loads(Path(p).read_text().replace("@@REL@@", rel))
images = {"app": "ghcr.io/richmosko/polycarpic@sha256:" + "d" * 64, "postgres": "ghcr.io/richmosko/polycarpic-postgres@sha256:" + "a" * 64,
          "tools": "ghcr.io/richmosko/polycarpic-tools@sha256:" + "b" * 64, "caddy": "ghcr.io/richmosko/polycarpic-caddy@sha256:" + "c" * 64}
policy = json.loads((REPO / "infra" / "deploy" / "compose-allow.json").read_text())
try:
    g.check(policy, project, load(raw_path), load(plain_path), images, rel)
    print("PASS")
except Refusal as e:
    print(getattr(e, "name", None) or e.args[0])
