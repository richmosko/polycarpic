"""Module discovery by file-name pattern (R1): no registry, any other file in a directory is ignored."""
import importlib.util
import os
import re

COMMAND = re.compile(r"[a-z][a-z0-9_]*\.py")
STATUS = re.compile(r"[0-9]{2}_[a-z][a-z0-9_]*\.py")


def modules(ops_dir, sub):
    """name -> path for each file of <ops_dir>/<sub> whose name matches the pattern."""
    folder = os.path.join(ops_dir, sub)
    pattern = STATUS if sub == "status" else COMMAND
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        return {}
    return {n[:-3]: os.path.join(folder, n) for n in names if pattern.fullmatch(n)}


def load(path, label):
    spec = importlib.util.spec_from_file_location(label, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
