from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime, date
from enum import Enum

class GenderEnum(str, Enum):
    M = 'M'
    F = 'F'

class RoleEnum(str, Enum):
    admin = 'admin'
    staff = 'staff'
    doctor = 'doctor'

class PatientBase(BaseModel):
    medical_record_no: str
    full_name: str
    date_of_birth: date
    gender: GenderEnum

class PatientCreate(PatientBase):
    pass

class PatientResponse(PatientBase):
    model_config = ConfigDict(from_attributes=True)
    patient_id: int
    registration_date: datetime

class MedicalRecordBase(BaseModel):
    patient_id: int
    medical_data_path: Optional[str] = None
    photo_path: Optional[str] = None
    mri_path: Optional[str] = None
    stego_photo_path: Optional[str] = None

class MedicalRecordCreate(MedicalRecordBase):
    pass

class MedicalRecordResponse(MedicalRecordBase):
    model_config = ConfigDict(from_attributes=True)
    record_id: int
    created_at: datetime

class UserBase(BaseModel):
    username: str
    full_name: str
    role: RoleEnum

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    model_config = ConfigDict(from_attributes=True)
    user_id: int

class SystemLogBase(BaseModel):
    user_id: Optional[int] = None
    action: str

class SystemLogCreate(SystemLogBase):
    pass

class SystemLogResponse(SystemLogBase):
    model_config = ConfigDict(from_attributes=True)
    log_id: int
    timestamp: datetime