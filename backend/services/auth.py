"""
auth.py — Session management and password hashing for Nestview.

Sessions use a signed httpOnly cookie via itsdangerous.TimestampSigner.
The signing secret is auto-generated on first start and persisted in AppSetting
under the key `session_secret`. It can be overridden via the SECRET_KEY env var.

AppSetting keys used by this module:
  session_secret        — HMAC signing key for session cookies (auto-generated)
  admin_username        — stored username (set during setup wizard)
  admin_password_hash   — bcrypt hash of the admin password
  auth_mode             — "password" (default) or "none" (escape hatch)
  session_expiry_days   — session lifetime in days (default: 7)
"""

import os
import secrets
import logging
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, TimestampSigner
from sqlmodel import Session

from database import get_session, engine
from models import AppSetting
from services.app_settings import get_setting, set_setting

logger = logging.getLogger(__name__)

COOKIE_NAME = "nestview_session"
_DEFAULT_SESSION_EXPIRY_DAYS = 7

# ---------------------------------------------------------------------------
# Secret key — env override or auto-generated + persisted
# ---------------------------------------------------------------------------

def _load_or_create_secret(session: Session) -> str:
    env_key = os.getenv("SECRET_KEY", "").strip()
    if env_key:
        return env_key
    stored = get_setting(session, "session_secret")
    if stored:
        return stored
    new_key = secrets.token_hex(32)
    set_setting(session, "session_secret", new_key)
    session.commit()
    logger.info("auth: generated new session_secret and persisted to DB")
    return new_key


def get_signer(session: Session) -> TimestampSigner:
    secret = _load_or_create_secret(session)
    return TimestampSigner(secret)


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ---------------------------------------------------------------------------
# Session cookie helpers
# ---------------------------------------------------------------------------

def create_session_token(username: str, signer: TimestampSigner) -> str:
    return signer.sign(username).decode()


def decode_session_token(
    token: str,
    signer: TimestampSigner,
    max_age_seconds: int,
) -> Optional[str]:
    try:
        username = signer.unsign(token, max_age=max_age_seconds).decode()
        return username
    except (BadSignature, SignatureExpired):
        return None


# ---------------------------------------------------------------------------
# Auth status helpers
# ---------------------------------------------------------------------------

def is_setup_complete(session: Session) -> bool:
    """Returns True if a password hash exists — setup wizard has been completed."""
    return bool(get_setting(session, "admin_password_hash"))


def get_auth_mode(session: Session) -> str:
    """Returns 'password' or 'none'."""
    return get_setting(session, "auth_mode") or "password"


def get_session_expiry_days(session: Session) -> int:
    val = get_setting(session, "session_expiry_days")
    try:
        return int(val) if val else _DEFAULT_SESSION_EXPIRY_DAYS
    except ValueError:
        return _DEFAULT_SESSION_EXPIRY_DAYS


# ---------------------------------------------------------------------------
# FastAPI dependency — require_auth
# ---------------------------------------------------------------------------

def require_auth(
    request: Request,
    db: Session = Depends(get_session),
):
    """
    FastAPI dependency applied to all user-facing routes.
    - If auth_mode is 'none', passes through immediately.
    - If setup is not complete, raises 403 (frontend should redirect to /setup).
    - Validates the session cookie; raises 401 if missing or invalid.
    """
    auth_mode = get_auth_mode(db)
    if auth_mode == "none":
        return

    if not is_setup_complete(db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="setup_required",
        )

    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not_authenticated",
        )

    expiry_days = get_session_expiry_days(db)
    signer = get_signer(db)
    username = decode_session_token(token, signer, max_age_seconds=expiry_days * 86400)

    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="session_expired",
        )
