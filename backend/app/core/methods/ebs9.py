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
    _transpose_matrix,
    _detect_edges,
    _embed_to_edges,
    _extract_from_edges,
)


def _permutation_9(matrix: np.ndarray) -> np.ndarray:
    perm = np.array([2, 6, 0, 4, 1, 5, 3, 7])
    return matrix[:, perm % matrix.shape[1]]


def _permutation_9_inv(matrix: np.ndarray) -> np.ndarray:
    perm = np.array([2, 6, 0, 4, 1, 5, 3, 7])
    inv = np.argsort(perm % matrix.shape[1])
    return matrix[:, inv]


def _three_way_separation_safe(matrix: np.ndarray) -> np.ndarray:
    flat = matrix.ravel()
    n = len(flat)
    third = (n + 2) // 3
    padded = False

    if n % 3 != 0:
        pad_size = third * 3 - n
        flat = np.pad(flat, (0, pad_size), constant_values=0)
        padded = True

    part1 = flat[:third]
    part2 = flat[third:2 * third]
    part3 = flat[2 * third:]

    result = np.concatenate([part3, part1, part2])

    if padded:
        result = result[:n]

    return result.reshape(matrix.shape)


def _three_way_separation_inv_safe(matrix: np.ndarray) -> np.ndarray:
    flat = matrix.ravel()
    n = len(flat)
    third = (n + 2) // 3
    padded = False

    if n % 3 != 0:
        pad_size = third * 3 - n
        flat = np.pad(flat, (0, pad_size), constant_values=0)
        padded = True

    part3 = flat[:third]
    part1 = flat[third:2 * third]
    part2 = flat[2 * third:]

    result = np.concatenate([part1, part2, part3])

    if padded:
        result = result[:n]

    return result.reshape(matrix.shape)


def _one_iteration_9layer(matrix: np.ndarray) -> np.ndarray:
    m = _permutation_9(matrix)
    m = _transpose_matrix(m)
    m = _circular_right_shift_cols(m, 70)
    m = _xor_left_right(m)
    m = _even_odd_interchange(m)
    m = _permutation_9(m)
    m = _transpose_matrix(m)
    m = _three_way_separation_safe(m)
    m = _even_odd_interchange(m)
    return m


def _one_iteration_9layer_inv(matrix: np.ndarray) -> np.ndarray:
    m = _even_odd_interchange(matrix)
    m = _three_way_separation_inv_safe(m)
    m = _transpose_matrix(m)
    m = _permutation_9_inv(m)
    m = _even_odd_interchange(m)
    m = _xor_left_right_inv(m)
    m = _circular_right_shift_cols(m, -70)
    m = _transpose_matrix(m)
    m = _permutation_9_inv(m)
    return m


def _ebs9_encrypt(text: str) -> tuple[np.ndarray, int]:
    original_len = len(text.encode("utf-8"))
    m = _text_to_byte_matrix(text)
    for _ in range(6):
        m = _one_iteration_9layer(m)
    return m, original_len


def _ebs9_decrypt(matrix: np.ndarray, original_len: int) -> str:
    m = matrix.copy()
    for _ in range(6):
        m = _one_iteration_9layer_inv(m)
    return _byte_matrix_to_text(m, original_len)


def ebs9_embed(cover_img: Image.Image, payload_text: str) -> Image.Image:
    img_gray = _pil_to_cv2_gray(cover_img)
    edge_indices = _detect_edges(img_gray)
    encrypted_matrix, _ = _ebs9_encrypt(payload_text)
    bits = np.unpackbits(encrypted_matrix.ravel())
    stego = _embed_to_edges(img_gray, bits, edge_indices)
    return Image.fromarray(stego, mode="L")


def ebs9_extract(stego_img: Image.Image, payload_text: str) -> str:
    img_gray = _pil_to_cv2_gray(stego_img)
    edge_indices = _detect_edges(img_gray)
    encrypted_matrix, original_len = _ebs9_encrypt(payload_text)
    n_bits = np.unpackbits(encrypted_matrix.ravel()).size
    extracted_bits = _extract_from_edges(img_gray, n_bits, edge_indices)
    n_bytes = n_bits // 8
    packed = np.packbits(extracted_bits[:n_bytes * 8])
    rows = encrypted_matrix.shape[0]
    cols = encrypted_matrix.shape[1]
    matrix = packed[:rows * cols].reshape(rows, cols)
    return _ebs9_decrypt(matrix, original_len)