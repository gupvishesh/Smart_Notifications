import uuid
from datetime import datetime, timezone
from typing import Dict, List
from models import Notification


class NotificationStore:
    def __init__(self):
        # user_id -> list of all notifications (including dismissed ones, filtered on read)
        self.notifications: Dict[str, List[Notification]] = {}
        # user_id -> list of missed (queued while offline) notifications
        self.missed_queue: Dict[str, List[Notification]] = {}

    def _ensure_user(self, user_id: str):
        if user_id not in self.notifications:
            self.notifications[user_id] = []
        if user_id not in self.missed_queue:
            self.missed_queue[user_id] = []

    def register_user(self, user_id: str):
        """Explicitly register a new user (creates empty inbox)."""
        self._ensure_user(user_id)

    def get_all_user_ids(self) -> List[str]:
        """Return all known user IDs."""
        return list(self.notifications.keys())

    def add_notification(
        self,
        user_id: str,
        notif_type: str,
        message: str,
        is_online: bool,
        priority: str = "normal",
    ) -> Notification:
        self._ensure_user(user_id)

        # --- Grouping logic ---
        # Look for an existing *unread*, *non-dismissed* notification of the same type.
        existing = None
        for n in self.notifications[user_id]:
            if n.type == notif_type and not n.read and not n.dismissed:
                existing = n
                break

        if existing:
            existing.grouped_count += 1
            existing.timestamp = datetime.now(timezone.utc).isoformat()
            # Escalate priority if new one is more urgent
            priority_rank = {"low": 0, "normal": 1, "urgent": 2}
            if priority_rank.get(priority, 1) > priority_rank.get(existing.priority, 1):
                existing.priority = priority
            notification = existing
            print(
                f"[Store] Grouped notification for {user_id} — type={notif_type}, count={existing.grouped_count}"
            )
        else:
            notification = Notification(
                id=str(uuid.uuid4()),
                user_id=user_id,
                type=notif_type,
                message=message,
                timestamp=datetime.now(timezone.utc).isoformat(),
                read=False,
                grouped_count=1,
                priority=priority,
                dismissed=False,
            )
            self.notifications[user_id].append(notification)
            print(f"[Store] New notification for {user_id} — type={notif_type}, priority={priority}")

        # --- Offline queue ---
        if not is_online:
            queued_ids = {n.id for n in self.missed_queue[user_id]}
            if notification.id not in queued_ids:
                self.missed_queue[user_id].append(notification)
            print(f"[Store] Queued missed notification for {user_id}")

        return notification

    def get_notifications(self, user_id: str) -> List[Notification]:
        """Return active (non-dismissed) notifications, newest first."""
        self._ensure_user(user_id)
        return [n for n in reversed(self.notifications[user_id]) if not n.dismissed]

    def mark_as_read(self, notification_id: str) -> Notification | None:
        for user_notifications in self.notifications.values():
            for n in user_notifications:
                if n.id == notification_id:
                    n.read = True
                    print(f"[Store] Marked {notification_id} as read")
                    return n
        return None

    def mark_all_read(self, user_id: str) -> int:
        """Mark all non-dismissed notifications as read. Returns count updated."""
        self._ensure_user(user_id)
        count = 0
        for n in self.notifications[user_id]:
            if not n.read and not n.dismissed:
                n.read = True
                count += 1
        print(f"[Store] Marked all {count} notifications as read for {user_id}")
        return count

    def dismiss_notification(self, notification_id: str) -> Notification | None:
        """Soft-delete a notification (sets dismissed=True)."""
        for user_notifications in self.notifications.values():
            for n in user_notifications:
                if n.id == notification_id:
                    n.dismissed = True
                    # Remove from missed queue too if present
                    for user_id, queue in self.missed_queue.items():
                        self.missed_queue[user_id] = [
                            q for q in queue if q.id != notification_id
                        ]
                    print(f"[Store] Dismissed {notification_id}")
                    return n
        return None

    def flush_missed(self, user_id: str) -> List[Notification]:
        """Return and clear the missed queue for a user."""
        self._ensure_user(user_id)
        # Only flush non-dismissed ones
        queued = [n for n in self.missed_queue[user_id] if not n.dismissed]
        self.missed_queue[user_id] = []
        print(f"[Store] Flushed {len(queued)} missed notifications for {user_id}")
        return queued


# Singleton instance used across the app
notification_store = NotificationStore()
