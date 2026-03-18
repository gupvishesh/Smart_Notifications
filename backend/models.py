from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class NotificationRequest(BaseModel):
    user_id: str          # the sender / triggering user
    target_user_id: str   # the actual recipient
    type: str             # "assignment_update" | "message" | "grade_posted"
    message: str
    priority: str = "normal"   # "low" | "normal" | "urgent"


class Notification(BaseModel):
    id: str
    user_id: str
    type: str
    message: str
    timestamp: str
    read: bool = False
    grouped_count: int = 1
    priority: str = "normal"   # "low" | "normal" | "urgent"
    dismissed: bool = False    # soft-delete flag


class UserCreate(BaseModel):
    user_id: str
