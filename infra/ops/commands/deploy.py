"""deploy <prod|staging>: the pull-based deploy (POLY-100); the work is in lib/deployer.py."""
from lib import deployer

HELP = "deploy prod|staging (pull the latest verified release)"


def add_arguments(parser):
    parser.add_argument("project", choices=["prod", "staging"])


def run(args, ctx):
    return deployer.locked(args.project, ctx, first=False)
