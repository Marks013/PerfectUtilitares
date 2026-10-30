"""Private service credentials. Never return or log credential material."""
import hashlib
import hmac
import os
import re
import stat
from uuid import UUID

SECRET_PATH = "/run/secrets/escalas_solver_secret"
TOKEN_PATTERN = re.compile(r"[a-f0-9]{64}\Z")
SECRET_PATTERN = re.compile(rb"[A-Za-z0-9_-]{43,128}\Z")


def load_secret(path=None):
    target = path or os.environ.get("ESCALAS_SOLVER_SECRET_FILE", SECRET_PATH)
    descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o077
                or not 43 <= info.st_size <= 129):
            raise ValueError("SOLVER_SECRET_INVALID")
        secret = stream.read(130).strip()
    if not SECRET_PATTERN.fullmatch(secret):
        raise ValueError("SOLVER_SECRET_INVALID")
    return secret


def authorized(headers, secret):
    values = headers.get_all("Authorization", [])
    if len(values) != 1 or len(values[0]) > 160:
        return False
    value = values[0]
    if not value.startswith("Bearer "):
        return False
    try:
        candidate = value[7:].encode("ascii")
    except UnicodeEncodeError:
        return False
    return len(candidate) == len(secret) and hmac.compare_digest(candidate, secret)


def operation_identity(request_id, cancel_token):
    if not isinstance(request_id, str) or not isinstance(cancel_token, str):
        raise ValueError("INVALID_OPERATION")
    parsed = UUID(request_id)
    if parsed.version != 4 or str(parsed) != request_id or not TOKEN_PATTERN.fullmatch(cancel_token):
        raise ValueError("INVALID_OPERATION")
    return request_id, hashlib.sha256(cancel_token.encode("ascii")).digest()
