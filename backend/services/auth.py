import bcrypt
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from fastapi import Request, Response

_COOKIE_NAME = "nestview_session"
_SALT = "nestview-session"


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_session_cookie(response: Response, request: Request, secret_key: str, expiry_hours: float) -> None:
    s = URLSafeTimedSerializer(secret_key, salt=_SALT)
    token = s.dumps({"user": "admin"})
    secure = request.url.scheme == "https"
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=secure,
        max_age=int(expiry_hours * 3600),
    )


def validate_session(request: Request, secret_key: str, expiry_hours: float) -> bool:
    token = request.cookies.get(_COOKIE_NAME)
    if not token:
        return False
    s = URLSafeTimedSerializer(secret_key, salt=_SALT)
    try:
        s.loads(token, max_age=int(expiry_hours * 3600))
        return True
    except (BadSignature, SignatureExpired):
        return False
