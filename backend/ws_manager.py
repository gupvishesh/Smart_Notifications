from fastapi import WebSocket
from typing import Dict, List


class WSManager:
    def __init__(self):
        # user_id -> LIST of active WebSocket connections (supports multiple tabs)
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        tab_count = len(self.active_connections[user_id])
        print(f"[WS] {user_id} connected (tab {tab_count}). Online users: {list(self.active_connections.keys())}")

    def disconnect(self, user_id: str, websocket: WebSocket):
        if user_id in self.active_connections:
            try:
                self.active_connections[user_id].remove(websocket)
            except ValueError:
                pass
            # Clean up the key if no sockets remain
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        print(f"[WS] {user_id} disconnected. Online users: {list(self.active_connections.keys())}")

    def is_online(self, user_id: str) -> bool:
        return bool(self.active_connections.get(user_id))

    async def send_notification(self, user_id: str, data: dict):
        """Push a notification to ALL open tabs for this user."""
        sockets = list(self.active_connections.get(user_id, []))
        dead = []
        for ws in sockets:
            try:
                await ws.send_json(data)
            except Exception as e:
                print(f"[WS] Dead socket for {user_id}: {e}")
                dead.append(ws)
        # Clean up stale sockets discovered during send
        for ws in dead:
            self.disconnect(user_id, ws)


# Singleton instance used across the app
ws_manager = WSManager()
