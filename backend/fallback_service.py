"""
fallback_service.py — Urgent notification escalation background loop.

Every 60 seconds, scans the DB for notifications that are:
  - priority = urgent
  - read = False  (user hasn't seen it)
  - queued_missed = True  (was never delivered via WebSocket)
  - older than 15 minutes

For each match, prints an [ESCALATE] event to the console.
In production, replace the print with a SendGrid / Twilio call.
"""
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from database import AsyncSessionFactory
from db_models import NotificationRow

POLL_INTERVAL_SECONDS = 60
ESCALATION_THRESHOLD  = timedelta(minutes=15)


async def _check_escalations():
    threshold_dt  = datetime.now(timezone.utc) - ESCALATION_THRESHOLD
    threshold_iso = threshold_dt.isoformat()

    async with AsyncSessionFactory() as session:
        result = await session.execute(
            select(NotificationRow).where(
                NotificationRow.priority     == "urgent",
                NotificationRow.read         == False,    # noqa: E712
                NotificationRow.queued_missed == True,    # noqa: E712
                NotificationRow.dismissed    == False,    # noqa: E712
                NotificationRow.timestamp    <= threshold_iso,
            )
        )
        stale = result.scalars().all()

    for n in stale:
        print(
            f"[ESCALATE] ⚠️  user={n.user_id} | id={n.id} | "
            f"age>{ESCALATION_THRESHOLD} | msg={n.message!r}"
        )
        # ── Production hook ──────────────────────────────────────────
        # await send_email(user_id=n.user_id, subject="Urgent notification", body=n.message)
        # await send_sms(user_id=n.user_id, body=n.message)
        # ─────────────────────────────────────────────────────────────

    if stale:
        print(f"[ESCALATE] {len(stale)} escalation(s) fired.")


async def start_loop():
    """Entry point — runs forever, called as a background asyncio task."""
    print(f"[Escalation] Loop started. Polling every {POLL_INTERVAL_SECONDS}s, threshold={ESCALATION_THRESHOLD}.")
    while True:
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        try:
            await _check_escalations()
        except Exception as e:
            # Never crash the loop — just log and keep going
            print(f"[Escalation] Error during check: {e}")
