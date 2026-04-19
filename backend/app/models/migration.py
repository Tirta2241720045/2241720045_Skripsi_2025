from app.models.database import engine, Base, SessionLocal
from app.models.database import User
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

Base.metadata.create_all(bind=engine)

db = SessionLocal()

users_data = [
    {"username": "admin_test", "password": "admin123", "full_name": "Admin User", "role": "admin"},
    {"username": "staff_test", "password": "staff123", "full_name": "Staff User", "role": "staff"},
    {"username": "doctor_test", "password": "doctor123", "full_name": "Doctor User", "role": "doctor"}
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

db.commit()
db.close()

print("Database migration completed! Users created.")