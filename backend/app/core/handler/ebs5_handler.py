from __future__ import annotations

import io
import time
import numpy as np
from PIL import Image

from app.core.handler.moduls import ebs5
from app.core.handler.moduls.lsb_handler import LSBHandler


class EBS5Handler:

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

        t1_start = time.perf_counter()
        result_l1 = ebs5.embed(img_mri, txt_content)
        time_layer1 = round(time.perf_counter() - t1_start, 6)

        mri_stego_img = result_l1["stego_img"]

        buf = io.BytesIO()
        mri_stego_img.save(buf, format='PNG', compress_level=3)
        mri_stego_bytes = buf.getvalue()

        photo_full_capacity = (photo_h * photo_w * 3 // 8) - 4
        if len(mri_stego_bytes) > photo_full_capacity:
            raise ValueError(
                f"MRI stego terlalu besar. Kapasitas foto: {photo_full_capacity} bytes."
            )

        t2_start = time.perf_counter()
        stego_img = LSBHandler.embed_to_rgb_full(img_photo, mri_stego_img)
        time_layer2 = round(time.perf_counter() - t2_start, 6)

        time_total = round(time_layer1 + time_layer2, 6)

        metrics_l1 = LSBHandler.calculate_metrics(img_mri, mri_stego_img, mode='L')
        nriqa_l1 = LSBHandler.calculate_nriqa_metrics(mri_stego_img, mode='L')

        metrics_l2 = LSBHandler.calculate_metrics(img_photo, stego_img, mode='RGB')
        nriqa_l2 = LSBHandler.calculate_nriqa_metrics(stego_img, mode='RGB')

        return {
            "stego_img": stego_img,
            "mri_stego_img": mri_stego_img,
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
        t2_start = time.perf_counter()
        extracted_mri_img = LSBHandler.extract_from_rgb_full(stego_img)
        time_layer2 = round(time.perf_counter() - t2_start, 6)

        if extracted_mri_img is None:
            raise ValueError("Gagal mengekstrak MRI dari stego.")

        t1_start = time.perf_counter()
        result_l1 = ebs5.extract(extracted_mri_img)
        time_layer1 = round(time.perf_counter() - t1_start, 6)

        decrypted = result_l1["recovered_text"]
        time_total = round(time_layer1 + time_layer2, 6)

        stego_array = np.array(stego_img, dtype=np.uint8)
        cleaned_photo_array = stego_array & np.uint8(0xFE)
        cleaned_photo_img = Image.fromarray(cleaned_photo_array, mode='RGB')

        metrics_l1 = {"mse": 0.0, "psnr": 100.0, "ssim": 1.0}
        if orig_mri_img is not None:
            metrics_l1 = LSBHandler.calculate_metrics(orig_mri_img, extracted_mri_img, mode='L')
        nriqa_l1 = LSBHandler.calculate_nriqa_metrics(extracted_mri_img, mode='L')

        metrics_l2 = {"mse": 0.0, "psnr": 100.0, "ssim": 1.0}
        if orig_photo_img is not None:
            metrics_l2 = LSBHandler.calculate_metrics(orig_photo_img, cleaned_photo_img, mode='RGB')
        nriqa_l2 = LSBHandler.calculate_nriqa_metrics(cleaned_photo_img, mode='RGB')

        return {
            "decrypted": decrypted,
            "extracted_mri_img": extracted_mri_img,
            "cleaned_photo_img": cleaned_photo_img,
            "timing": {
                "layer1_seconds": time_layer1,
                "layer2_seconds": time_layer2,
                "total_seconds": time_total,
            },
            "metrics_l1": {**metrics_l1, **nriqa_l1},
            "metrics_l2": {**metrics_l2, **nriqa_l2},
        }