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
        """Embed teks ke dalam MRI (EBS9), lalu embed ke photo."""
        photo_w, photo_h = img_photo.size
        mri_w, mri_h = img_mri.size

        if mri_w > photo_w or mri_h > photo_h:
            raise ValueError(
                f"Ukuran MRI ({mri_w}x{mri_h}) tidak boleh lebih besar "
                f"dari foto pasien ({photo_w}x{photo_h})."
            )

        # Layer 1: EBS9 embed ke MRI
        t1_start = time.perf_counter()
        result_l1 = ebs9.embed(img_mri, txt_content)
        time_layer1 = round(time.perf_counter() - t1_start, 6)

        mri_stego_img = result_l1["stego_img"]
        original_len = result_l1["original_len"]
        n_bits = result_l1["n_bits"]

        # Konversi MRI stego ke bytes
        buf = io.BytesIO()
        mri_stego_img.save(buf, format='PNG', compress_level=3)
        mri_stego_bytes = buf.getvalue()

        # Layer 2: Embed MRI stego bytes ke photo
        t2_start = time.perf_counter()
        stego_img = LSBHandler.embed_to_rgb_full_with_bytes(img_photo, mri_stego_bytes)
        time_layer2 = round(time.perf_counter() - t2_start, 6)

        time_total = round(time_layer1 + time_layer2, 6)

        # Hitung metrics
        metrics_l1 = LSBHandler.calculate_metrics(img_mri, mri_stego_img, mode='L')
        nriqa_l1 = LSBHandler.calculate_nriqa_metrics(mri_stego_img, mode='L')

        metrics_l2 = LSBHandler.calculate_metrics(img_photo, stego_img, mode='RGB')
        nriqa_l2 = LSBHandler.calculate_nriqa_metrics(stego_img, mode='RGB')

        return {
            "stego_img": stego_img,
            "mri_stego_img": mri_stego_img,
            "original_len": original_len,
            "n_bits": n_bits,
            "timing": {
                "layer1_seconds": time_layer1,
                "layer2_seconds": time_layer2,
                "total_seconds": time_total,
            },
            "metrics_l1": {**metrics_l1, **nriqa_l1},
            "metrics_l2": {**metrics_l2, **nriqa_l2},
        }

    def extract(
        self,
        stego_img: Image.Image,
        orig_mri_img: Image.Image | None = None,
        orig_photo_img: Image.Image | None = None,
        orig_txt: str | None = None,
    ) -> dict:
        """
        Ekstrak data dari stego photo.
        original_len dan n_bits diambil dari orig_txt (metadata dari database/nama file)
        """
        # Ambil metadata dari orig_txt (format: "original_len:n_bits")
        if orig_txt is None or ":" not in orig_txt:
            raise ValueError(
                "EBS9 extract: metadata (original_len:n_bits) harus disediakan. "
                "Contoh: '150:1200'"
            )
        
        try:
            parts = orig_txt.split(":")
            original_len = int(parts[0])
            n_bits = int(parts[1])
        except (ValueError, IndexError) as e:
            raise ValueError(f"Format metadata tidak valid: {orig_txt}. Error: {e}")

        # Layer 2: Extract MRI stego bytes dari photo
        t2_start = time.perf_counter()
        mri_stego_bytes = LSBHandler.extract_from_rgb_full_bytes(stego_img)
        time_layer2 = round(time.perf_counter() - t2_start, 6)

        if mri_stego_bytes is None or len(mri_stego_bytes) == 0:
            raise ValueError("Gagal mengekstrak MRI stego dari photo.")

        # Rekonstruksi MRI stego dari bytes
        try:
            extracted_mri_img = Image.open(io.BytesIO(mri_stego_bytes)).convert('L')
        except Exception as e:
            raise ValueError(f"Gagal merekonstruksi MRI stego: {e}")

        # Layer 1: EBS9 extract dari MRI stego
        t1_start = time.perf_counter()
        result_l1 = ebs9.extract(extracted_mri_img, original_len, n_bits)
        time_layer1 = round(time.perf_counter() - t1_start, 6)

        decrypted = result_l1["recovered_text"]
        time_total = round(time_layer1 + time_layer2, 6)

        # Clean photo (LSB zeroing)
        stego_array = np.array(stego_img, dtype=np.uint8)
        cleaned_photo_array = stego_array & np.uint8(0xFE)
        cleaned_photo_img = Image.fromarray(cleaned_photo_array, mode='RGB')

        # Hitung metrics jika original tersedia
        metrics_l1 = {"mse": 0.0, "psnr": 100.0, "ssim": 1.0, "brisque": None, "niqe": None, "piqe": None}
        if orig_mri_img is not None:
            metrics_l1 = LSBHandler.calculate_metrics(orig_mri_img, extracted_mri_img, mode='L')
            nriqa_l1 = LSBHandler.calculate_nriqa_metrics(extracted_mri_img, mode='L')
            metrics_l1.update(nriqa_l1)

        metrics_l2 = {"mse": 0.0, "psnr": 100.0, "ssim": 1.0, "brisque": None, "niqe": None, "piqe": None}
        if orig_photo_img is not None:
            metrics_l2 = LSBHandler.calculate_metrics(orig_photo_img, cleaned_photo_img, mode='RGB')
            nriqa_l2 = LSBHandler.calculate_nriqa_metrics(cleaned_photo_img, mode='RGB')
            metrics_l2.update(nriqa_l2)

        return {
            "decrypted": decrypted,
            "extracted_mri_img": extracted_mri_img,
            "cleaned_photo_img": cleaned_photo_img,
            "timing": {
                "layer1_seconds": time_layer1,
                "layer2_seconds": time_layer2,
                "total_seconds": time_total,
            },
            "metrics_l1": metrics_l1,
            "metrics_l2": metrics_l2,
        }