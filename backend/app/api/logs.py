from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.models.database import get_db, SystemLog, User
from app.models.models import SystemLogResponse
from app.api.auth import require_admin, get_current_user
from typing import List, Optional
from datetime import date

router = APIRouter(prefix="/logs", tags=["System Logs"])


@router.get("/", response_model=List[SystemLogResponse])
async def get_all_logs(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
    user_id: Optional[int] = Query(None, description="Filter berdasarkan user_id"),
    start_date: Optional[date] = Query(None, description="Filter dari tanggal (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="Filter sampai tanggal (YYYY-MM-DD)"),
    action_keyword: Optional[str] = Query(None, description="Filter berdasarkan kata kunci aksi"),
    limit: int = Query(200, ge=1, le=1000, description="Maks jumlah log yang dikembalikan"),
):
    query = db.query(SystemLog)

    if user_id is not None:
        query = query.filter(SystemLog.user_id == user_id)

    if start_date:
        query = query.filter(SystemLog.timestamp >= start_date)

    if end_date:
        from datetime import datetime, time as dtime
        end_dt = datetime.combine(end_date, dtime.max)
        query = query.filter(SystemLog.timestamp <= end_dt)

    if action_keyword:
        query = query.filter(SystemLog.action.ilike(f"%{action_keyword}%"))

    logs = query.order_by(SystemLog.timestamp.desc()).limit(limit).all()
    return logs


@router.get("/user/{user_id}", response_model=List[SystemLogResponse])
async def get_logs_by_user(
    user_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
):
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")

    logs = (
        db.query(SystemLog)
        .filter(SystemLog.user_id == user_id)
        .order_by(SystemLog.timestamp.desc())
        .limit(limit)
        .all()
    )
    return logs


@router.delete("/cleanup")
async def cleanup_old_logs(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
    older_than_days: int = Query(90, ge=7, description="Hapus log lebih lama dari N hari"),
):
    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(days=older_than_days)
    deleted = db.query(SystemLog).filter(SystemLog.timestamp < cutoff).delete()
    db.commit()

    from app.utils.logger import write_log
    write_log(db, current_user.user_id, f"CLEANUP_LOGS: deleted={deleted}, older_than_days={older_than_days}")

    return {"message": f"{deleted} log berhasil dihapus", "cutoff_date": cutoff.isoformat()}