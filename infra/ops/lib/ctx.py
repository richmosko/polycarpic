"""The context object (R1): everything the outside world supplies, so tests can inject fakes and a temp root.

The root and the fakes come from the constructor only, never from argv, the environment or a file.
Seams: run(argv, stdin, timeout, env) -> (code, stdout text, stderr text), raising TimeoutError; run_inherit(argv, env) -> code;
getpass(prompt); isatty(); confirm(prompt); now() -> aware UTC datetime; sleep(seconds); chown(fd_or_path, uid, gid); geteuid();
tls_probe(host, port) -> {"ok": True, "not_after": datetime} | {"ok": False, "reason": str} (raises OSError when nothing answers);
statvfs(path) with the host path; run_bytes(argv, stdin, timeout, env) -> (code, stdout bytes, stderr text) for a child that prints a tar
(POLY-100 R4); https_status(host, addr, path) -> HTTP status of GET https://<host><path> at <addr>, raising OSError (POLY-100 A13); owner_of(fd, logical path) -> (uid, gid) (POLY-100 S30: the staging basic-auth file's owner and group are compared with root:10010).
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
        p = subprocess.run(argv, input=stdin, capture_output=True, text=True, errors="replace", timeout=timeout, env=env, shell=False, check=False)  # non-UTF-8 output is data, not a crash (F2)
    except subprocess.TimeoutExpired:
        raise TimeoutError(argv[0])
    except OSError as err:
        return 127, "", "%s: %s\n" % (argv[0], err.strerror or err.__class__.__name__)
    return p.returncode, p.stdout, p.stderr


MAX_BYTES = (64 << 20) + 1  # run_bytes reads at most this much of a child's stdout, then kills it (POLY-100 R4: an over-cap tar is refused)


def _real_run_bytes(argv, stdin=None, timeout=None, env=None):
    import tempfile
    import threading
    try:
        p = subprocess.Popen(argv, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, env=env, shell=False)
    except OSError as err:
        return 127, b"", "%s: %s\n" % (argv[0], err.strerror or err.__class__.__name__)
    errbuf = []
    reader = threading.Thread(target=lambda: errbuf.append(p.stderr.read(65536)))
    reader.daemon = True
    reader.start()
    timer = threading.Timer(timeout, p.kill) if timeout else None
    if timer:
        timer.start()
    chunks, total = [], 0
    try:
        while total < MAX_BYTES:
            block = p.stdout.read(min(1 << 20, MAX_BYTES - total))
            if not block:
                break
            chunks.append(block)
            total += len(block)
        if total >= MAX_BYTES:
            p.kill()
        code = p.wait()
    finally:
        if timer:
            timer.cancel()
        p.stdout.close()
    reader.join(5)
    if timer and not timer.is_alive() and code < 0 and total < MAX_BYTES:
        raise TimeoutError(argv[0])
    return code, b"".join(chunks), (errbuf[0] if errbuf else b"").decode("utf-8", "replace")


def _real_ismount(path):
    try:
        return os.stat(path).st_dev != os.stat(os.path.dirname(os.path.normpath(path))).st_dev
    except OSError:
        return False


def _real_owner_of(fd, path):
    st = os.fstat(fd)
    return st.st_uid, st.st_gid


def _real_https_status(host, addr, path):
    """GET https://<host><path> at <addr>:443 with <host> as SNI and Host, full certificate verification, no redirect followed, 10 s. -> status code."""
    context = ssl.create_default_context()
    with socket.create_connection((addr, 443), timeout=10) as raw:
        raw.settimeout(10)
        with context.wrap_socket(raw, server_hostname=host) as tls:
            tls.sendall(("GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\nUser-Agent: polycarpic-ops\r\n\r\n" % (path, host)).encode("ascii"))
            head = tls.recv(256).decode("latin-1", "replace")
    parts = head.split(" ", 2)
    if len(parts) < 2 or not parts[0].startswith("HTTP/") or not parts[1].isdigit():
        raise OSError("not an HTTP response")
    return int(parts[1])


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
        if termios.tcgetattr(fd)[3] & termios.ECHO:  # B5: the terminal did not take it: never read a secret that would show
            warnings.warn("echo is still on", _getpass.GetPassWarning)
            return ""
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
                 chown=None, geteuid=None, tls_probe=None, statvfs=None, stdout=None, stderr=None, trusted_uid=0, stdout_bytes=None, run_bytes=None, stdin=None, https_status=None, owner_of=None, ismount=None):
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
        self.stdout_bytes = stdout_bytes or getattr(sys.stdout, "buffer", None)  # fetch-premigration writes the file's bytes here
        self.trusted_uid = trusted_uid
        self.stdin = stdin or sys.stdin
        self._run_bytes = run_bytes or _real_run_bytes
        self._https_status = https_status or _real_https_status
        self._owner_of = owner_of or _real_owner_of
        self._ismount = ismount or _real_ismount

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

    def run_bytes(self, argv, stdin=None, timeout=None, extra_env=None):
        self._check(argv)
        return self._run_bytes(list(argv), stdin, timeout, fixed_env(extra_env))

    def https_status(self, host, addr, path):
        return self._https_status(host, addr, path)

    def ismount(self, path):
        """True when `path` is a mount point (its device differs from its parent's), F13."""
        return self._ismount(path)

    def owner_of(self, fd, path):
        """(uid, gid) of an open file or directory: `fd` is what the box reads; `path` is its logical path, for a harness that cannot chown."""
        return self._owner_of(fd, path)

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
