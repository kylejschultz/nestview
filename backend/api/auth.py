"""
auth.py — Authentication endpoints for Nestview.

Endpoints:
  GET  /api/auth/status   — returns setup_required and auth_mode (always public)
  POST /api/auth/setup    — first-run: set username, password, and auth_mode
  POST /api/auth/login    — exchange credentials for a session cookie
  POST /api/auth/logout   — clear the session cookie
"""

import logging
import os
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from database import get_session
from limiter import limiter
from models import AppSetting
from services.app_settings import get_setting, set_setting
from services.auth import (
    COOKIE_NAME,
    create_session_token,
    get_auth_mode,
    get_session_expiry_days,
    get_signer,
    hash_password,
    is_setup_complete,
    require_auth,
    verify_password,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SetupPayload(BaseModel):
    username: Optional[str] = Field(None, min_length=1, max_length=64)
    password: Optional[str] = Field(None, min_length=8, max_length=128)
    auth_mode: Literal["password", "none"] = "password"


class LoginPayload(BaseModel):
    username: str
    password: str


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class AuthModePayload(BaseModel):
    auth_mode: Literal["password", "none"]
    username: Optional[str] = Field(None, min_length=1, max_length=64)
    password: Optional[str] = Field(None, min_length=8, max_length=128)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
def auth_status(session: Session = Depends(get_session)) -> dict:
    return {
        "setup_required": not is_setup_complete(session),
        "auth_mode": get_auth_mode(session),
    }


@router.post("/setup", status_code=201)
def setup(payload: SetupPayload, session: Session = Depends(get_session)) -> dict:
    if is_setup_complete(session):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Setup has already been completed. Use the Settings UI to change credentials.",
        )

    if payload.auth_mode == "password":
        if not payload.username or not payload.password:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="username and password are required for password authentication",
            )
        set_setting(session, "admin_username", payload.username)
        set_setting(session, "admin_password_hash", hash_password(payload.password))

    set_setting(session, "auth_mode", payload.auth_mode)
    session.commit()

    logger.info("auth: setup completed — username=%r auth_mode=%r", payload.username, payload.auth_mode)
    return {"ok": True}


@router.post("/login")
@limiter.limit("10/minute")
def login(
    request: Request,
    payload: LoginPayload,
    response: Response,
    session: Session = Depends(get_session),
) -> dict:
    auth_mode = get_auth_mode(session)
    if auth_mode == "none":
        return {"ok": True, "auth_mode": "none"}

    if not is_setup_complete(session):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="setup_required")

    stored_username = get_setting(session, "admin_username") or ""
    stored_hash = get_setting(session, "admin_password_hash") or ""

    hash_ok = verify_password(payload.password, stored_hash) if stored_hash else False
    username_ok = payload.username == stored_username

    if not (username_ok and hash_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    expiry_days = get_session_expiry_days(session)
    signer = get_signer(session)
    token = create_session_token(payload.username, signer)

    secure_cookies = os.getenv("NESTVIEW_SECURE_COOKIES", "").strip().lower() == "true"

    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=expiry_days * 86400,
        path="/",
        secure=secure_cookies,
    )

    logger.info("auth: login successful — username=%r", payload.username)
    return {"ok": True, "auth_mode": "password"}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(
    request: Request,
    session: Session = Depends(get_session),
) -> dict:
    """
    Returns the current authenticated user, or 401 if not logged in.
    Used by the frontend to check session validity on load.
    """
    from services.auth import decode_session_token

    auth_mode = get_auth_mode(session)
    if auth_mode == "none":
        return {"authenticated": True, "username": None, "auth_mode": "none"}

    if not is_setup_complete(session):
        raise HTTPException(status_code=403, detail="setup_required")

    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="not_authenticated")

    expiry_days = get_session_expiry_days(session)
    signer = get_signer(session)
    username = decode_session_token(token, signer, max_age_seconds=expiry_days * 86400)

    if username is None:
        raise HTTPException(status_code=401, detail="session_expired")

    return {"authenticated": True, "username": username, "auth_mode": "password"}


@router.post("/change-password", dependencies=[Depends(require_auth)])
@limiter.limit("5/minute")
def change_password(
    request: Request,
    payload: ChangePasswordPayload,
    session: Session = Depends(get_session),
) -> dict:
    """Change the admin password. Requires the current password to verify identity."""
    stored_hash = get_setting(session, "admin_password_hash") or ""

    if not verify_password(payload.current_password, stored_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect.",
        )

    set_setting(session, "admin_password_hash", hash_password(payload.new_password))
    session.commit()

    logger.info("auth: password changed successfully")
    return {"ok": True}


@router.patch("/mode", dependencies=[Depends(require_auth)])
def update_auth_mode(
    payload: AuthModePayload,
    session: Session = Depends(get_session),
) -> dict:
    """Switch between password auth and no-auth. Switching to 'none' wipes stored credentials."""
    if payload.auth_mode == "none":
        for key in ("admin_username", "admin_password_hash"):
            row = session.exec(select(AppSetting).where(AppSetting.key == key)).first()
            if row is not None:
                session.delete(row)
    elif payload.auth_mode == "password" and payload.username and payload.password:
        set_setting(session, "admin_username", payload.username)
        set_setting(session, "admin_password_hash", hash_password(payload.password))
    set_setting(session, "auth_mode", payload.auth_mode)
    session.commit()
    logger.info("auth: auth_mode changed to %r", payload.auth_mode)
    return {"ok": True}
