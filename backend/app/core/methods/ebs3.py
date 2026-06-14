from __future__ import annotations

import numpy as np
from PIL import Image

from app.core.methods._shared import (
    _pil_to_cv2_gray,
    _text_to_byte_matrix,
    _byte_matrix_to_text,
    _circular_right_shift_cols,
    _detect_edges,
    _embed_to_edges,
    _extract_from_edges,
)


_RNG_SBOX = np.random.default_rng(20240101)
_SBOX = _RNG_SBOX.permutation(256).astype(np.uint8)
_SBOX_INV = np.argsort(_SBOX).astype(np.uint8)


def _apply_sbox(matrix: np.ndarray, box: np.ndarray) -> np.ndarray:
    return box[matrix]


def _ebs3_encrypt(text: str) -> tuple[np.ndarray, int]:
    original_len = len(text.encode("utf-8"))
    m = _text_to_byte_matrix(text)

    m = _apply_sbox(m, _SBOX)
    m = _circular_right_shift_cols(m, 4)

    mid = m.shape[1] // 2
    left = m[:, :mid].copy()
    right = m[:, mid:].copy()
    new_right = right ^ left
    m = m.copy()
    m[:, :mid] = left
    m[:, mid:] = new_right

    return m, original_len


def _ebs3_decrypt(matrix: np.ndarray, original_len: int) -> str:
    m = matrix.copy()

    mid = m.shape[1] // 2
    new_left = m[:, :mid].copy()
    new_right = m[:, mid:].copy()
    left = new_left.copy()
    right = new_right ^ left
    m[:, :mid] = left
    m[:, mid:] = right

    m = _circular_right_shift_cols(m, -4)
    m = _apply_sbox(m, _SBOX_INV)

    return _byte_matrix_to_text(m, original_len)


def ebs3_embed(cover_img: Image.Image, payload_text: str) -> Image.Image:
    img_gray = _pil_to_cv2_gray(cover_img)
    edge_indices = _detect_edges(img_gray)
    encrypted_matrix, _ = _ebs3_encrypt(payload_text)
    bits = np.unpackbits(encrypted_matrix.ravel())
    stego = _embed_to_edges(img_gray, bits, edge_indices)
    return Image.fromarray(stego, mode="L")


def ebs3_extract(stego_img: Image.Image, payload_text: str) -> str:
    img_gray = _pil_to_cv2_gray(stego_img)
    edge_indices = _detect_edges(img_gray)
    encrypted_matrix, original_len = _ebs3_encrypt(payload_text)
    n_bits = np.unpackbits(encrypted_matrix.ravel()).size
    extracted_bits = _extract_from_edges(img_gray, n_bits, edge_indices)
    n_bytes = n_bits // 8
    packed = np.packbits(extracted_bits[:n_bytes * 8])
    rows, cols = encrypted_matrix.shape
    matrix = packed[:rows * cols].reshape(rows, cols)
    return _ebs3_decrypt(matrix, original_len)