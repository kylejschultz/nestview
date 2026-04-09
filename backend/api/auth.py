"""
auth.py — Authentication endpoints for Nestview.

Endpoints:
  GET  /api/auth/status   — returns setup_required and auth_mode (always public)
  POST /api/auth/setup    — first-run: set username, password, and auth_mode
  POST /api/auth/login    — exchange credentials for a session cookie
  POST /api/auth/logout   — clear the session cookie
"""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlmodel import Session

from database import get_session
from services.app_settings import get_setting, set_setting
from services.auth import (
    COOKIE_NAME,
    create_session_token,
    get_auth_mode,
    get_session_expiry_days,
    get_signer,
    hash_password,
    is_setup_complete,
    verify_password,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SetupPayload(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    auth_mode: Literal["password", "none"] = "password"


class LoginPayload(BaseModel):
    username: str
    password: str


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

    set_setting(session, "admin_username", payload.username)
    set_setting(session, "admin_password_hash", hash_password(payload.password))
    set_setting(session, "auth_mode", payload.auth_mode)
    session.commit()

    logger.info("auth: setup completed — username=%r auth_mode=%r", payload.username, payload.auth_mode)
    return {"ok": True}


@router.post("/login")
def login(
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

    if payload.username != stored_username or not verify_password(payload.password, stored_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    expiry_days = get_session_expiry_days(session)
    signer = get_signer(session)
    token = create_session_token(payload.username, signer)

    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=expiry_days * 86400,
        path="/",
    )

    logger.info("auth: login successful — username=%r", payload.username)
    return {"ok": True, "auth_mode": "password"}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return {"ok": True}
