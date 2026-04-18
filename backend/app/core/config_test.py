import os

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql://postgres:polinema@localhost:5432/stegoshield_test"
)

SECRET_KEY = "SECRET_KEY_STEGOSHIELD_2026"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30