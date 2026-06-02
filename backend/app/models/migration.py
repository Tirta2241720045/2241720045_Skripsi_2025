from app.models.database import Base, SessionLocal
from app.models.database import User
from passlib.context import CryptContext
from sqlalchemy import inspect
import os

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def is_database_empty():
    db = SessionLocal()
    try:
        inspector = inspect(db.bind)
        tables = inspector.get_table_names()
        if not tables:
            return True
        user_count = db.query(User).count()
        return user_count == 0
    finally:
        db.close()

def run_migration():
    db = SessionLocal()
    try:
        if is_database_empty():
            users_data = [
                {"username": "admin", "password": "admin123", "full_name": "Administrator Sistem", "role": "admin"},
                {"username": "staff", "password": "staff123", "full_name": "Staff Rekam Medis", "role": "staff"},
                {"username": "doctor", "password": "doctor123", "full_name": "Dokter", "role": "doctor"}
            ]
            
            for user_data in users_data:
                existing_user = db.query(User).filter(User.username == user_data["username"]).first()
                if not existing_user:
                    new_user = User(
                        username=user_data["username"],
                        password_hash=hash_password(user_data["password"]),
                        full_name=user_data["full_name"],
                        role=user_data["role"]
                    )
                    db.add(new_user)
                    print(f"[MIGRATION] User created: {user_data['username']} ({user_data['role']})")
            
            db.commit()
            print("[MIGRATION] Database seeded successfully!")
        else:
            print("[MIGRATION] Database already has data, skipping seed")
    except Exception as e:
        print(f"[MIGRATION] Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    run_migration()