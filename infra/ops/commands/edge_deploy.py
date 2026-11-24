"""edge-deploy <edge-n>: bring Caddy up from a signed edge release before any prod release exists (POLY-100 R9). Foreground, no timer.

Only Caddy of the release is started, in the compose project polycarpic-edge. Refuses once prod has a `current` or any prod container exists.
"""
from lib import edge

HELP = "edge-deploy edge-<n> (Caddy alone from a signed edge release, before prod)"


def add_arguments(parser):
    parser.add_argument("tag")


def run(args, ctx):
    return edge.deploy(args.tag, ctx)
