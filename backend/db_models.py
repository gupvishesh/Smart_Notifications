"""
db_models.py — SQLAlchemy ORM table definitions.
Kept separate from Pydantic models.py so API schemas remain clean.
"""
from sqlalchemy import String, Boolean, Integer, Index
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class UserRow(Base):
    __tablename__ = "users"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)


class NotificationRow(Base):
    __tablename__ = "notifications"

    id:            Mapped[str]  = mapped_column(String,  primary_key=True)
    user_id:       Mapped[str]  = mapped_column(String,  nullable=False, index=True)
    type:          Mapped[str]  = mapped_column(String,  nullable=False)
    message:       Mapped[str]  = mapped_column(String,  nullable=False)
    timestamp:     Mapped[str]  = mapped_column(String,  nullable=False)
    read:          Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    grouped_count: Mapped[int]  = mapped_column(Integer, default=1,     nullable=False)
    priority:      Mapped[str]  = mapped_column(String,  default="normal", nullable=False)
    dismissed:     Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Replaces the separate in-memory missed_queue dict.
    # True = notification was generated while user was offline and not yet delivered.
    queued_missed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (
        # Composite index for the most common query: unread + non-dismissed per user
        Index("ix_notif_user_unread", "user_id", "read", "dismissed"),
    )
