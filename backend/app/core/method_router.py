from __future__ import annotations

import os
from PIL import Image

from app.core.handler.stegoshield_handler import StegoShieldHandler
from app.core.handler.dwt_pso_handler import DWTPSOHandler
from app.core.handler.ebs3_handler import EBS3Handler
from app.core.handler.ebs5_handler import EBS5Handler
from app.core.handler.ebs9_handler import EBS9Handler

# Daftar metode yang didukung
SUPPORTED_METHODS = ["stegoshield", "dwt_pso", "ebs3", "ebs5", "ebs9"]

AES_KEY = os.getenv("AES_KEY", "SECRET_KEY_STEGOSHIELD_2026")

# Inisialisasi semua handler (singleton)
_handlers = {
    "stegoshield": StegoShieldHandler(AES_KEY),
    "dwt_pso":     DWTPSOHandler(),
    "ebs3":        EBS3Handler(),
    "ebs5":        EBS5Handler(),
    "ebs9":        EBS9Handler(),
}


def get_handler(method: str):
    if method not in _handlers:
        raise ValueError(
            f"Metode '{method}' tidak didukung. "
            f"Pilih salah satu: {', '.join(SUPPORTED_METHODS)}"
        )
    return _handlers[method]


def route_embed(
    method: str,
    img_mri: Image.Image,
    img_photo: Image.Image,
    txt_content: str,
) -> dict:
    """
    Embed teks medis ke dalam gambar menggunakan metode yang dipilih.
    Semua metode menerima input dan menghasilkan output yang sama.

    Returns:
        dict dengan keys: stego_img, mri_stego_img, timing, metrics_l1, metrics_l2
    """
    handler = get_handler(method)
    return handler.embed(img_mri, img_photo, txt_content)


def route_extract(
    method: str,
    stego_img: Image.Image,
    orig_mri_img: Image.Image | None = None,
    orig_photo_img: Image.Image | None = None,
    orig_txt: str | None = None,
) -> dict:
    """
    Ekstrak teks medis dari stego image menggunakan metode yang dipilih.
    Semua metode menerima input dan menghasilkan output yang sama.

    Returns:
        dict dengan keys: decrypted, extracted_mri_img, cleaned_photo_img, timing, metrics_l1, metrics_l2
    """
    handler = get_handler(method)
    return handler.extract(stego_img, orig_mri_img, orig_photo_img, orig_txt)
