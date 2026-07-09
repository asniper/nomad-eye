"""Password hashing and session token helpers. Stdlib-only (no bcrypt/argon2
native dependency) so installs never need to compile anything for this."""
import hashlib
import hmac
import secrets

_ALGO = 'pbkdf2_sha256'
_ITERATIONS = 260_000
SESSION_TOKEN_BYTES = 32


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), _ITERATIONS)
    return f"{_ALGO}${_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, hash_hex = stored.split('$')
        if algo != _ALGO:
            return False
        digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), int(iterations))
        return hmac.compare_digest(digest.hex(), hash_hex)
    except (ValueError, AttributeError):
        return False


def is_hashed(value: str) -> bool:
    return value.startswith(f"{_ALGO}$")


def generate_session_token() -> str:
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)
