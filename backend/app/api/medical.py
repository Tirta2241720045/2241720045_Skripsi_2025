from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from sqlalchemy.orm import Session
from app.models.database import get_db, MedicalRecord, Patient, ImageQualityMetric, User
from app.utils.logger import write_log
from app.api.auth import require_staff, require_doctor, require_staff_or_doctor
import os
import time
import numpy as np
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
DIR_VISUAL = os.path.join("files", "visualization")

for d in [DIR_ORIGINAL, DIR_EMBEDDING, DIR_EXTRACT, DIR_VISUAL]:
    os.makedirs(d, exist_ok=True)

MRI_BORDER_RATIO = 0.15
PHOTO_BORDER_RATIO = 0.15


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
    photo_path = os.path.join(DIR_ORIGINAL, f"photo_{prefix}.png")
    mri_path = os.path.join(DIR_ORIGINAL, f"mri_{prefix}.png")
    txt_path = os.path.join(DIR_ORIGINAL, f"medical_{prefix}.txt")
    return photo_path, mri_path, txt_path


def _save_image(img: Image.Image, path: str, compress_level: int = 0) -> None:
    img.save(path, format='PNG', compress_level=compress_level)


def _pil_to_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def _pack_encrypted(encrypted: dict) -> bytes:
    return f"{encrypted['ciphertext']}::{encrypted['iv']}::{encrypted['mac']}".encode('utf-8')


def _unpack_encrypted(raw: str) -> Tuple[str, str, str]:
    parts = raw.split("::", 2)
    if len(parts) != 3:
        raise ValueError("Format data tidak valid: diharapkan ciphertext::iv::mac")
    return parts[0], parts[1], parts[2]


def _fmt_metrics(m) -> Optional[dict]:
    if not m:
        return None
    return {
        "layer1_mri_stego": {
            "mse": m.layer1_mse,
            "psnr": m.layer1_psnr,
            "ssim": m.layer1_ssim,
            "brisque": m.layer1_brisque,
            "niqe": m.layer1_niqe,
            "piqe": m.layer1_piqe,
        },
        "layer2_photo_stego": {
            "mse": m.layer2_mse,
            "psnr": m.layer2_psnr,
            "ssim": m.layer2_ssim,
            "brisque": m.layer2_brisque,
            "niqe": m.layer2_niqe,
            "piqe": m.layer2_piqe,
        },
        "acc_txt": {
            "acc_txt": m.acc_txt,
            "D": m.acc_txt_D,
            "T": m.acc_txt_T,
            "bit_errors": m.acc_txt_errors,
        } if m.acc_txt is not None else None,
    }


def _calculate_acctxt(original_text: str, recovered_text: str) -> dict:
    orig_bytes = original_text.encode('utf-8')
    recv_bytes = recovered_text.encode('utf-8')

    T = len(orig_bytes) * 8

    if T == 0:
        return {"acc_txt": 100.0, "D": 0, "T": 0, "bit_errors": 0}

    min_len = min(len(orig_bytes), len(recv_bytes))
    orig_bits = np.unpackbits(np.frombuffer(orig_bytes[:min_len], dtype=np.uint8))
    recv_bits = np.unpackbits(np.frombuffer(recv_bytes[:min_len], dtype=np.uint8))

    matched = int(np.sum(orig_bits == recv_bits))

    D = matched
    bit_errors = T - D
    acc_txt = round((D / T) * 100, 4)

    return {
        "acc_txt": acc_txt,
        "D": D,
        "T": T,
        "bit_errors": bit_errors,
    }


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
        write_log(db, current_user.user_id, f"ERROR|UPLOAD_MEDICAL_FAILED: patient_id={patient_id}, reason=patient_not_found")
        raise HTTPException(status_code=404, detail="Pasien tidak ditemukan")

    existing_count = db.query(MedicalRecord).filter(MedicalRecord.patient_id == patient_id).count()
    if existing_count >= 10:
        write_log(db, current_user.user_id, f"ERROR|UPLOAD_MEDICAL_FAILED: patient_id={patient_id}, reason=max_records_reached")
        raise HTTPException(status_code=400, detail="Maksimal 10 rekam medis per pasien telah tercapai")

    mri_bytes = await mri_image.read()
    photo_bytes = await patient_photo.read()
    txt_bytes = await medical_data.read()

    if len(txt_bytes) > 500 * 1024:
        raise HTTPException(status_code=400, detail="Ukuran data medis maksimal 500 KB")

    txt_content = txt_bytes.decode("utf-8")

    try:
        img_mri = Image.open(io.BytesIO(mri_bytes))
        img_photo = Image.open(io.BytesIO(photo_bytes))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"File gambar tidak valid: {str(e)}")

    mri_w, mri_h = img_mri.size
    photo_w, photo_h = img_photo.size

    if mri_w > photo_w or mri_h > photo_h:
        raise HTTPException(status_code=400, detail=f"Ukuran MRI ({mri_w}x{mri_h}) tidak boleh lebih besar dari foto pasien ({photo_w}x{photo_h}).")

    timestamp = int(time.time() * 1000)
    prefix = f"{patient_id}_{timestamp}"

    orig_photo_path = os.path.join(DIR_ORIGINAL, f"photo_{prefix}.png")
    orig_mri_path = os.path.join(DIR_ORIGINAL, f"mri_{prefix}.png")
    orig_txt_path = os.path.join(DIR_ORIGINAL, f"medical_{prefix}.txt")
    stego_out_path = os.path.join(DIR_EMBEDDING, f"stego_{prefix}.png")
    vis_mri_path = os.path.join(DIR_VISUAL, f"vis_mri_{prefix}.png")
    vis_photo_path = os.path.join(DIR_VISUAL, f"vis_photo_{prefix}.png")

    img_mri_gray = img_mri.convert('L')
    img_photo_rgb = img_photo.convert('RGB')

    try:
        t_total = time.time()

        img_photo_rgb.save(orig_photo_path, format='PNG', compress_level=0)
        img_mri_gray.save(orig_mri_path, format='PNG', compress_level=0)

        with open(orig_txt_path, "w", encoding="utf-8") as f:
            f.write(txt_content)

        encrypted = aes_handler.encrypt(txt_content)
        data_to_embed = _pack_encrypted(encrypted)

        roni_mri_capacity = LSBHandler.get_roni_capacity_border(mri_h, mri_w, MRI_BORDER_RATIO)
        roni_mri_bytes = (roni_mri_capacity // 8) - 4

        if len(data_to_embed) > roni_mri_bytes:
            raise HTTPException(status_code=400, detail=f"Data terlalu besar. Kapasitas RONI MRI: {roni_mri_bytes} bytes.")

        t1 = time.time()
        mri_stego_img = LSBHandler.embed_to_grayscale_geometric(img_mri_gray, data_to_embed, border_ratio=MRI_BORDER_RATIO)
        time_layer1 = round(time.time() - t1, 4)

        mri_stego_size = len(_pil_to_bytes(mri_stego_img))

        roni_photo_capacity = LSBHandler.get_roni_capacity_border(photo_h, photo_w, PHOTO_BORDER_RATIO) * 3
        roni_photo_bytes = (roni_photo_capacity // 8) - 4

        if mri_stego_size > roni_photo_bytes:
            raise HTTPException(status_code=400, detail=f"MRI stego terlalu besar. Kapasitas RONI foto: {roni_photo_bytes} bytes.")

        t2 = time.time()
        stego_img = LSBHandler.embed_to_rgb_geometric(img_photo_rgb, mri_stego_img, border_ratio=PHOTO_BORDER_RATIO)
        time_layer2 = round(time.time() - t2, 4)

        stego_img.save(stego_out_path, format='PNG', compress_level=9)

        metrics_l1 = LSBHandler.calculate_metrics(img_mri_gray, mri_stego_img, mode='L')
        metrics_l2 = LSBHandler.calculate_metrics(img_photo_rgb, stego_img, mode='RGB')
        nriqa_l1 = LSBHandler.calculate_nriqa_metrics(mri_stego_img, mode='L')
        nriqa_l2 = LSBHandler.calculate_nriqa_metrics(stego_img, mode='RGB')

        t_vis_start = time.time()
        n_bits_l1 = (len(data_to_embed) + 4) * 8
        vis_mri_img = LSBHandler.generate_lsb_visualization_grayscale_geometric(img_mri_gray, mri_stego_img, n_bits_l1, border_ratio=MRI_BORDER_RATIO)
        buf = io.BytesIO()
        mri_stego_img.save(buf, format='PNG')
        n_bits_l2 = (len(buf.getvalue()) + 4) * 8
        vis_photo_img = LSBHandler.generate_lsb_visualization_rgb_geometric(img_photo_rgb, stego_img, n_bits_l2, border_ratio=PHOTO_BORDER_RATIO)
        _save_image(vis_mri_img, vis_mri_path, compress_level=9)
        _save_image(vis_photo_img, vis_photo_path, compress_level=9)
        time_vis = round(time.time() - t_vis_start, 4)

        time_total = round(time.time() - t_total, 4)

        file_sizes = {
            "original_txt_kb": _file_size_kb(orig_txt_path),
            "original_mri_kb": _file_size_kb(orig_mri_path),
            "original_photo_kb": _file_size_kb(orig_photo_path),
            "stego_kb": _file_size_kb(stego_out_path),
            "vis_mri_kb": _file_size_kb(vis_mri_path),
            "vis_photo_kb": _file_size_kb(vis_photo_path),
        }

        db_record = MedicalRecord(
            patient_id=patient_id,
            medical_data_path=_normalize_path(orig_txt_path),
            photo_path=_normalize_path(orig_photo_path),
            mri_path=_normalize_path(orig_mri_path),
            stego_photo_path=_normalize_path(stego_out_path),
            embed_time_seconds=time_total,
        )
        db.add(db_record)
        db.commit()
        db.refresh(db_record)

        db.add(ImageQualityMetric(
            record_id=db_record.record_id,
            layer1_mse=metrics_l1['mse'],
            layer1_psnr=metrics_l1['psnr'],
            layer1_ssim=metrics_l1['ssim'],
            layer1_brisque=nriqa_l1['brisque'],
            layer1_niqe=nriqa_l1['niqe'],
            layer1_piqe=nriqa_l1['piqe'],
            layer2_mse=metrics_l2['mse'],
            layer2_psnr=metrics_l2['psnr'],
            layer2_ssim=metrics_l2['ssim'],
            layer2_brisque=nriqa_l2['brisque'],
            layer2_niqe=nriqa_l2['niqe'],
            layer2_piqe=nriqa_l2['piqe'],
        ))
        db.commit()

        write_log(db, current_user.user_id, f"UPLOAD_MEDICAL: patient_id={patient_id}, record_id={db_record.record_id}")

        return {
            "message": "Data berhasil diproses dengan RONI Geometris",
            "record_id": db_record.record_id,
            "stego_image": _normalize_path(stego_out_path),
            "roni_type": "geometric_border",
            "visualization": {
                "mri_lsb_map": _normalize_path(vis_mri_path),
                "photo_lsb_map": _normalize_path(vis_photo_path),
            },
            "embed_time": {
                "layer1_seconds": time_layer1,
                "layer2_seconds": time_layer2,
                "visualization_seconds": time_vis,
                "total_seconds": time_total,
            },
            "quality_metrics": {
                "layer1_mri_stego": {**metrics_l1, **nriqa_l1},
                "layer2_photo_stego": {**metrics_l2, **nriqa_l2},
            },
            "file_sizes": file_sizes,
        }

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        write_log(db, current_user.user_id, f"ERROR|UPLOAD_MEDICAL_UNEXPECTED: {e}")
        raise HTTPException(status_code=500, detail=f"Terjadi kesalahan: {str(e)}")


@router.get("/patient/{patient_id}")
async def get_medical_records_by_patient(
    patient_id: int,
    current_user: User = Depends(require_staff_or_doctor),
    db: Session = Depends(get_db)
):
    patient = db.query(Patient).filter(Patient.patient_id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Pasien tidak ditemukan")

    records = db.query(MedicalRecord).filter(MedicalRecord.patient_id == patient_id).order_by(MedicalRecord.record_id.desc()).all()

    result = []
    for record in records:
        all_metrics = db.query(ImageQualityMetric).filter(ImageQualityMetric.record_id == record.record_id).order_by(ImageQualityMetric.metric_id.asc()).all()
        embed_m = all_metrics[0] if len(all_metrics) > 0 else None
        extract_m = all_metrics[1] if len(all_metrics) > 1 else None

        orig_photo_path, orig_mri_path, orig_txt_path = _get_original_paths(record.patient_id, record.stego_photo_path)
        timestamp = _parse_timestamp_from_stego(record.stego_photo_path)
        prefix = f"{record.patient_id}_{timestamp}" if timestamp else None
        vis_mri_path = os.path.join(DIR_VISUAL, f"vis_mri_{prefix}.png") if prefix else None
        vis_photo_path = os.path.join(DIR_VISUAL, f"vis_photo_{prefix}.png") if prefix else None

        file_sizes = {
            "original_txt_kb": _file_size_kb(orig_txt_path) if orig_txt_path else 0.0,
            "original_mri_kb": _file_size_kb(orig_mri_path) if orig_mri_path else 0.0,
            "original_photo_kb": _file_size_kb(orig_photo_path) if orig_photo_path else 0.0,
            "stego_kb": _file_size_kb(_denormalize_path(record.stego_photo_path)),
            "vis_mri_kb": _file_size_kb(vis_mri_path) if vis_mri_path else 0.0,
            "vis_photo_kb": _file_size_kb(vis_photo_path) if vis_photo_path else 0.0,
        }

        result.append({
            "record_id": record.record_id,
            "medical_data_path": record.medical_data_path,
            "photo_path": record.photo_path,
            "mri_path": record.mri_path,
            "stego_photo_path": record.stego_photo_path,
            "roni_type": "geometric_border",
            "visualization": {
                "mri_lsb_map": _normalize_path(vis_mri_path) if vis_mri_path and os.path.exists(vis_mri_path) else None,
                "photo_lsb_map": _normalize_path(vis_photo_path) if vis_photo_path and os.path.exists(vis_photo_path) else None,
            },
            "upload_date": record.created_at.isoformat() if record.created_at else None,
            "quality_metrics": {
                "embedding": _fmt_metrics(embed_m),
                "extraction": _fmt_metrics(extract_m),
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
    orig_photo_path, orig_mri_path, orig_txt_path = _get_original_paths(record.patient_id, record.stego_photo_path)

    timestamp = _parse_timestamp_from_stego(record.stego_photo_path)
    ext_prefix = f"{record.patient_id}_{timestamp}_{record_id}" if timestamp else f"{record.patient_id}_{record_id}"

    ext_mri_path = os.path.join(DIR_EXTRACT, f"mri_{ext_prefix}.png")
    ext_photo_path = os.path.join(DIR_EXTRACT, f"photo_{ext_prefix}.png")
    ext_txt_path = os.path.join(DIR_EXTRACT, f"medical_{ext_prefix}.txt")

    _safe_delete(ext_mri_path, ext_photo_path, ext_txt_path)

    try:
        t_start = time.time()

        stego_img = Image.open(stego_path).convert('RGB')

        extracted_mri_img = LSBHandler.extract_from_rgb_geometric(stego_img, border_ratio=PHOTO_BORDER_RATIO)
        if extracted_mri_img is None:
            raise HTTPException(status_code=500, detail="Gagal mengekstrak MRI dari stego")

        extracted_bytes = LSBHandler.extract_from_grayscale_geometric(extracted_mri_img, border_ratio=MRI_BORDER_RATIO)
        if not extracted_bytes:
            raise HTTPException(status_code=500, detail="Gagal menemukan data tersembunyi")

        raw = extracted_bytes.decode("utf-8")
        ciphertext, iv, mac = _unpack_encrypted(raw)
        decrypted = aes_handler.decrypt(ciphertext, iv, mac)

        with open(ext_txt_path, "w", encoding="utf-8") as f:
            f.write(decrypted)

        _save_image(extracted_mri_img, ext_mri_path, compress_level=9)

        stego_array = np.array(stego_img, dtype=np.uint8)
        cleaned_photo_array = stego_array & 0xFE
        cleaned_photo_img = Image.fromarray(cleaned_photo_array, mode='RGB')
        _save_image(cleaned_photo_img, ext_photo_path, compress_level=9)

        extract_time = round(time.time() - t_start, 4)

        acctxt_result = {"acc_txt": None, "D": None, "T": None, "bit_errors": None}
        if orig_txt_path and os.path.exists(orig_txt_path):
            with open(orig_txt_path, "r", encoding="utf-8") as f:
                original_text = f.read()
            acctxt_result = _calculate_acctxt(original_text, decrypted)

        metrics_l1 = {"mse": 0.0, "psnr": 100.0, "ssim": 1.0}
        if orig_mri_path and os.path.exists(orig_mri_path):
            orig_mri_img = Image.open(orig_mri_path)
            if orig_mri_img.mode != 'L':
                orig_mri_img = orig_mri_img.convert('L')
            metrics_l1 = LSBHandler.calculate_metrics(orig_mri_img, extracted_mri_img, mode='L')

        metrics_l2 = {"mse": 0.0, "psnr": 100.0, "ssim": 1.0}
        if orig_photo_path and os.path.exists(orig_photo_path):
            orig_photo_img = Image.open(orig_photo_path)
            if orig_photo_img.mode != 'RGB':
                orig_photo_img = orig_photo_img.convert('RGB')
            metrics_l2 = LSBHandler.calculate_metrics(orig_photo_img, cleaned_photo_img, mode='RGB')

        nriqa_l1 = LSBHandler.calculate_nriqa_metrics(extracted_mri_img, mode='L')
        nriqa_l2 = LSBHandler.calculate_nriqa_metrics(cleaned_photo_img, mode='RGB')

        record.extract_time_seconds = extract_time
        db.commit()

        all_metrics = db.query(ImageQualityMetric).filter(ImageQualityMetric.record_id == record_id).order_by(ImageQualityMetric.metric_id.asc()).all()
        if len(all_metrics) >= 2:
            m = all_metrics[1]
            m.layer1_mse = metrics_l1['mse']
            m.layer1_psnr = metrics_l1['psnr']
            m.layer1_ssim = metrics_l1['ssim']
            m.layer1_brisque = nriqa_l1['brisque']
            m.layer1_niqe = nriqa_l1['niqe']
            m.layer1_piqe = nriqa_l1['piqe']
            m.layer2_mse = metrics_l2['mse']
            m.layer2_psnr = metrics_l2['psnr']
            m.layer2_ssim = metrics_l2['ssim']
            m.layer2_brisque = nriqa_l2['brisque']
            m.layer2_niqe = nriqa_l2['niqe']
            m.layer2_piqe = nriqa_l2['piqe']
            m.acc_txt = acctxt_result['acc_txt']
            m.acc_txt_D = acctxt_result['D']
            m.acc_txt_T = acctxt_result['T']
            m.acc_txt_errors = acctxt_result['bit_errors']
        else:
            db.add(ImageQualityMetric(
                record_id=record_id,
                layer1_mse=metrics_l1['mse'],
                layer1_psnr=metrics_l1['psnr'],
                layer1_ssim=metrics_l1['ssim'],
                layer1_brisque=nriqa_l1['brisque'],
                layer1_niqe=nriqa_l1['niqe'],
                layer1_piqe=nriqa_l1['piqe'],
                layer2_mse=metrics_l2['mse'],
                layer2_psnr=metrics_l2['psnr'],
                layer2_ssim=metrics_l2['ssim'],
                layer2_brisque=nriqa_l2['brisque'],
                layer2_niqe=nriqa_l2['niqe'],
                layer2_piqe=nriqa_l2['piqe'],
                acc_txt=acctxt_result['acc_txt'],
                acc_txt_D=acctxt_result['D'],
                acc_txt_T=acctxt_result['T'],
                acc_txt_errors=acctxt_result['bit_errors'],
            ))
        db.commit()

        write_log(db, current_user.user_id, f"EXTRACT_MEDICAL: record_id={record_id}, patient_id={record.patient_id}")

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
            "roni_type": "geometric_border",
            "acc_txt": acctxt_result,
            "quality_metrics": {
                "extraction": {
                    "layer1_mri_stego": {**metrics_l1, **nriqa_l1},
                    "layer2_photo_stego": {**metrics_l2, **nriqa_l2},
                    "acc_txt": acctxt_result,
                }
            },
            "file_sizes": {
                "stego_kb": _file_size_kb(stego_path),
                "extracted_mri_kb": _file_size_kb(ext_mri_path),
                "extracted_photo_kb": _file_size_kb(ext_photo_path),
                "extracted_txt_kb": _file_size_kb(ext_txt_path),
            },
        }

    except HTTPException:
        _safe_delete(ext_mri_path, ext_photo_path, ext_txt_path)
        raise
    except ValueError as e:
        _safe_delete(ext_mri_path, ext_photo_path, ext_txt_path)
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        write_log(db, current_user.user_id, f"ERROR|EXTRACT_MEDICAL_UNEXPECTED: {e}")
        _safe_delete(ext_mri_path, ext_photo_path, ext_txt_path)
        raise HTTPException(status_code=500, detail=f"Terjadi kesalahan: {str(e)}")


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
    db.query(ImageQualityMetric).filter(ImageQualityMetric.record_id == record_id).delete()

    timestamp = _parse_timestamp_from_stego(record.stego_photo_path)
    prefix = f"{record.patient_id}_{timestamp}" if timestamp else None
    ext_prefix = f"{record.patient_id}_{timestamp}_{record_id}" if timestamp else f"{record.patient_id}_{record_id}"

    all_paths = [
        record.medical_data_path, record.photo_path, record.mri_path, record.stego_photo_path,
    ]

    if prefix:
        all_paths += [
            os.path.join(DIR_ORIGINAL, f"photo_{prefix}.png"),
            os.path.join(DIR_ORIGINAL, f"mri_{prefix}.png"),
            os.path.join(DIR_ORIGINAL, f"medical_{prefix}.txt"),
            os.path.join(DIR_VISUAL, f"vis_mri_{prefix}.png"),
            os.path.join(DIR_VISUAL, f"vis_photo_{prefix}.png"),
        ]

    all_paths += [
        os.path.join(DIR_EXTRACT, f"mri_{ext_prefix}.png"),
        os.path.join(DIR_EXTRACT, f"photo_{ext_prefix}.png"),
        os.path.join(DIR_EXTRACT, f"medical_{ext_prefix}.txt"),
    ]

    seen = set()
    deleted = []
    for path in all_paths:
        if not path:
            continue
        real = _denormalize_path(path)
        if real in seen:
            continue
        seen.add(real)
        if os.path.exists(real):
            try:
                os.unlink(real)
                deleted.append(_normalize_path(real))
            except OSError:
                pass

    db.delete(record)
    db.commit()
    write_log(db, current_user.user_id, f"DELETE_MEDICAL_RECORD: record_id={record_id}, patient_id={patient_id}")
    return {"message": f"Rekam medis #{record_id} berhasil dihapus", "record_id": record_id, "files_deleted": {"deleted": deleted, "count": len(deleted)}}