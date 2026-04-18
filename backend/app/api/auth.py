from fastapi import APIRouter, Depends, HTTPException, status, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.models.database import get_db, User
from app.models.models import UserResponse
from app.utils.logger import write_log
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import secrets
from jose import jwt
from passlib.context import CryptContext
import os
import secrets

router = APIRouter(prefix="/auth", tags=["Authentication"])
security = HTTPBearer()

SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_hex(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token tidak valid")
    except jwt.JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token tidak valid atau sudah expired")

    user = db.query(User).filter(User.user_id == int(user_id)).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User tidak ditemukan")
    return user


def require_admin(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akses ditolak: hanya Admin yang diizinkan"
        )
    return current_user


def require_staff(current_user: User = Depends(get_current_user)):
    if current_user.role != "staff":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akses ditolak: hanya Staf Rekam Medis yang diizinkan"
        )
    return current_user


def require_doctor(current_user: User = Depends(get_current_user)):
    if current_user.role != "doctor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akses ditolak: hanya Dokter yang diizinkan"
        )
    return current_user


def require_staff_or_doctor(current_user: User = Depends(get_current_user)):
    if current_user.role not in ("staff", "doctor"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akses ditolak: hanya Staf Rekam Medis atau Dokter yang diizinkan"
        )
    return current_user


@router.post("/login")
async def login(
    username: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.username == username).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username atau password salah"
        )

    if not verify_password(password, user.password_hash):
        write_log(db, user.user_id, f"ERROR|LOGIN_FAILED: username={username}, reason=wrong_password")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username atau password salah"
        )

    access_token = create_access_token(data={"sub": str(user.user_id), "role": user.role})

    write_log(db, user.user_id, f"LOGIN_SUCCESS: username={username}, role={user.role}")

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user.user_id,
        "username": user.username,
        "role": user.role,
        "full_name": user.full_name
    }


@router.post("/create-user")
async def create_user(
    username: str = Form(...),
    password: str = Form(...),
    full_name: str = Form(...),
    role: str = Form(...),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    if role not in ["admin", "staff", "doctor"]:
        write_log(db, current_user.user_id, f"ERROR|CREATE_USER_FAILED: invalid_role={role}")
        raise HTTPException(status_code=400, detail="Role tidak valid. Pilihan: admin, staff, doctor")

    existing = db.query(User).filter(User.username == username).first()
    if existing:
        write_log(db, current_user.user_id, f"ERROR|CREATE_USER_FAILED: username_duplicate={username}")
        raise HTTPException(status_code=400, detail="Username sudah digunakan")

    new_user = User(
        username=username,
        password_hash=hash_password(password),
        full_name=full_name,
        role=role
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    write_log(db, current_user.user_id, f"CREATE_USER: new_user_id={new_user.user_id}, username={username}, role={role}")

    return {"message": f"User {username} berhasil dibuat", "user_id": new_user.user_id}


@router.get("/users", response_model=List[UserResponse])
async def get_all_users(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    users = db.query(User).all()
    return users


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        write_log(db, current_user.user_id, f"ERROR|GET_USER_FAILED: target_user_id={user_id}, reason=not_found")
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    return user


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    username: Optional[str] = Form(None),
    full_name: Optional[str] = Form(None),
    role: Optional[str] = Form(None),
    password: Optional[str] = Form(None),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        write_log(db, current_user.user_id, f"ERROR|UPDATE_USER_FAILED: target_user_id={user_id}, reason=not_found")
        raise HTTPException(status_code=404, detail="User tidak ditemukan")

    changes = []

    if username:
        existing = db.query(User).filter(User.username == username).first()
        if existing and existing.user_id != user_id:
            write_log(db, current_user.user_id, f"ERROR|UPDATE_USER_FAILED: target_user_id={user_id}, reason=username_duplicate={username}")
            raise HTTPException(status_code=400, detail="Username sudah digunakan")
        changes.append(f"username={username}")
        user.username = username

    if full_name:
        changes.append(f"full_name={full_name}")
        user.full_name = full_name

    if role:
        if role not in ["admin", "staff", "doctor"]:
            write_log(db, current_user.user_id, f"ERROR|UPDATE_USER_FAILED: target_user_id={user_id}, reason=invalid_role={role}")
            raise HTTPException(status_code=400, detail="Role tidak valid. Pilihan: admin, staff, doctor")
        changes.append(f"role={role}")
        user.role = role

    if password:
        changes.append("password=[CHANGED]")
        user.password_hash = hash_password(password)

    if not changes:
        raise HTTPException(status_code=400, detail="Tidak ada data yang diubah")

    db.commit()
    write_log(db, current_user.user_id, f"UPDATE_USER: target_user_id={user_id}, changes=[{', '.join(changes)}]")

    return {"message": "User berhasil diperbarui"}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    if user_id == current_user.user_id:
        write_log(db, current_user.user_id, f"ERROR|DELETE_USER_FAILED: reason=cannot_delete_self")
        raise HTTPException(status_code=400, detail="Tidak dapat menghapus akun sendiri")

    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        write_log(db, current_user.user_id, f"ERROR|DELETE_USER_FAILED: target_user_id={user_id}, reason=not_found")
        raise HTTPException(status_code=404, detail="User tidak ditemukan")

    write_log(db, current_user.user_id, f"DELETE_USER: target_user_id={user_id}, username={user.username}, role={user.role}")

    db.delete(user)
    db.commit()

    return {"message": "User berhasil dihapus"}


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    return current_user