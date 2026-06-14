from __future__ import annotations

import io
import math
import time
import numpy as np
from PIL import Image

from app.core.handler.moduls import ebs9
from app.core.handler.moduls.lsb_handler import LSBHandler


class EBS9Handler:

    def embed(
        self,
        img_mri: Image.Image,
        img_photo: Image.Image,
        txt_content: str,
    ) -> dict:
        photo_w, photo_h = img_photo.size
        mri_w, mri_h = img_mri.size

        if mri_w > photo_w or mri_h > photo_h:
            raise ValueError(
                f"Ukuran MRI ({mri_w}x{mri_h}) tidak boleh lebih besar "
                f"dari foto pasien ({photo_w}x{photo_h})."
            )

        # Layer 1: EBS9 embed teks ke MRI
        t1_start = time.perf_counter()
        result_l1 = ebs9.embed(img_mri, txt_content)
        time_layer1 = round(time.perf_counter() - t1_start, 6)

        mri_stego_img = result_l1["stego_img"]
        metrics_l1    = result_l1["metrics"]

        # Serialisasi MRI stego → bytes PNG
        buf = io.BytesIO()
        mri_stego_img.save(buf, format="PNG", compress_level=3)
        mri_stego_bytes = buf.getvalue()

        # Layer 2: LSB embed MRI stego bytes ke photo
        t2_start = time.perf_counter()
        stego_img = LSBHandler.embed_to_rgb_full_with_bytes(img_photo, mri_stego_bytes)
        time_layer2 = round(time.perf_counter() - t2_start, 6)

        time_total = round(time_layer1 + time_layer2, 6)

        metrics_l2 = LSBHandler.calculate_metrics(img_photo, stego_img, mode="RGB")
        nriqa_l2   = LSBHandler.calculate_nriqa_metrics(stego_img, mode="RGB")

        return {
            "stego_img":     stego_img,
            "mri_stego_img": mri_stego_img,
            "timing": {
                "layer1_seconds": time_layer1,
                "layer2_seconds": time_layer2,
                "total_seconds":  time_total,
            },
            "metrics_l1": metrics_l1,
            "metrics_l2": {**metrics_l2, **nriqa_l2},
        }

    def extract(
        self,
        stego_img: Image.Image,
        orig_mri_img:   Image.Image | None = None,
        orig_photo_img: Image.Image | None = None,
        orig_txt:       str | None = None,
    ) -> dict:
        # ── Derive original_len + n_bits dari orig_txt ────────────────────
        # Persis pola kode lama: re-enkripsi teks asli untuk dapat struktur
        # matrix yang identik dengan saat embed, tanpa perlu simpan ke DB.
        if orig_txt is None:
            raise ValueError(
                "EBS9 extract: teks asli (orig_txt) diperlukan untuk "
                "menentukan ukuran matrix. Pastikan file .txt original tersedia."
            )

        original_len = len(orig_txt.encode("utf-8"))
        rows         = max(1, math.ceil(original_len / 8))
        cols         = 8
        n_bits       = rows * cols * 8  # = jumlah bit yang di-embed saat embed

        # ── Layer 2: Extract MRI stego bytes dari photo ───────────────────
        t2_start = time.perf_counter()
        mri_stego_bytes = LSBHandler.extract_from_rgb_full_bytes(stego_img)
        time_layer2 = round(time.perf_counter() - t2_start, 6)

        if not mri_stego_bytes:
            raise ValueError("Gagal mengekstrak MRI stego dari photo.")

        try:
            extracted_mri_img = Image.open(io.BytesIO(mri_stego_bytes)).convert("L")
        except Exception as e:
            raise ValueError(f"Gagal merekonstruksi MRI stego: {e}")

        # ── Layer 1: EBS9 extract teks dari MRI stego ────────────────────
        t1_start = time.perf_counter()
        result_l1 = ebs9.extract(extracted_mri_img, original_len, n_bits)
        time_layer1 = round(time.perf_counter() - t1_start, 6)

        decrypted  = result_l1["recovered_text"]
        time_total = round(time_layer1 + time_layer2, 6)

        # Clean photo
        stego_array       = np.array(stego_img, dtype=np.uint8)
        cleaned_photo_img = Image.fromarray(stego_array & np.uint8(0xFE), mode="RGB")

        # ── Metrics ───────────────────────────────────────────────────────
        _default = {
            "mse": 0.0, "psnr": 100.0, "ssim": 1.0,
            "brisque": None, "niqe": None, "piqe": None,
        }

        metrics_l1 = dict(_default)
        if orig_mri_img is not None:
            metrics_l1 = LSBHandler.calculate_metrics(orig_mri_img, extracted_mri_img, mode="L")
            metrics_l1.update(LSBHandler.calculate_nriqa_metrics(extracted_mri_img, mode="L"))

        metrics_l2 = dict(_default)
        if orig_photo_img is not None:
            metrics_l2 = LSBHandler.calculate_metrics(orig_photo_img, cleaned_photo_img, mode="RGB")
            metrics_l2.update(LSBHandler.calculate_nriqa_metrics(cleaned_photo_img, mode="RGB"))

        return {
            "decrypted":          decrypted,
            "extracted_mri_img":  extracted_mri_img,
            "cleaned_photo_img":  cleaned_photo_img,
            "timing": {
                "layer1_seconds": time_layer1,
                "layer2_seconds": time_layer2,
                "total_seconds":  time_total,
            },
            "metrics_l1": metrics_l1,
            "metrics_l2": metrics_l2,
        }