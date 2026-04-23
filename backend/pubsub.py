"""
pubsub.py — In-process Pub/Sub broker using asyncio.Queue.

Architecture mirrors Redis Pub/Sub:
  publisher  → broker.publish(user_id, payload)
  subscriber ← broker.subscribe(user_id) returns asyncio.Queue

Upgrade path to Redis:
  Replace PubSubBroker with an aioredis-backed implementation.
  The publish/subscribe interface is identical — nothing else in the
  codebase needs to change.
"""
import asyncio
from typing import Dict


class PubSubBroker:
    def __init__(self):
        # user_id → asyncio.Queue of notification dicts
        self._queues: Dict[str, asyncio.Queue] = {}

    def _get_queue(self, user_id: str) -> asyncio.Queue:
        if user_id not in self._queues:
            self._queues[user_id] = asyncio.Queue()
        return self._queues[user_id]

    async def publish(self, user_id: str, data: dict):
        """Put a notification payload onto the user's queue."""
        queue = self._get_queue(user_id)
        await queue.put(data)
        print(f"[PubSub] Published to {user_id} — queue depth: {queue.qsize()}")

    def subscribe(self, user_id: str) -> asyncio.Queue:
        """Return (and create if needed) the queue for this user."""
        return self._get_queue(user_id)

    async def dispatch_loop(self, user_id: str, ws_manager):
        """
        Background coroutine: drain the queue for user_id and deliver
        payloads to their active WebSocket connections.

        Runs forever; started once per connected user.
        """
        queue = self._get_queue(user_id)
        while True:
            data = await queue.get()
            await ws_manager.send_to_local_sockets(user_id, data)
            queue.task_done()


# Singleton — one per process
broker = PubSubBroker()
