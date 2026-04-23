"""
database.py — Async SQLAlchemy engine + session factory for SQLite.

Upgrade path to PostgreSQL:
  Change DATABASE_URL to "postgresql+asyncpg://user:pass@host/db"
  and swap aiosqlite for asyncpg in requirements.txt. Nothing else changes.
"""
import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./notifications.db")

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    # SQLite-specific: allow the same connection to be used across threads/tasks
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
)

AsyncSessionFactory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def init_db():
    """Create all tables on startup. Safe to call multiple times (idempotent)."""
    from db_models import NotificationRow, UserRow  # noqa: F401 — ensures models are registered
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[DB] Tables initialised on", DATABASE_URL)
