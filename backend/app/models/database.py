from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Date, Enum, ForeignKey, Float
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:polinema@localhost/stegoshield_db")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_indonesia_time():
    return datetime.now(ZoneInfo("Asia/Jakarta"))

class Patient(Base):
    __tablename__ = "patients"
    patient_id = Column(Integer, primary_key=True, index=True)
    medical_record_no = Column(String(20))
    full_name = Column(String(100))
    date_of_birth = Column(Date)
    gender = Column(Enum('M', 'F', name='gender_enum'))
    registration_date = Column(DateTime, default=get_indonesia_time)
    medical_records = relationship("MedicalRecord", back_populates="patient")

class MedicalRecord(Base):
    __tablename__ = "medical_records"
    record_id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey('patients.patient_id'))
    medical_data_path = Column(Text)
    photo_path = Column(String(255))
    mri_path = Column(String(255))
    stego_photo_path = Column(String(255))
    created_at = Column(DateTime, default=get_indonesia_time)
    patient = relationship("Patient", back_populates="medical_records")
    quality_metrics = relationship("ImageQualityMetric", back_populates="medical_record")

class ImageQualityMetric(Base):
    __tablename__ = "image_quality_metrics"
    metric_id = Column(Integer, primary_key=True, index=True)
    record_id = Column(Integer, ForeignKey('medical_records.record_id'))
    layer1_mse  = Column(Float, nullable=True)
    layer1_psnr = Column(Float, nullable=True)
    layer1_ssim = Column(Float, nullable=True)
    layer2_mse  = Column(Float, nullable=True)
    layer2_psnr = Column(Float, nullable=True)
    layer2_ssim = Column(Float, nullable=True)
    created_at = Column(DateTime, default=get_indonesia_time)
    medical_record = relationship("MedicalRecord", back_populates="quality_metrics")

class User(Base):
    __tablename__ = "users"
    user_id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True)
    password_hash = Column(String(255))
    full_name = Column(String(100))
    role = Column(Enum('admin', 'staff', 'doctor', name='role_enum'))
    system_logs = relationship("SystemLog", back_populates="user")

class SystemLog(Base):
    __tablename__ = "system_logs"
    log_id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.user_id', ondelete="SET NULL"), nullable=True)
    action = Column(Text)
    timestamp = Column(DateTime, default=get_indonesia_time)
    user = relationship("User", back_populates="system_logs")

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()