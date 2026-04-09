from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlmodel import Session

from database import get_session
from services.app_settings import get_setting, set_setting
from services.auth import hash_password, verify_password, create_session_cookie

router = APIRouter(prefix="/api/auth", tags=["auth"])

_COOKIE_NAME = "nestview_session"


class PasswordBody(BaseModel):
    password: str


class SetupBody(BaseModel):
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


@router.get("/setup-status")
def setup_status(session: Session = Depends(get_session)) -> dict:
    return {"setup_complete": get_setting(session, "admin_password_hash") is not None}


@router.post("/setup")
def setup(body: SetupBody, request: Request, response: Response, session: Session = Depends(get_session)) -> dict:
    if get_setting(session, "admin_password_hash") is not None:
        raise HTTPException(status_code=400, detail="Setup already complete")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    hashed = hash_password(body.password)
    set_setting(session, "admin_password_hash", hashed)
    session.commit()
    return {"ok": True}


@router.post("/login")
def login(body: PasswordBody, request: Request, response: Response, session: Session = Depends(get_session)) -> dict:
    hashed = get_setting(session, "admin_password_hash")
    if hashed is None:
        raise HTTPException(status_code=403, detail="Setup not complete")
    if not verify_password(body.password, hashed):
        raise HTTPException(status_code=401, detail="Invalid password")
    secret_key = request.app.state.secret_key
    expiry_hours = request.app.state.session_expiry_hours
    create_session_cookie(response, request, secret_key, expiry_hours)
    return {"ok": True}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.set_cookie(key=_COOKIE_NAME, value="", max_age=0, httponly=True, samesite="lax")
    return {"ok": True}


@router.get("/me")
def me() -> dict:
    return {"user": "admin"}


@router.post("/change-password")
def change_password(body: ChangePasswordBody, session: Session = Depends(get_session)) -> dict:
    hashed = get_setting(session, "admin_password_hash")
    if not hashed or not verify_password(body.current_password, hashed):
        raise HTTPException(status_code=401, detail="Invalid current password")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=422, detail="New password must be at least 8 characters")
    set_setting(session, "admin_password_hash", hash_password(body.new_password))
    session.commit()
    return {"ok": True}
