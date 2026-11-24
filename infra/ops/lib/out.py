"""Output helpers: printable-ASCII filtering (K3, K8) and the status line format (R7)."""
import collections
import time

Line = collections.namedtuple("Line", "state item project detail extra", defaults=((),))  # `extra`: more lines printed unwrapped and uncut


def clean(text, keep_newline=False):
    """Replace everything outside printable ASCII (0x20-0x7E) with '?'."""
    return "".join(c if 0x20 <= ord(c) <= 0x7E or (keep_newline and c == "\n") else "?" for c in str(text))


def fit(text, width=80):
    return text if len(text) <= width else text[: width - 1] + "…"


def fmt_line(line):
    return fit("%-4s %-9s %-8s %s" % (line.state, line.item, line.project, clean(line.detail))).rstrip()


def hhmm(epoch):
    return time.strftime("%H:%MZ", time.gmtime(epoch))


def stamp(epoch):
    return time.strftime("%Y-%m-%d %H:%MZ", time.gmtime(epoch))
