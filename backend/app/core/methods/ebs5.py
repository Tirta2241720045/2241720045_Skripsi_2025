from __future__ import annotations

import numpy as np
from PIL import Image

from app.core.methods._shared import (
    _pil_to_cv2_gray,
    _text_to_byte_matrix,
    _byte_matrix_to_text,
    _circular_right_shift_cols,
    _xor_left_right,
    _xor_left_right_inv,
    _even_odd_interchange,
    _detect_edges,
    _embed_to_edges,
    _extract_from_edges,
)


def _initial_permutation_5(matrix: np.ndarray) -> np.ndarray:
    perm = np.array([1, 5, 3, 7, 2, 6, 0, 4])
    return matrix[:, perm % matrix.shape[1]]


def _initial_permutation_5_inv(matrix: np.ndarray) -> np.ndarray:
    perm = np.array([1, 5, 3, 7, 2, 6, 0, 4])
    inv = np.argsort(perm % matrix.shape[1])
    return matrix[:, inv]


def _ebs5_encrypt(text: str) -> tuple[np.ndarray, int]:
    original_len = len(text.encode("utf-8"))
    m = _text_to_byte_matrix(text)

    m = _initial_permutation_5(m)
    m = _circular_right_shift_cols(m, 4)
    m = _xor_left_right(m)
    m = _even_odd_interchange(m)
    m = _initial_permutation_5_inv(m)

    return m, original_len


def _ebs5_decrypt(matrix: np.ndarray, original_len: int) -> str:
    m = matrix.copy()

    m = _initial_permutation_5(m)
    m = _even_odd_interchange(m)
    m = _xor_left_right_inv(m)
    m = _circular_right_shift_cols(m, -4)
    m = _initial_permutation_5_inv(m)

    return _byte_matrix_to_text(m, original_len)


def ebs5_embed(cover_img: Image.Image, payload_text: str) -> Image.Image:
    img_gray = _pil_to_cv2_gray(cover_img)
    edge_indices = _detect_edges(img_gray)
    encrypted_matrix, _ = _ebs5_encrypt(payload_text)
    bits = np.unpackbits(encrypted_matrix.ravel())
    stego = _embed_to_edges(img_gray, bits, edge_indices)
    return Image.fromarray(stego, mode="L")


def ebs5_extract(stego_img: Image.Image, payload_text: str) -> str:
    img_gray = _pil_to_cv2_gray(stego_img)
    edge_indices = _detect_edges(img_gray)
    encrypted_matrix, original_len = _ebs5_encrypt(payload_text)
    n_bits = np.unpackbits(encrypted_matrix.ravel()).size
    extracted_bits = _extract_from_edges(img_gray, n_bits, edge_indices)
    n_bytes = n_bits // 8
    packed = np.packbits(extracted_bits[:n_bytes * 8])
    rows = encrypted_matrix.shape[0]
    cols = encrypted_matrix.shape[1]
    matrix = packed[:rows * cols].reshape(rows, cols)
    return _ebs5_decrypt(matrix, original_len)