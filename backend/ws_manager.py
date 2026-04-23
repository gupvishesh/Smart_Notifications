"""
ws_manager.py — WebSocket connection registry.

Tracks user_id → list of active WebSocket connections (multi-tab support).
Delivery is now triggered by the pub/sub broker, not called directly from routes.
"""
import asyncio
from fastapi import WebSocket
from typing import Dict, List


class WSManager:
    def __init__(self):
        # user_id → list of active WebSocket connections (one per open tab)
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # user_id → background dispatch task (one per connected user)
        self._dispatch_tasks: Dict[str, asyncio.Task] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        tab_count = len(self.active_connections[user_id])
        print(f"[WS] {user_id} connected (tab {tab_count}). Online: {list(self.active_connections.keys())}")

        # Start a pub/sub dispatch loop for this user if not already running
        if user_id not in self._dispatch_tasks or self._dispatch_tasks[user_id].done():
            from pubsub import broker
            task = asyncio.create_task(broker.dispatch_loop(user_id, self))
            self._dispatch_tasks[user_id] = task

    def disconnect(self, user_id: str, websocket: WebSocket):
        if user_id in self.active_connections:
            try:
                self.active_connections[user_id].remove(websocket)
            except ValueError:
                pass
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
                # Cancel the dispatch task — no sockets left for this user
                task = self._dispatch_tasks.pop(user_id, None)
                if task and not task.done():
                    task.cancel()
        print(f"[WS] {user_id} disconnected. Online: {list(self.active_connections.keys())}")

    def is_online(self, user_id: str) -> bool:
        return bool(self.active_connections.get(user_id))

    async def send_to_local_sockets(self, user_id: str, data: dict):
        """
        Push a notification dict to ALL open tabs for this user on THIS process.
        Called by the pub/sub dispatch loop (not by routes directly).
        """
        sockets = list(self.active_connections.get(user_id, []))
        if not sockets:
            return  # User went offline between publish and dispatch — harmless

        dead = []
        for ws in sockets:
            try:
                await ws.send_json(data)
            except Exception as e:
                print(f"[WS] Dead socket for {user_id}: {e}")
                dead.append(ws)

        for ws in dead:
            self.disconnect(user_id, ws)


# Singleton instance used across the app
ws_manager = WSManager()
