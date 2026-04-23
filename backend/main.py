"""
main.py — FastAPI application entry point.

Phase 2 additions:
  - Async startup: DB table creation + escalation background loop
  - POST /auth/token — issues JWT (demo-grade)
  - POST /notify — JWT-protected, routes through pub/sub broker
  - WS /ws/{user_id} — JWT-protected via ?token= query param
  - All route handlers are fully async (await notification_store calls)
"""
import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware

from auth import create_token, get_current_user, verify_token
from database import init_db
from models import NotificationRequest, TokenRequest, UserCreate
from notification_store import notification_store
from pubsub import broker
from ws_manager import ws_manager
import fallback_service


# ---------------------------------------------------------------------------
# Lifespan — startup & shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────
    await init_db()
    # Register default users so the GET /users endpoint always returns them
    for uid in ["Alex", "Blake", "Casey", "Admin"]:
        await notification_store.register_user(uid)
    # Start the escalation background loop
    asyncio.create_task(fallback_service.start_loop())
    print("[App] Startup complete.")
    yield
    # ── Shutdown ─────────────────────────────────────────────────────────
    print("[App] Shutting down.")


app = FastAPI(title="Smart Notification System", lifespan=lifespan)

# ---------------------------------------------------------------------------
# CORS — registered FIRST, before any routes
# ---------------------------------------------------------------------------
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth Routes
# ---------------------------------------------------------------------------

@app.post("/auth/token")
async def get_token(body: TokenRequest):
    """
    Demo-grade: issue a JWT for any user_id without password validation.
    In production, verify credentials against a user store first.
    """
    user_id = body.user_id.strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id cannot be empty")
    token = create_token(user_id)
    return {"access_token": token, "token_type": "bearer"}


# ---------------------------------------------------------------------------
# User Management Routes
# ---------------------------------------------------------------------------

@app.get("/users")
async def get_users():
    """Return all known user IDs."""
    store_users = set(await notification_store.get_all_user_ids())
    ws_users    = set(ws_manager.active_connections.keys())
    return {"users": sorted(store_users | ws_users)}


@app.post("/users", status_code=201)
async def create_user(body: UserCreate):
    """Register a new user ID (creates an empty inbox)."""
    user_id = body.user_id.strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id cannot be empty")
    await notification_store.register_user(user_id)
    return {"user_id": user_id, "status": "created"}


# ---------------------------------------------------------------------------
# Notification Routes
# ---------------------------------------------------------------------------

@app.post("/notify")
async def notify(
    request: NotificationRequest,
    _current_user: str = Depends(get_current_user),   # ← JWT guard
):
    """
    Trigger a notification for target_user_id.
    Online  → published to pub/sub broker → dispatched over WebSocket.
    Offline → stored in DB with queued_missed=True, flushed on reconnect.
    """
    target = request.target_user_id
    online = ws_manager.is_online(target)

    notification = await notification_store.add_notification(
        user_id=target,
        notif_type=request.type,
        message=request.message,
        is_online=online,
        priority=request.priority,
    )

    if online:
        await broker.publish(target, notification.model_dump())
        return {"status": "delivered", "notification": notification.model_dump()}
    else:
        return {"status": "queued", "notification": notification.model_dump()}


@app.get("/notifications/{user_id}")
async def get_notifications(user_id: str):
    """Return all active (non-dismissed) notifications for a user, newest first."""
    notifications = await notification_store.get_notifications(user_id)
    return {"notifications": [n.model_dump() for n in notifications]}


@app.patch("/notifications/{notification_id}/read")
async def mark_as_read(notification_id: str):
    """Mark a single notification as read."""
    notification = await notification_store.mark_as_read(notification_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"notification": notification.model_dump()}


@app.patch("/notifications/{user_id}/read-all")
async def mark_all_read(user_id: str):
    """Mark all notifications as read for a user."""
    count = await notification_store.mark_all_read(user_id)
    return {"updated": count}


@app.delete("/notifications/{notification_id}")
async def dismiss_notification(notification_id: str):
    """Soft-delete (dismiss) a notification."""
    notification = await notification_store.dismiss_notification(notification_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"status": "dismissed", "id": notification_id}


# ---------------------------------------------------------------------------
# WebSocket Endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    user_id: str,
    token: str = Query(...),          # ?token=<jwt>
):
    # ── JWT validation ──────────────────────────────────────────────────
    try:
        token_user_id = verify_token(token)
    except HTTPException:
        await websocket.close(code=1008)  # Policy violation
        return

    # Prevent a user from connecting as someone else
    if token_user_id != user_id:
        await websocket.close(code=1008)
        return

    # ── Normal connection flow ──────────────────────────────────────────
    await notification_store.register_user(user_id)
    await ws_manager.connect(user_id, websocket)

    try:
        # Small delay so the socket stabilises before flushing missed queue
        await asyncio.sleep(0.5)

        missed = await notification_store.flush_missed(user_id)
        for notification in missed:
            # Publish through broker so it goes through the dispatch loop
            await broker.publish(user_id, notification.model_dump())

        # Keep connection alive — wait for client messages (ping/pong or close)
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        ws_manager.disconnect(user_id, websocket)
