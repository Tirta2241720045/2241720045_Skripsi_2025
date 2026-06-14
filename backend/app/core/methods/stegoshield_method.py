# =============================================================================
# Metode StegaShield — 2-Layer LSB-RONI + AES-CBC-HMAC
# Dipanggil dari benchmark_handler.py seperti metode lainnya.
# =============================================================================

from __future__ import annotations

import io
import os

import numpy as np
from PIL import Image

from app.core.stegoshield_machine import AESHandler, LSBHandler

AES_KEY = os.getenv("AES_KEY", "SECRET_KEY_STEGASHIELD_2026")
_aes = AESHandler(AES_KEY)

MRI_BORDER_RATIO = 0.15


def _pack_encrypted(enc: dict) -> bytes:
    return f"{enc['ciphertext']}::{enc['iv']}::{enc['mac']}".encode("utf-8")


def stegoshield_embed(
    cover_img: Image.Image,
    payload_text: str,
    photo_img: Image.Image | None = None,
) -> Image.Image:
    """
    Layer 1 : embed teks terenkripsi AES ke MRI grayscale (RONI border)
    Layer 2 : embed MRI stego ke foto RGB (full LSB)
    Return   : stego foto RGB

    photo_img : foto pasien RGB asli (opsional).
                Jika diberikan → hasil benchmark apple-to-apple dengan production.
                Jika None      → fallback ke konversi cover_img (dummy).
    """
    img_mri = cover_img.convert("L")
    img_photo = photo_img.convert("RGB") if photo_img is not None else cover_img.convert("RGB")

    encrypted = _aes.encrypt(payload_text)
    data_to_embed = _pack_encrypted(encrypted)

    mri_stego = LSBHandler.embed_to_grayscale_geometric(
        img_mri, data_to_embed, border_ratio=MRI_BORDER_RATIO
    )
    stego_out = LSBHandler.embed_to_rgb_full(img_photo, mri_stego)
    return stego_out


def stegoshield_extract(
    stego_img: Image.Image,
    payload_text: str,
    **kwargs,
) -> str:
    """
    Ekstrak teks dari stego foto RGB → dekripsi AES.
    payload_text dan kwargs tidak dipakai, ada untuk konsistensi signature.
    """
    extracted_mri = LSBHandler.extract_from_rgb_full(stego_img)
    if extracted_mri is None:
        return ""
    raw_bytes = LSBHandler.extract_from_grayscale_geometric(
        extracted_mri, border_ratio=MRI_BORDER_RATIO
    )
    if not raw_bytes:
        return ""
    raw = raw_bytes.decode("utf-8")
    parts = raw.split("::", 2)
    if len(parts) != 3:
        return ""
    return _aes.decrypt(parts[0], parts[1], parts[2])