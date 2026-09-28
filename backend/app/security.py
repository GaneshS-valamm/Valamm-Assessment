"""Password hashing, JWT issuing/verification, assessment tokens, simple rate limiting."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import settings

# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# --------------------------------------------------------------------------- #
# JWT
# --------------------------------------------------------------------------- #


def create_access_token(subject: str, admin_id: int) -> tuple[str, int]:
    expires_in = settings.JWT_EXPIRE_MINUTES * 60
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "aid": admin_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token, expires_in


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None


# --------------------------------------------------------------------------- #
# Assessment tokens: high entropy, stored only as a hash
# --------------------------------------------------------------------------- #


def generate_assessment_token() -> str:
    return secrets.token_urlsafe(48)


def hash_assessment_token(raw_token: str) -> str:
    """Keyed hash so a leaked DB alone cannot be brute-forced offline without JWT_SECRET."""
    return hmac.new(
        settings.JWT_SECRET.encode("utf-8"), raw_token.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def _keystream(nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    key = settings.JWT_SECRET.encode("utf-8")
    while len(out) < length:
        out += hmac.new(key, nonce + counter.to_bytes(4, "big"), hashlib.sha512).digest()
        counter += 1
    return bytes(out[:length])


def encrypt_token(raw_token: str) -> str:
    """Reversible, secret-keyed encryption so the admin UI can re-display a link."""
    data = raw_token.encode("utf-8")
    nonce = secrets.token_bytes(16)
    cipher = bytes(a ^ b for a, b in zip(data, _keystream(nonce, len(data))))
    return f"{nonce.hex()}:{cipher.hex()}"


def decrypt_token(stored: str | None) -> str | None:
    if not stored or ":" not in stored:
        return None
    try:
        nonce_hex, cipher_hex = stored.split(":", 1)
        nonce, cipher = bytes.fromhex(nonce_hex), bytes.fromhex(cipher_hex)
        return bytes(a ^ b for a, b in zip(cipher, _keystream(nonce, len(cipher)))).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


# --------------------------------------------------------------------------- #
# Very small in-process rate limiter (enough for a single-node MVP)
# --------------------------------------------------------------------------- #

_hits: dict[str, list[float]] = {}


def rate_limit_exceeded(key: str, limit: int, window_seconds: int) -> bool:
    now = time.time()
    bucket = [t for t in _hits.get(key, []) if now - t < window_seconds]
    bucket.append(now)
    _hits[key] = bucket
    return len(bucket) > limit
