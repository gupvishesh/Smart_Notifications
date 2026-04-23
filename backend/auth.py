"""
auth.py — Demo-grade JWT authentication layer.

In production: replace the /auth/token handler to validate credentials
against a real user store before issuing a token.
The verify_token() function and all downstream protection is unchanged.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Header, HTTPException, WebSocket, status
from jose import JWTError, jwt

SECRET_KEY  = os.getenv("JWT_SECRET_KEY", "dev-secret-change-in-production-please")
ALGORITHM   = "HS256"
TOKEN_EXPIRY = timedelta(hours=24)


def create_token(user_id: str) -> str:
    """Issue a signed JWT for the given user_id."""
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + TOKEN_EXPIRY,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> str:
    """
    Validate a JWT and return the user_id (sub claim).
    Raises HTTPException(401) on any failure.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        return user_id
    except JWTError:
        raise credentials_exception


# ── FastAPI dependencies ────────────────────────────────────────────────────

def get_current_user(authorization: str = Header(...)) -> str:
    """
    Dependency for REST endpoints.
    Expects:  Authorization: Bearer <token>
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header must start with 'Bearer '",
        )
    token = authorization.removeprefix("Bearer ").strip()
    return verify_token(token)


def get_ws_user(token: str) -> str:
    """
    Dependency for WebSocket endpoints.
    Token is passed as ?token= query param since WS clients can't set headers.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="WebSocket connection requires a ?token= query param",
        )
    return verify_token(token)
