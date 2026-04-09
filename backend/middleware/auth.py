from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from services.auth import validate_session

UNAUTH_PATHS = {
    "/api/health",
    "/api/version",
    "/api/auth/login",
    "/api/auth/setup",
    "/api/auth/setup-status",
    "/api/metrics",
}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/") or path in UNAUTH_PATHS:
            return await call_next(request)
        secret_key = request.app.state.secret_key
        expiry_hours = request.app.state.session_expiry_hours
        if not validate_session(request, secret_key, expiry_hours):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        return await call_next(request)
