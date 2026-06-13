import time
import io
import numpy as np
from PIL import Image

from app.core.handler.moduls.aes_handler import AESHandler
from app.core.handler.moduls.lsb_handler import LSBHandler

MRI_BORDER_RATIO = 0.15


def _pack_encrypted(encrypted: dict) -> bytes:
    return f"{encrypted['ciphertext']}::{encrypted['iv']}::{encrypted['mac']}".encode('utf-8')


def _unpack_encrypted(raw: str) -> tuple[str, str, str]:
    parts = raw.split("::", 2)
    if len(parts) != 3:
        raise ValueError("Format data tidak valid: diharapkan ciphertext::iv::mac")
    return parts[0], parts[1], parts[2]


class StegoShieldHandler:

    def __init__(self, aes_key: str):
        self.aes = AESHandler(aes_key)

    def get_capacity(self, mri_h: int, mri_w: int) -> int:
        roni_bits = LSBHandler.get_roni_capacity_border(mri_h, mri_w, MRI_BORDER_RATIO)
        return (roni_bits // 8) - 4

    def embed(
        self,
        img_mri: Image.Image,
        img_photo: Image.Image,
        txt_content: str,
    ) -> dict:
        mri_w, mri_h = img_mri.size
        photo_w, photo_h = img_photo.size

        if mri_w > photo_w or mri_h > photo_h:
            raise ValueError(
                f"Ukuran MRI ({mri_w}x{mri_h}) tidak boleh lebih besar "
                f"dari foto pasien ({photo_w}x{photo_h})."
            )

        encrypted = self.aes.encrypt(txt_content)
        data_to_embed = _pack_encrypted(encrypted)

        roni_mri_bytes = self.get_capacity(mri_h, mri_w)
        if len(data_to_embed) > roni_mri_bytes:
            raise ValueError(
                f"Data terlalu besar. Kapasitas RONI MRI: {roni_mri_bytes} bytes."
            )

        t1_start = time.perf_counter()
        mri_stego_img = LSBHandler.embed_to_grayscale_geometric(
            img_mri, data_to_embed, border_ratio=MRI_BORDER_RATIO
        )
        time_layer1 = round(time.perf_counter() - t1_start, 6)

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
        metrics_l2 = LSBHandler.calculate_metrics(img_photo, stego_img, mode='RGB')
        nriqa_l1 = LSBHandler.calculate_nriqa_metrics(mri_stego_img, mode='L')
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
        extracted_bytes = LSBHandler.extract_from_grayscale_geometric(
            extracted_mri_img, border_ratio=MRI_BORDER_RATIO
        )
        time_layer1 = round(time.perf_counter() - t1_start, 6)

        if not extracted_bytes:
            raise ValueError("Gagal menemukan data tersembunyi.")

        time_total = round(time_layer1 + time_layer2, 6)

        raw = extracted_bytes.decode('utf-8')
        ciphertext, iv, mac = _unpack_encrypted(raw)
        decrypted = self.aes.decrypt(ciphertext, iv, mac)

        stego_array = np.array(stego_img, dtype=np.uint8)
        cleaned_photo_array = stego_array & np.uint8(0xFE)
        cleaned_photo_img = Image.fromarray(cleaned_photo_array, mode='RGB')

        metrics_l1 = {"mse": 0.0, "psnr": 100.0, "ssim": 1.0}
        if orig_mri_img is not None:
            metrics_l1 = LSBHandler.calculate_metrics(orig_mri_img, extracted_mri_img, mode='L')

        metrics_l2 = {"mse": 0.0, "psnr": 100.0, "ssim": 1.0}
        if orig_photo_img is not None:
            metrics_l2 = LSBHandler.calculate_metrics(orig_photo_img, cleaned_photo_img, mode='RGB')

        nriqa_l1 = LSBHandler.calculate_nriqa_metrics(extracted_mri_img, mode='L')
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