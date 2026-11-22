"""Secret names the operator CLI may and may not write (R4)."""
import re

NAME = re.compile(r"[a-z][a-z0-9_]{0,63}")
TWO_LINES = "backup_store_credential"


def refused_by(name):
    """The tool that writes this name when set-secret must not (provision, init-keyring, staging-auth), else None."""
    if name == "db_superuser_password" or name.startswith("db_password_") or name == "auth_secret":
        return "provision"
    if name == "credential_keyring":
        return "init-keyring"
    if name == "staging_basic_auth":
        return "staging-auth"
    return None


def bad_value(value):
    """Why a pasted value is refused, or None. Never echoes the value."""
    if value == "":
        return "empty value"
    if len(value.encode("utf-8", "replace")) > 4096:
        return "value is longer than 4096 bytes"
    if any(c.isspace() or ord(c) < 0x20 or 0x7F <= ord(c) <= 0x9F for c in value):
        return "value holds whitespace or a control character"
    return None
