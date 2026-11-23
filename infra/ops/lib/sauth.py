"""The staging basic-auth file (POLY-100 R11, S29, S30). The Caddyfile imports it as Caddyfile text, so anything but one exact line could write
directives into the process that also serves prod. One reader of the format, shared by the command that writes it and every place that checks it."""
import os
import re
import stat

from lib import compose

PATH = "/etc/polycarpic/secrets/caddy/staging_basic_auth"
DIR = "/etc/polycarpic/secrets/caddy"
GID = compose.GIDS["caddy"]
HASH = r"staging \$2y\$10\$[./A-Za-z0-9]{53}"
FILE = re.compile(HASH + r"\n")
INPUT = re.compile(r"staging:\$2y\$10\$[./A-Za-z0-9]{53}")
MAX = 128


def check(ctx):
    """-> None when the file is exactly right, else a short reason. No link is followed; owner, groups and modes are compared with 10010 itself."""
    try:
        dfd = os.open(ctx.p(DIR), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        return "directory missing or a link"
    try:
        st = os.fstat(dfd)
        if st.st_uid != ctx.trusted_uid or st.st_gid != GID or stat.S_IMODE(st.st_mode) != 0o750:
            return "directory is not root:%d 0750" % GID
        try:
            fd = os.open("staging_basic_auth", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dfd)
        except OSError:
            return "file missing or a link"
        try:
            fs = os.fstat(fd)
            if not stat.S_ISREG(fs.st_mode) or fs.st_uid != ctx.trusted_uid or fs.st_gid != GID or stat.S_IMODE(fs.st_mode) != 0o440:
                return "file is not a regular root:%d 0440 file" % GID
            data = os.read(fd, MAX + 1)
        finally:
            os.close(fd)
    finally:
        os.close(dfd)
    if len(data) > MAX:
        return "file is longer than %d bytes" % MAX
    try:
        text = data.decode("ascii")
    except UnicodeDecodeError:
        return "file is not ASCII"
    return None if FILE.fullmatch(text) else "file is not the one exact line"
