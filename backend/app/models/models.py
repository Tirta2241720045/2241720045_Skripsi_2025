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

class ImageQualityMetricBase(BaseModel):
    record_id: int
    layer1_mse: Optional[float] = None
    layer1_psnr: Optional[float] = None
    layer1_ssim: Optional[float] = None
    layer1_brisque: Optional[float] = None
    layer1_niqe: Optional[float] = None
    layer1_piqe: Optional[float] = None
    layer2_mse: Optional[float] = None
    layer2_psnr: Optional[float] = None
    layer2_ssim: Optional[float] = None
    layer2_brisque: Optional[float] = None
    layer2_niqe: Optional[float] = None
    layer2_piqe: Optional[float] = None
    # --- AccTxt fields ---
    acc_txt: Optional[float] = None
    acc_txt_D: Optional[int] = None
    acc_txt_T: Optional[int] = None
    acc_txt_errors: Optional[int] = None

class ImageQualityMetricCreate(ImageQualityMetricBase):
    pass

class ImageQualityMetricResponse(ImageQualityMetricBase):
    model_config = ConfigDict(from_attributes=True)
    metric_id: int
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