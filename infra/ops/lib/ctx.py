"""The context object (R1): everything the outside world supplies, so tests can inject fakes and a temp root.

The root and the fakes come from the constructor only, never from argv, the environment or a file.
Seams: run(argv, stdin, timeout, env) -> (code, stdout text, stderr text), raising TimeoutError; run_inherit(argv, env) -> code;
getpass(prompt); isatty(); confirm(prompt); now() -> aware UTC datetime; sleep(seconds); chown(fd_or_path, uid, gid); geteuid();
tls_probe(host, port) -> {"ok": True, "not_after": datetime} | {"ok": False, "reason": str} (raises OSError when nothing answers);
statvfs(path) with the host path.
"""
import datetime
import getpass as _getpass
import os
import socket
import ssl
import subprocess
import sys
import time
import warnings

FIXED_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
BUNDLE = "/opt/polycarpic/ops/current"


def fixed_env(extra=None):
    """The environment a child gets: built from nothing, plus only the variables a call names."""
    env = {"PATH": FIXED_PATH, "LC_ALL": "C.UTF-8", "HOME": "/root"}
    env.update(extra or {})
    return env


def _real_run(argv, stdin=None, timeout=None, env=None):
    try:
        p = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=timeout, env=env, shell=False, check=False)
    except subprocess.TimeoutExpired:
        raise TimeoutError(argv[0])
    except OSError as err:
        return 127, "", "%s: %s\n" % (argv[0], err.strerror or err.__class__.__name__)
    return p.returncode, p.stdout, p.stderr


def _real_run_inherit(argv, env=None, timeout=None):
    try:
        return subprocess.run(argv, env=env, shell=False, check=False, timeout=timeout).returncode
    except OSError as err:
        sys.stderr.write("%s: %s\n" % (argv[0], err.strerror or err.__class__.__name__))
        return 127
    except subprocess.TimeoutExpired:
        raise TimeoutError(argv[0])


def _real_getpass(prompt=""):
    # getpass falls back to an echoed read when it cannot switch echo off; refuse that outright (K5).
    # Our own read (getpass.getpass restores with the same flag): echo off with TCSAFLUSH, so anything typed before the prompt, already
    # echoed by the tty, is dropped and never becomes the secret (B1); the restore drains.
    try:
        import termios
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
    except Exception:
        warnings.warn("cannot control echo", _getpass.GetPassWarning)
        return ""
    new = list(old)
    new[3] &= ~termios.ECHO
    try:
        termios.tcsetattr(fd, termios.TCSAFLUSH, new)
        sys.stderr.write(prompt)
        sys.stderr.flush()
        line = sys.stdin.readline()
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        sys.stderr.write("\n")
    return line.rstrip("\n")


def _real_chown(target, uid, gid):
    if isinstance(target, int):
        os.fchown(target, uid, gid)
    else:
        os.chown(target, uid, gid)


def _real_tls_probe(host, port):
    context = ssl.create_default_context()
    try:
        with socket.create_connection((host, port), timeout=10) as raw:
            with context.wrap_socket(raw, server_hostname=host) as tls:
                not_after = ssl.cert_time_to_seconds(tls.getpeercert()["notAfter"])
                return {"ok": True, "not_after": datetime.datetime.fromtimestamp(not_after, datetime.timezone.utc)}
    except ssl.SSLCertVerificationError as err:
        return {"ok": False, "reason": err.verify_message}
    except (ssl.SSLError, ValueError) as err:
        return {"ok": False, "reason": err.__class__.__name__}


def production():
    """The real context: root /, real seams, and root (uid 0) as the only trusted owner. Nothing from the caller (env, argv, files) enters."""
    return Ctx(trusted_uid=0)


class Ctx:
    def __init__(self, *, root="/", run=None, run_inherit=None, getpass=None, isatty=None, confirm=None, now=None, sleep=None,
                 chown=None, geteuid=None, tls_probe=None, statvfs=None, stdout=None, stderr=None, trusted_uid=0):
        self.root = root
        self._run = run or _real_run
        self._run_inherit = run_inherit or _real_run_inherit
        self.getpass = getpass or _real_getpass
        self.isatty = isatty or (lambda: sys.stdin.isatty())
        self.confirm = confirm or _real_getpass  # B4: the answer is read without echo, like the value: an early paste must not show
        self.now = now or (lambda: datetime.datetime.now(datetime.timezone.utc))
        self.sleep = sleep or time.sleep
        self.chown = chown or _real_chown
        self.geteuid = geteuid or os.geteuid
        self.tls_probe = tls_probe or _real_tls_probe
        self.statvfs = statvfs or os.statvfs
        self.stdout = stdout or sys.stdout
        self.stderr = stderr or sys.stderr
        self.trusted_uid = trusted_uid

    def p(self, logical):
        """A host path under the root: root-prefixed in tests, the path itself in production."""
        return os.path.join(self.root, logical.lstrip("/")) if self.root != "/" else logical

    def bundle(self, rel=""):
        base = self.p(BUNDLE)
        return base + "/" + rel if rel else base

    def epoch(self):
        return self.now().timestamp()

    # children: argv is a list of str, the env is built from nothing (R1)
    def run(self, argv, stdin=None, timeout=None, extra_env=None):
        self._check(argv)
        return self._run(list(argv), stdin, timeout, fixed_env(extra_env))

    def run_inherit(self, argv, extra_env=None):
        self._check(argv)
        return self._run_inherit(list(argv), fixed_env(extra_env))

    @staticmethod
    def _check(argv):
        if isinstance(argv, (str, bytes)) or not all(isinstance(a, str) for a in argv):
            raise TypeError("argv must be a list of str")

    def out(self, text=""):
        self.stdout.write(text + "\n")

    def err(self, text=""):
        self.stderr.write(text + "\n")
