import asyncio
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import NotificationRequest, UserCreate
from ws_manager import ws_manager
from notification_store import notification_store

app = FastAPI(title="Smart Notification System")

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
# User Management Routes
# ---------------------------------------------------------------------------

@app.get("/users")
async def get_users():
    """Return all known user IDs (from store + any WS-only connections)."""
    store_users = set(notification_store.get_all_user_ids())
    ws_users = set(ws_manager.active_connections.keys())
    all_users = sorted(store_users | ws_users)
    return {"users": all_users}


@app.post("/users", status_code=201)
async def create_user(body: UserCreate):
    """Register a new user ID (creates an empty inbox)."""
    user_id = body.user_id.strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id cannot be empty")
    notification_store.register_user(user_id)
    return {"user_id": user_id, "status": "created"}


# ---------------------------------------------------------------------------
# Notification Routes
# ---------------------------------------------------------------------------

@app.post("/notify")
async def notify(request: NotificationRequest):
    """
    Trigger a notification for target_user_id.
    Online → push over WebSocket instantly. Offline → store in missed queue.
    """
    target = request.target_user_id
    online = ws_manager.is_online(target)

    notification = notification_store.add_notification(
        user_id=target,
        notif_type=request.type,
        message=request.message,
        is_online=online,
        priority=request.priority,
    )

    if online:
        await ws_manager.send_notification(target, notification.model_dump())
        return {"status": "delivered", "notification": notification.model_dump()}
    else:
        return {"status": "queued", "notification": notification.model_dump()}


@app.get("/notifications/{user_id}")
async def get_notifications(user_id: str):
    """Return all active (non-dismissed) notifications for a user, newest first."""
    notifications = notification_store.get_notifications(user_id)
    return {"notifications": [n.model_dump() for n in notifications]}


@app.patch("/notifications/{notification_id}/read")
async def mark_as_read(notification_id: str):
    """Mark a single notification as read."""
    notification = notification_store.mark_as_read(notification_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"notification": notification.model_dump()}


@app.patch("/notifications/{user_id}/read-all")
async def mark_all_read(user_id: str):
    """Mark all notifications as read for a user."""
    count = notification_store.mark_all_read(user_id)
    return {"updated": count}


@app.delete("/notifications/{notification_id}")
async def dismiss_notification(notification_id: str):
    """Soft-delete (dismiss) a notification."""
    notification = notification_store.dismiss_notification(notification_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"status": "dismissed", "id": notification_id}


# ---------------------------------------------------------------------------
# WebSocket Endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    # Ensure user exists in the store
    notification_store.register_user(user_id)
    await ws_manager.connect(user_id, websocket)
    try:
        # 500ms delay — gives the socket time to fully stabilise before flushing
        await asyncio.sleep(0.5)

        missed = notification_store.flush_missed(user_id)
        if missed:
            for notification in missed:
                await ws_manager.send_notification(user_id, notification.model_dump())

        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        # Pass the specific socket instance so multi-tab connections aren't all dropped
        ws_manager.disconnect(user_id, websocket)
