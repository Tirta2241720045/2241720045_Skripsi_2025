from sqlalchemy.orm import Session
from app.models.database import SystemLog
from typing import Optional


def write_log(db: Session, user_id: Optional[int], action: str) -> None:
    try:
        db.add(SystemLog(user_id=user_id, action=action))
        db.commit()
    except Exception:
        db.rollback()