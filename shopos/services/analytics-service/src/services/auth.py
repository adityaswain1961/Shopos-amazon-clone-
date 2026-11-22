import os

import jwt
from fastapi import Depends, HTTPException, Request
from jwt import PyJWKClient

ISSUER = "shopos-auth-service"
STAFF_ROLES = {"admin", "super_admin", "support"}

# Keys are fetched once and cached; refetched only for an unknown `kid`.
_jwks = PyJWKClient(
    os.getenv("AUTH_JWKS_URL", "http://localhost:3001/.well-known/jwks.json"),
    cache_keys=True,
    lifespan=600,
    timeout=3,
)


def current_user(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = auth[7:]
    try:
        key = _jwks.get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=ISSUER,
            options={"require": ["exp", "sub"]},
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_staff(user: dict = Depends(current_user)) -> dict:
    if not STAFF_ROLES.intersection(user.get("roles") or []):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return user
