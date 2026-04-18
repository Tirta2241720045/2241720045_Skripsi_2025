from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.models.database import get_db, Patient, MedicalRecord, ImageQualityMetric, User
from app.utils.logger import write_log
from app.api.auth import require_staff, require_staff_or_doctor
from pydantic import BaseModel, ConfigDict, field_serializer
from typing import Optional, List
from datetime import date, datetime
import os

router = APIRouter(prefix="/patients", tags=["Patients"])


class PatientCreate(BaseModel):
    medical_record_no: str
    full_name: str
    date_of_birth: str
    gender: str


class PatientUpdate(BaseModel):
    full_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None


class PatientResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    patient_id: int
    medical_record_no: str
    full_name: str
    date_of_birth: date
    gender: str
    registration_date: Optional[datetime] = None

    @field_serializer('date_of_birth')
    def serialize_date_of_birth(self, value: date) -> str:
        return value.isoformat() if value else None

    @field_serializer('registration_date')
    def serialize_registration_date(self, value: datetime) -> str:
        return value.isoformat() if value else None


def _normalize_path(path: str) -> str:
    if not path:
        return path
    return path.replace('\\', '/')


def _denormalize_path(path: str) -> str:
    if not path:
        return path
    return os.path.normpath(path)


def _safe_delete(*paths: str) -> None:
    for p in paths:
        try:
            if p and os.path.exists(p):
                os.unlink(p)
        except OSError:
            pass


def _delete_patient_files(patient_id: int, db: Session) -> dict:
    deleted = {
        "original": [],
        "embedding": [],
        "extraction": [],
        "total": 0
    }

    records = db.query(MedicalRecord).filter(
        MedicalRecord.patient_id == patient_id
    ).all()

    if not records:
        return deleted

    for record in records:
        if record.medical_data_path:
            path = _denormalize_path(record.medical_data_path)
            if os.path.exists(path):
                _safe_delete(path)
                deleted["original"].append(path)

        if record.photo_path:
            path = _denormalize_path(record.photo_path)
            if os.path.exists(path):
                _safe_delete(path)
                deleted["original"].append(path)

        if record.mri_path:
            path = _denormalize_path(record.mri_path)
            if os.path.exists(path):
                _safe_delete(path)
                deleted["original"].append(path)

        if record.stego_photo_path:
            path = _denormalize_path(record.stego_photo_path)
            if os.path.exists(path):
                _safe_delete(path)
                deleted["embedding"].append(path)

        extraction_patterns = [
            f"mri_{patient_id}_{record.record_id}",
            f"photo_{patient_id}_{record.record_id}",
            f"medical_{patient_id}_{record.record_id}"
        ]

        extraction_dir = os.path.join("files", "extraction")
        if os.path.exists(extraction_dir):
            for filename in os.listdir(extraction_dir):
                for pattern in extraction_patterns:
                    if filename.startswith(pattern):
                        filepath = os.path.join(extraction_dir, filename)
                        _safe_delete(filepath)
                        deleted["extraction"].append(filepath)

    deleted["total"] = (
        len(deleted["original"]) +
        len(deleted["embedding"]) +
        len(deleted["extraction"])
    )

    return deleted


@router.get("/", response_model=List[PatientResponse])
async def get_all_patients(
    current_user: User = Depends(require_staff_or_doctor),
    db: Session = Depends(get_db)
):
    patients = db.query(Patient).order_by(Patient.patient_id.desc()).all()
    return patients


@router.get("/{patient_id}", response_model=PatientResponse)
async def get_patient(
    patient_id: int,
    current_user: User = Depends(require_staff_or_doctor),
    db: Session = Depends(get_db)
):
    patient = db.query(Patient).filter(Patient.patient_id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Pasien tidak ditemukan")
    return patient


@router.post("/", response_model=PatientResponse, status_code=status.HTTP_201_CREATED)
async def create_patient(
    patient_data: PatientCreate,
    current_user: User = Depends(require_staff),
    db: Session = Depends(get_db)
):
    existing = db.query(Patient).filter(
        Patient.medical_record_no == patient_data.medical_record_no
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Nomor rekam medis sudah digunakan")

    new_patient = Patient(
        medical_record_no=patient_data.medical_record_no,
        full_name=patient_data.full_name,
        date_of_birth=patient_data.date_of_birth,
        gender=patient_data.gender
    )

    db.add(new_patient)
    db.commit()
    db.refresh(new_patient)

    write_log(db, current_user.user_id,
              f"CREATE_PATIENT: patient_id={new_patient.patient_id}, "
              f"mr_no={new_patient.medical_record_no}, staff={current_user.username}")

    return new_patient


@router.put("/{patient_id}", response_model=PatientResponse)
async def update_patient(
    patient_id: int,
    patient_data: PatientUpdate,
    current_user: User = Depends(require_staff),
    db: Session = Depends(get_db)
):
    patient = db.query(Patient).filter(Patient.patient_id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Pasien tidak ditemukan")

    if patient_data.full_name is not None:
        patient.full_name = patient_data.full_name
    if patient_data.date_of_birth is not None:
        patient.date_of_birth = patient_data.date_of_birth
    if patient_data.gender is not None:
        patient.gender = patient_data.gender

    db.commit()
    db.refresh(patient)

    write_log(db, current_user.user_id,
              f"UPDATE_PATIENT: patient_id={patient_id}, staff={current_user.username}")

    return patient


@router.delete("/{patient_id}", status_code=status.HTTP_200_OK)
async def delete_patient(
    patient_id: int,
    current_user: User = Depends(require_staff),
    db: Session = Depends(get_db)
):
    patient = db.query(Patient).filter(Patient.patient_id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Pasien tidak ditemukan")

    patient_name = patient.full_name
    patient_mr   = patient.medical_record_no

    deleted_files = _delete_patient_files(patient_id, db)

    records    = db.query(MedicalRecord).filter(MedicalRecord.patient_id == patient_id).all()
    record_ids = [r.record_id for r in records]

    if record_ids:
        db.query(ImageQualityMetric).filter(
            ImageQualityMetric.record_id.in_(record_ids)
        ).delete(synchronize_session=False)

    db.query(MedicalRecord).filter(
        MedicalRecord.patient_id == patient_id
    ).delete(synchronize_session=False)

    db.delete(patient)
    db.commit()

    write_log(db, current_user.user_id,
              f"DELETE_PATIENT: patient_id={patient_id}, mr_no={patient_mr}, "
              f"name={patient_name}, staff={current_user.username}, "
              f"files_deleted={deleted_files['total']}")

    return {
        "message": f"Pasien {patient_name} ({patient_mr}) berhasil dihapus",
        "patient_id": patient_id,
        "medical_records_deleted": len(records),
        "files_deleted": deleted_files
    }