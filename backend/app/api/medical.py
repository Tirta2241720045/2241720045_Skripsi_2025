from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from sqlalchemy.orm import Session
from app.models.database import get_db, MedicalRecord, Patient, ImageQualityMetric, User
from app.utils.logger import write_log
from app.api.auth import require_staff, require_doctor, require_staff_or_doctor
import os
import time
from app.core.aes_handler import AESHandler
from app.core.lsb_handler import LSBHandler
from PIL import Image
import io
from typing import Optional, Tuple

router = APIRouter(prefix="/medical", tags=["Medical"])

AES_KEY = os.getenv("AES_KEY", "SECRET_KEY_STEGOSHIELD_2026")
aes_handler = AESHandler(AES_KEY)

DIR_ORIGINAL = os.path.join("files", "original")
DIR_EMBEDDING = os.path.join("files", "embedding")
DIR_EXTRACT = os.path.join("files", "extraction")

for d in [DIR_ORIGINAL, DIR_EMBEDDING, DIR_EXTRACT]:
    os.makedirs(d, exist_ok=True)


def _normalize_path(path: str) -> str:
    return path.replace('\\', '/') if path else path


def _denormalize_path(path: str) -> str:
    return os.path.normpath(path) if path else path


def _safe_delete(*paths: str) -> None:
    for p in paths:
        try:
            if p and os.path.exists(p):
                os.unlink(p)
        except OSError:
            pass


def _file_size_kb(path: str) -> float:
    try:
        return round(os.path.getsize(path) / 1024, 2) if path and os.path.exists(path) else 0.0
    except OSError:
        return 0.0


def _parse_timestamp_from_stego(stego_photo_path: str) -> Optional[str]:
    try:
        basename = os.path.splitext(os.path.basename(stego_photo_path))[0]
        parts = basename.split('_', 2)
        return parts[2] if len(parts) == 3 else None
    except Exception:
        return None


def _get_original_paths(patient_id: int, stego_photo_path: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    timestamp = _parse_timestamp_from_stego(stego_photo_path)
    if not timestamp:
        return None, None, None
    prefix = f"{patient_id}_{timestamp}"
    return (
        os.path.join(DIR_ORIGINAL, f"photo_{prefix}.png"),
        os.path.join(DIR_ORIGINAL, f"mri_{prefix}.png"),
        os.path.join(DIR_ORIGINAL, f"medical_{prefix}.txt"),
    )


@router.post("/upload")
async def upload_medical_data(
    patient_id: int = Form(...),
    medical_data: UploadFile = File(...),
    mri_image: UploadFile = File(...),
    patient_photo: UploadFile = File(...),
    current_user: User = Depends(require_staff),
    db: Session = Depends(get_db)
):
    patient = db.query(Patient).filter(Patient.patient_id == patient_id).first()
    if not patient:
        write_log(db, current_user.user_id,
                  f"ERROR|UPLOAD_MEDICAL_FAILED: patient_id={patient_id}, reason=patient_not_found")
        raise HTTPException(status_code=404, detail="Pasien tidak ditemukan")

    existing_count = db.query(MedicalRecord).filter(
        MedicalRecord.patient_id == patient_id
    ).count()
    if existing_count >= 10:
        write_log(db, current_user.user_id,
                  f"ERROR|UPLOAD_MEDICAL_FAILED: patient_id={patient_id}, reason=max_records_reached")
        raise HTTPException(status_code=400, detail="Maksimal 10 rekam medis per pasien telah tercapai")

    mri_bytes = await mri_image.read()
    photo_bytes = await patient_photo.read()
    txt_bytes = await medical_data.read()
    txt_content = txt_bytes.decode("utf-8")

    timestamp = int(time.time() * 1000)
    prefix = f"{patient_id}_{timestamp}"

    orig_photo = os.path.join(DIR_ORIGINAL, f"photo_{prefix}.png")
    orig_mri = os.path.join(DIR_ORIGINAL, f"mri_{prefix}.png")
    orig_txt = os.path.join(DIR_ORIGINAL, f"medical_{prefix}.txt")
    mri_gray_path = os.path.join(DIR_ORIGINAL, f"mri_gray_{prefix}.png")
    layer1_path = os.path.join(DIR_ORIGINAL, f"mri_stego_{prefix}.png")
    stego_out_path = os.path.join(DIR_EMBEDDING, f"stego_{prefix}.png")

    try:
        img_photo = Image.open(io.BytesIO(photo_bytes))
        if img_photo.mode != 'RGB':
            img_photo = img_photo.convert('RGB')
        img_photo.save(orig_photo, format='PNG', compress_level=0)

        img_mri = Image.open(io.BytesIO(mri_bytes))
        if img_mri.mode != 'L':
            img_mri = img_mri.convert('L')
        img_mri.save(orig_mri, format='PNG', compress_level=0)

        with open(orig_txt, "w", encoding="utf-8") as f:
            f.write(txt_content)

        encrypted = aes_handler.encrypt(txt_content)
        data_to_embed = f"{encrypted['ciphertext']}::{encrypted['iv']}".encode()
        data_size = len(data_to_embed)

        mri_w, mri_h = img_mri.size
        roni_capacity_bits = LSBHandler.get_roni_capacity(mri_h, mri_w)
        roni_capacity_bytes = (roni_capacity_bits // 8) - 4

        if data_size > roni_capacity_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"Data terlalu besar untuk area RONI MRI. Kapasitas: {roni_capacity_bytes} bytes."
            )

        img_mri.save(mri_gray_path, format='PNG', compress_level=0)

        t1 = time.time()
        LSBHandler.embed_to_grayscale(mri_gray_path, data_to_embed, layer1_path)
        time_layer1 = round(time.time() - t1, 4)

        photo_w, photo_h = img_photo.size
        mri_stego_size = os.path.getsize(layer1_path)
        rgb_capacity_bytes = (photo_h * photo_w * 3 // 8) - 4

        if mri_stego_size > rgb_capacity_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"MRI stego terlalu besar untuk foto pasien. Kapasitas: {rgb_capacity_bytes} bytes."
            )

        t2 = time.time()
        LSBHandler.embed_to_rgb(orig_photo, layer1_path, stego_out_path)
        time_layer2 = round(time.time() - t2, 4)

        stego_img = Image.open(stego_out_path)
        if stego_img.mode != 'RGB':
            stego_img = stego_img.convert('RGB')
        stego_img.save(stego_out_path, format='PNG', compress_level=0)

        metrics_l1 = LSBHandler.calculate_metrics(mri_gray_path, layer1_path, mode='L')
        metrics_l2 = LSBHandler.calculate_metrics(orig_photo, stego_out_path, mode='RGB')

        file_sizes = {
            "original_txt_kb": _file_size_kb(orig_txt),
            "original_mri_kb": _file_size_kb(orig_mri),
            "original_photo_kb": _file_size_kb(orig_photo),
            "stego_kb": _file_size_kb(stego_out_path),
        }

        db_record = MedicalRecord(
            patient_id=patient_id,
            medical_data_path=_normalize_path(orig_txt),
            photo_path=_normalize_path(orig_photo),
            mri_path=_normalize_path(orig_mri),
            stego_photo_path=_normalize_path(stego_out_path),
        )
        db.add(db_record)
        db.commit()
        db.refresh(db_record)

        quality_embed = ImageQualityMetric(
            record_id=db_record.record_id,
            layer1_mse=metrics_l1['mse'],
            layer1_psnr=metrics_l1['psnr'],
            layer1_ssim=metrics_l1['ssim'],
            layer2_mse=metrics_l2['mse'],
            layer2_psnr=metrics_l2['psnr'],
            layer2_ssim=metrics_l2['ssim'],
        )
        db.add(quality_embed)
        db.commit()

        write_log(db, current_user.user_id,
                  f"UPLOAD_MEDICAL: patient_id={patient_id}, record_id={db_record.record_id}")

        return {
            "message": "Data berhasil diproses",
            "record_id": db_record.record_id,
            "stego_image": _normalize_path(stego_out_path),
            "embed_time": {
                "layer1_seconds": time_layer1,
                "layer2_seconds": time_layer2,
                "total_seconds": round(time_layer1 + time_layer2, 4),
            },
            "quality_metrics": {
                "layer1_mri_stego": metrics_l1,
                "layer2_photo_stego": metrics_l2,
            },
            "capacity_info": {
                "data_size_bytes": data_size,
                "roni_capacity_bytes": roni_capacity_bytes,
                "mri_stego_size_bytes": mri_stego_size,
                "photo_capacity_bytes": rgb_capacity_bytes,
            },
            "file_sizes": file_sizes,
        }

    except HTTPException:
        raise
    except Exception as e:
        write_log(db, current_user.user_id, f"ERROR|UPLOAD_MEDICAL_UNEXPECTED: {e}")
        raise HTTPException(status_code=500, detail=f"Terjadi kesalahan: {str(e)}")
    finally:
        _safe_delete(mri_gray_path, layer1_path)


@router.get("/patient/{patient_id}")
async def get_medical_records_by_patient(
    patient_id: int,
    current_user: User = Depends(require_staff_or_doctor),
    db: Session = Depends(get_db)
):
    patient = db.query(Patient).filter(Patient.patient_id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Pasien tidak ditemukan")

    records = db.query(MedicalRecord).filter(
        MedicalRecord.patient_id == patient_id
    ).order_by(MedicalRecord.record_id.desc()).all()

    result = []
    for record in records:
        all_metrics = db.query(ImageQualityMetric).filter(
            ImageQualityMetric.record_id == record.record_id
        ).order_by(ImageQualityMetric.metric_id.asc()).all()

        embed_m = all_metrics[0] if len(all_metrics) > 0 else None
        extract_m = all_metrics[1] if len(all_metrics) > 1 else None

        def _fmt(m):
            if not m:
                return None
            return {
                "layer1_mri_stego": {"mse": m.layer1_mse, "psnr": m.layer1_psnr, "ssim": m.layer1_ssim},
                "layer2_photo_stego": {"mse": m.layer2_mse, "psnr": m.layer2_psnr, "ssim": m.layer2_ssim},
            }

        orig_photo_path, orig_mri_path, orig_txt_path = _get_original_paths(
            record.patient_id, record.stego_photo_path
        )

        file_sizes = {
            "original_txt_kb": _file_size_kb(orig_txt_path) if orig_txt_path else 0.0,
            "original_mri_kb": _file_size_kb(orig_mri_path) if orig_mri_path else 0.0,
            "original_photo_kb": _file_size_kb(orig_photo_path) if orig_photo_path else 0.0,
            "stego_kb": _file_size_kb(_denormalize_path(record.stego_photo_path)),
        }

        result.append({
            "record_id": record.record_id,
            "medical_data_path": record.medical_data_path,
            "photo_path": record.photo_path,
            "mri_path": record.mri_path,
            "stego_photo_path": record.stego_photo_path,
            "upload_date": record.created_at.isoformat() if record.created_at else None,
            "quality_metrics": {
                "embedding": _fmt(embed_m),
                "extraction": _fmt(extract_m),
            },
            "file_sizes": file_sizes,
        })

    return {
        "patient_id": patient_id,
        "patient_name": patient.full_name,
        "total_records": len(records),
        "records": result,
    }


@router.get("/extract/{record_id}")
async def extract_medical_data(
    record_id: int,
    current_user: User = Depends(require_doctor),
    db: Session = Depends(get_db)
):
    record = db.query(MedicalRecord).filter(MedicalRecord.record_id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Rekam medis tidak ditemukan")

    stego_path = _denormalize_path(record.stego_photo_path)
    if not os.path.exists(stego_path):
        raise HTTPException(status_code=404, detail="File stego tidak ditemukan")

    patient = db.query(Patient).filter(Patient.patient_id == record.patient_id).first()

    orig_photo_path, orig_mri_path, _ = _get_original_paths(
        record.patient_id, record.stego_photo_path
    )

    prefix = f"{record.patient_id}_{record_id}"
    ext_mri_path = os.path.join(DIR_EXTRACT, f"mri_{prefix}.png")
    ext_photo_path = os.path.join(DIR_EXTRACT, f"photo_{prefix}.png")
    ext_txt_path = os.path.join(DIR_EXTRACT, f"medical_{prefix}.txt")
    orig_mri_gray = os.path.join(DIR_EXTRACT, f"mri_gray_orig_{prefix}.png")

    _safe_delete(ext_mri_path, ext_photo_path, ext_txt_path, orig_mri_gray)

    try:
        t_start = time.time()

        LSBHandler.extract_from_rgb(stego_path, ext_mri_path)

        if not os.path.exists(ext_mri_path):
            raise HTTPException(status_code=500, detail="File MRI hasil ekstraksi tidak ditemukan")

        extracted_bytes = LSBHandler.extract_from_grayscale(ext_mri_path)

        if not extracted_bytes:
            raise HTTPException(status_code=500, detail="Gagal menemukan data tersembunyi")

        raw = extracted_bytes.decode("utf-8")
        if "::" not in raw:
            raise HTTPException(status_code=500, detail="Format data tidak valid")
        parts = raw.split("::")
        ciphertext, iv = parts[0], parts[1]
        decrypted = aes_handler.decrypt(ciphertext, iv)

        with open(ext_txt_path, "w", encoding="utf-8") as f:
            f.write(decrypted)

        try:
            stego_img = Image.open(stego_path)
            if stego_img.mode != 'RGB':
                stego_img = stego_img.convert('RGB')
            stego_img.save(ext_photo_path, format='PNG', compress_level=0)
        except Exception:
            Image.new('RGB', (512, 512), color='gray').save(ext_photo_path, 'PNG')

        extract_time = round(time.time() - t_start, 4)

        metrics_l1 = {"mse": 0.0, "psnr": 100.0, "ssim": 1.0}
        metrics_l2 = {"mse": 0.0, "psnr": 100.0, "ssim": 1.0}

        if orig_mri_path and os.path.exists(orig_mri_path):
            try:
                Image.open(orig_mri_path).convert('L').save(orig_mri_gray, 'PNG', compress_level=0)
                metrics_l1 = LSBHandler.calculate_metrics(orig_mri_gray, ext_mri_path, mode='L')
            except Exception:
                pass

        if orig_photo_path and os.path.exists(orig_photo_path) and os.path.exists(ext_photo_path):
            try:
                metrics_l2 = LSBHandler.calculate_metrics(orig_photo_path, ext_photo_path, mode='RGB')
            except Exception:
                pass

        all_metrics = db.query(ImageQualityMetric).filter(
            ImageQualityMetric.record_id == record_id
        ).order_by(ImageQualityMetric.metric_id.asc()).all()

        if len(all_metrics) >= 2:
            m = all_metrics[1]
            m.layer1_mse = metrics_l1['mse']
            m.layer1_psnr = metrics_l1['psnr']
            m.layer1_ssim = metrics_l1['ssim']
            m.layer2_mse = metrics_l2['mse']
            m.layer2_psnr = metrics_l2['psnr']
            m.layer2_ssim = metrics_l2['ssim']
        else:
            db.add(ImageQualityMetric(
                record_id=record_id,
                layer1_mse=metrics_l1['mse'],
                layer1_psnr=metrics_l1['psnr'],
                layer1_ssim=metrics_l1['ssim'],
                layer2_mse=metrics_l2['mse'],
                layer2_psnr=metrics_l2['psnr'],
                layer2_ssim=metrics_l2['ssim'],
            ))

        record.medical_data_path = _normalize_path(ext_txt_path)
        record.photo_path = _normalize_path(ext_photo_path)
        record.mri_path = _normalize_path(ext_mri_path)
        db.commit()

        file_sizes = {
            "original_mri_kb": _file_size_kb(orig_mri_path) if orig_mri_path else 0.0,
            "original_photo_kb": _file_size_kb(orig_photo_path) if orig_photo_path else 0.0,
            "stego_kb": _file_size_kb(stego_path),
            "extracted_mri_kb": _file_size_kb(ext_mri_path),
            "extracted_photo_kb": _file_size_kb(ext_photo_path),
            "extracted_txt_kb": _file_size_kb(ext_txt_path),
        }

        write_log(db, current_user.user_id,
                  f"EXTRACT_MEDICAL: record_id={record_id}, patient_id={record.patient_id}")

        return {
            "record_id": record_id,
            "patient_id": record.patient_id,
            "patient_name": patient.full_name if patient else "Unknown",
            "medical_data": decrypted,
            "extract_time_seconds": extract_time,
            "stego_image": record.stego_photo_path,
            "photo_path": _normalize_path(ext_photo_path),
            "mri_path": _normalize_path(ext_mri_path),
            "txt_path": _normalize_path(ext_txt_path),
            "lsb_extraction_success": True,
            "quality_metrics": {
                "extraction": {
                    "layer1_mri_stego": metrics_l1,
                    "layer2_photo_stego": metrics_l2,
                }
            },
            "file_sizes": file_sizes,
        }

    except HTTPException:
        _safe_delete(ext_mri_path, ext_photo_path, ext_txt_path)
        raise
    except Exception as e:
        write_log(db, current_user.user_id, f"ERROR|EXTRACT_MEDICAL_UNEXPECTED: {e}")
        _safe_delete(ext_mri_path, ext_photo_path, ext_txt_path)
        raise HTTPException(status_code=500, detail=f"Terjadi kesalahan: {str(e)}")
    finally:
        _safe_delete(orig_mri_gray)


@router.delete("/record/{record_id}")
async def delete_medical_record(
    record_id: int,
    current_user: User = Depends(require_staff),
    db: Session = Depends(get_db)
):
    record = db.query(MedicalRecord).filter(MedicalRecord.record_id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Rekam medis tidak ditemukan")

    patient_id = record.patient_id

    db.query(ImageQualityMetric).filter(
        ImageQualityMetric.record_id == record_id
    ).delete()

    deleted = []
    for path in [record.medical_data_path, record.photo_path, record.mri_path, record.stego_photo_path]:
        if path:
            real = _denormalize_path(path)
            if os.path.exists(real):
                try:
                    os.unlink(real)
                    deleted.append(real)
                except OSError:
                    pass

    db.delete(record)
    db.commit()

    write_log(db, current_user.user_id,
              f"DELETE_MEDICAL_RECORD: record_id={record_id}, patient_id={patient_id}")

    return {
        "message": f"Rekam medis #{record_id} berhasil dihapus",
        "record_id": record_id,
        "files_deleted": {"deleted": deleted, "count": len(deleted)},
    }