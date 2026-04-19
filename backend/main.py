from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api import auth, medical, patients, logs
import os

app = FastAPI(title="StegoShield API", version="1.0.0")

REQUIRED_DIRS = [
    "files",
    "files/original",
    "files/embedding",
    "files/extraction",
    "static"
]

for directory in REQUIRED_DIRS:
    os.makedirs(directory, exist_ok=True)

app.mount("/files", StaticFiles(directory="files"), name="files")
app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(medical.router)
app.include_router(patients.router)
app.include_router(logs.router)

@app.get("/")
async def root():
    return {"message": "StegoShield API - Medical Data Protection System", "status": "online"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)