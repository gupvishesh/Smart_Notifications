"""
notification_store.py — Async DB-backed notification store.

All methods are async and use SQLAlchemy sessions against SQLite
(upgradeable to PostgreSQL by changing DATABASE_URL — nothing else changes).
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select, update

from database import AsyncSessionFactory
from db_models import NotificationRow, UserRow
from models import Notification


def _row_to_model(row: NotificationRow) -> Notification:
    """Convert an ORM row to the Pydantic API model."""
    return Notification(
        id=row.id,
        user_id=row.user_id,
        type=row.type,
        message=row.message,
        timestamp=row.timestamp,
        read=row.read,
        grouped_count=row.grouped_count,
        priority=row.priority,
        dismissed=row.dismissed,
    )


class NotificationStore:
    # ── User management ────────────────────────────────────────────────────

    async def register_user(self, user_id: str):
        """Insert user if not already present (idempotent)."""
        async with AsyncSessionFactory() as session:
            existing = await session.get(UserRow, user_id)
            if not existing:
                session.add(UserRow(user_id=user_id))
                await session.commit()

    async def get_all_user_ids(self) -> List[str]:
        async with AsyncSessionFactory() as session:
            result = await session.execute(select(UserRow.user_id))
            return [row for row in result.scalars()]

    # ── Core notification logic ────────────────────────────────────────────

    async def add_notification(
        self,
        user_id: str,
        notif_type: str,
        message: str,
        is_online: bool,
        priority: str = "normal",
    ) -> Notification:
        await self.register_user(user_id)

        async with AsyncSessionFactory() as session:
            # ── Grouping: find existing unread, non-dismissed, same type ──
            result = await session.execute(
                select(NotificationRow).where(
                    NotificationRow.user_id   == user_id,
                    NotificationRow.type      == notif_type,
                    NotificationRow.read      == False,    # noqa: E712
                    NotificationRow.dismissed == False,    # noqa: E712
                ).limit(1)
            )
            existing: Optional[NotificationRow] = result.scalar_one_or_none()

            if existing:
                existing.grouped_count += 1
                existing.timestamp = datetime.now(timezone.utc).isoformat()

                # Escalate priority if new event is more urgent
                priority_rank = {"low": 0, "normal": 1, "urgent": 2}
                if priority_rank.get(priority, 1) > priority_rank.get(existing.priority, 1):
                    existing.priority = priority

                # If user is offline, ensure it is marked for missed queue
                if not is_online:
                    existing.queued_missed = True

                await session.commit()
                await session.refresh(existing)
                row = existing
                print(f"[Store] Grouped {user_id} type={notif_type} count={row.grouped_count}")
            else:
                row = NotificationRow(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    type=notif_type,
                    message=message,
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    read=False,
                    grouped_count=1,
                    priority=priority,
                    dismissed=False,
                    queued_missed=not is_online,
                )
                session.add(row)
                await session.commit()
                await session.refresh(row)
                print(f"[Store] New notification for {user_id} type={notif_type} priority={priority}")

            return _row_to_model(row)

    async def get_notifications(self, user_id: str) -> List[Notification]:
        """Return active (non-dismissed) notifications newest-first."""
        async with AsyncSessionFactory() as session:
            result = await session.execute(
                select(NotificationRow)
                .where(
                    NotificationRow.user_id   == user_id,
                    NotificationRow.dismissed == False,  # noqa: E712
                )
                .order_by(NotificationRow.timestamp.desc())
            )
            return [_row_to_model(r) for r in result.scalars()]

    async def mark_as_read(self, notification_id: str) -> Optional[Notification]:
        async with AsyncSessionFactory() as session:
            row = await session.get(NotificationRow, notification_id)
            if not row:
                return None
            row.read = True
            await session.commit()
            await session.refresh(row)
            print(f"[Store] Marked {notification_id} as read")
            return _row_to_model(row)

    async def mark_all_read(self, user_id: str) -> int:
        async with AsyncSessionFactory() as session:
            result = await session.execute(
                update(NotificationRow)
                .where(
                    NotificationRow.user_id   == user_id,
                    NotificationRow.read      == False,   # noqa: E712
                    NotificationRow.dismissed == False,   # noqa: E712
                )
                .values(read=True)
            )
            await session.commit()
            count = result.rowcount
            print(f"[Store] Marked all {count} notifications read for {user_id}")
            return count

    async def dismiss_notification(self, notification_id: str) -> Optional[Notification]:
        async with AsyncSessionFactory() as session:
            row = await session.get(NotificationRow, notification_id)
            if not row:
                return None
            row.dismissed = True
            row.queued_missed = False  # remove from escalation candidates
            await session.commit()
            await session.refresh(row)
            print(f"[Store] Dismissed {notification_id}")
            return _row_to_model(row)

    async def flush_missed(self, user_id: str) -> List[Notification]:
        """Return all queued-missed notifications and mark them as delivered."""
        async with AsyncSessionFactory() as session:
            result = await session.execute(
                select(NotificationRow).where(
                    NotificationRow.user_id      == user_id,
                    NotificationRow.queued_missed == True,   # noqa: E712
                    NotificationRow.dismissed    == False,   # noqa: E712
                )
            )
            rows = result.scalars().all()

            # Clear the missed flag — they are about to be delivered
            for row in rows:
                row.queued_missed = False
            await session.commit()

            print(f"[Store] Flushed {len(rows)} missed notifications for {user_id}")
            return [_row_to_model(r) for r in rows]


# Singleton instance used across the app
notification_store = NotificationStore()
