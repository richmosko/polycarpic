"""The context object (R1): everything the outside world supplies, so tests can inject fakes and a temp root.

The root and the fakes come from the constructor only, never from argv, the environment or a file.
"""
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


class Timeout(Exception):
    """A child process ran over its timeout."""


def fixed_env(extra=None):
    """The environment a child gets: built from nothing, plus only the variables a call names."""
    env = {"PATH": FIXED_PATH, "LC_ALL": "C.UTF-8", "HOME": "/root"}
    env.update(extra or {})
    return env


def _real_run(argv, stdin, timeout, env):
    try:
        p = subprocess.run(argv, input=stdin, capture_output=True, timeout=timeout, env=env, shell=False, check=False)
    except subprocess.TimeoutExpired:
        raise Timeout(argv[0])
    except OSError as err:
        return 127, b"", ("%s: %s" % (argv[0], err.strerror or err.__class__.__name__)).encode()
    return p.returncode, p.stdout, p.stderr


def _real_run_inherit(argv, env):
    try:
        return subprocess.run(argv, env=env, shell=False, check=False).returncode
    except OSError as err:
        sys.stderr.write("%s: %s\n" % (argv[0], err.strerror or err.__class__.__name__))
        return 127


def _real_getpass(prompt):
    # getpass falls back to an echoed read when it cannot switch echo off; refuse that outright (K5).
    try:
        import termios
        termios.tcgetattr(sys.stdin.fileno())
    except Exception:
        warnings.warn("cannot control echo", _getpass.GetPassWarning)
        return ""
    return _getpass.getpass(prompt)


def _real_tls_probe(host, port, timeout):
    """-> (notAfter epoch or None, error text or None, answered bool). Verified against the system store, hostname checked."""
    context = ssl.create_default_context()
    try:
        with socket.create_connection((host, port), timeout=timeout) as raw:
            with context.wrap_socket(raw, server_hostname=host) as tls:
                return ssl.cert_time_to_seconds(tls.getpeercert()["notAfter"]), None, True
    except ssl.SSLCertVerificationError as err:
        return None, err.verify_message, True
    except (ssl.SSLError, ValueError) as err:
        return None, err.__class__.__name__, True
    except OSError:
        return None, None, False


class Ctx:
    def __init__(self, root="/", run=None, run_inherit=None, getpass=None, isatty=None, confirm=None, now=None,
                 chown=None, geteuid=None, tls_probe=None, statvfs=None, stdout=None, stderr=None, sleep=None,
                 hostname=None, stat=None, fstat=None, ismount=None, version=None, ops_dir=None):
        self.root = root
        self._run = run or _real_run
        self._run_inherit = run_inherit or _real_run_inherit
        self.getpass = getpass or _real_getpass
        self.isatty = isatty or (lambda: sys.stdin.isatty())
        self.confirm = confirm or (lambda prompt: input(prompt))
        self.now = now or time.time
        self.sleep = sleep or time.sleep
        self.chown = chown or os.fchown
        self.geteuid = geteuid or os.geteuid
        self.tls_probe = tls_probe or _real_tls_probe
        self.statvfs = statvfs or os.statvfs
        self.hostname = hostname or socket.gethostname
        self.stat = stat or (lambda p: os.lstat(p))
        self.fstat = fstat or os.fstat
        self._ismount = ismount or os.path.ismount
        self.stdout = stdout or sys.stdout
        self.stderr = stderr or sys.stderr
        self.version = version
        self.ops_dir = ops_dir

    # paths: logical paths ("/etc/polycarpic/...") live under root
    def path(self, logical):
        return os.path.join(self.root, logical.lstrip("/")) if self.root != "/" else logical

    def display(self, real):
        """The logical path for a real one, for messages."""
        if self.root != "/" and real.startswith(self.root.rstrip("/") + "/"):
            return real[len(self.root.rstrip("/")):]
        return real

    def ismount(self, logical):
        return self._ismount(self.path(logical))

    @property
    def bundle(self):
        return BUNDLE

    def bundle_path(self, rel):
        return BUNDLE + "/" + rel

    # children: argv is a list of str, the env is built from nothing (R1)
    def call(self, argv, stdin=b"", timeout=None, extra_env=None):
        self._check_argv(argv)
        return self._run(list(argv), stdin, timeout, fixed_env(extra_env))

    def call_inherit(self, argv, extra_env=None):
        self._check_argv(argv)
        return self._run_inherit(list(argv), fixed_env(extra_env))

    @staticmethod
    def _check_argv(argv):
        if isinstance(argv, (str, bytes)) or not all(isinstance(a, str) for a in argv):
            raise TypeError("argv must be a list of str")

    def out(self, text=""):
        self.stdout.write(text + "\n")

    def err(self, text=""):
        self.stderr.write(text + "\n")
