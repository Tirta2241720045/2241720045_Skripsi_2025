from __future__ import annotations

import io
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
        """
        Embed teks ke dalam MRI (EBS9 layer 1),
        lalu embed MRI stego ke photo (LSB layer 2).
        """
        photo_w, photo_h = img_photo.size
        mri_w, mri_h = img_mri.size

        if mri_w > photo_w or mri_h > photo_h:
            raise ValueError(
                f"Ukuran MRI ({mri_w}x{mri_h}) tidak boleh lebih besar "
                f"dari foto pasien ({photo_w}x{photo_h})."
            )

        # ── Layer 1: EBS9 embed teks ke MRI ──────────────────────────────
        t1_start = time.perf_counter()
        result_l1 = ebs9.embed(img_mri, txt_content)
        time_layer1 = round(time.perf_counter() - t1_start, 6)

        mri_stego_img  = result_l1["stego_img"]
        original_len   = result_l1["original_len"]
        n_bits         = result_l1["n_bits"]
        metrics_l1     = result_l1["metrics"]   # sudah include NR-IQA dari ebs9.embed

        # Serialisasi MRI stego → bytes PNG
        buf = io.BytesIO()
        mri_stego_img.save(buf, format="PNG", compress_level=3)
        mri_stego_bytes = buf.getvalue()

        # ── Layer 2: LSB embed MRI stego bytes ke photo ───────────────────
        t2_start = time.perf_counter()
        stego_img = LSBHandler.embed_to_rgb_full_with_bytes(img_photo, mri_stego_bytes)
        time_layer2 = round(time.perf_counter() - t2_start, 6)

        time_total = round(time_layer1 + time_layer2, 6)

        # Metrics layer 2
        metrics_l2 = LSBHandler.calculate_metrics(img_photo, stego_img, mode="RGB")
        nriqa_l2   = LSBHandler.calculate_nriqa_metrics(stego_img, mode="RGB")

        return {
            "stego_img":     stego_img,
            "mri_stego_img": mri_stego_img,
            "original_len":  original_len,
            "n_bits":        n_bits,
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
        original_len: int,
        n_bits: int,
        orig_mri_img:   Image.Image | None = None,
        orig_photo_img: Image.Image | None = None,
    ) -> dict:
        """
        Ekstrak teks dari stego photo.

        Args:
            stego_img    : foto hasil embed (layer 2)
            original_len : panjang teks asli dalam bytes (dari DB)
            n_bits       : jumlah bit EBS9 yang di-embed ke MRI (dari DB)
            orig_mri_img   : (opsional) MRI asli untuk hitung metrics L1
            orig_photo_img : (opsional) foto asli untuk hitung metrics L2
        """
        # ── Layer 2: Extract MRI stego bytes dari photo ───────────────────
        t2_start = time.perf_counter()
        mri_stego_bytes = LSBHandler.extract_from_rgb_full_bytes(stego_img)
        time_layer2 = round(time.perf_counter() - t2_start, 6)

        if not mri_stego_bytes:
            raise ValueError("Gagal mengekstrak MRI stego dari photo.")

        # Rekonstruksi MRI stego
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

        # Clean photo (zero-out LSB)
        stego_array        = np.array(stego_img, dtype=np.uint8)
        cleaned_photo_img  = Image.fromarray(stego_array & np.uint8(0xFE), mode="RGB")

        # ── Metrics (opsional) ────────────────────────────────────────────
        _default = {"mse": 0.0, "psnr": 100.0, "ssim": 1.0,
                    "brisque": None, "niqe": None, "piqe": None}

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