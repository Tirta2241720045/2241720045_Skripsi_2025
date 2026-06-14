from __future__ import annotations

import time
import math
import numpy as np
import cv2
from PIL import Image

from app.core.handler.moduls.lsb_handler import LSBHandler


def _pil_to_gray(img: Image.Image) -> np.ndarray:
    return np.array(img.convert("L"), dtype=np.uint8)


# ---------------------------------------------------------------------------
# Edge detection
# ---------------------------------------------------------------------------

def _detect_edges_prewitt(img_gray: np.ndarray, threshold: float = 0.025) -> np.ndarray:
    img_float = img_gray.astype(np.float32)
    kernel_x = np.array([[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]], dtype=np.float32)
    kernel_y = np.array([[-1, -1, -1], [0, 0, 0], [1, 1, 1]], dtype=np.float32)
    grad_x = cv2.filter2D(img_float, -1, kernel_x)
    grad_y = cv2.filter2D(img_float, -1, kernel_y)
    magnitude = np.sqrt(grad_x ** 2 + grad_y ** 2)
    thresh_value = threshold * np.max(magnitude)
    return np.flatnonzero((magnitude > thresh_value).ravel())


def _detect_edges_canny(img_gray: np.ndarray, low: int = 50, high: int = 100) -> np.ndarray:
    return np.flatnonzero(cv2.Canny(img_gray, low, high).ravel())


def _detect_edges(img_gray: np.ndarray, min_edges: int = 500) -> np.ndarray:
    indices = _detect_edges_prewitt(img_gray, threshold=0.025)
    if len(indices) < min_edges:
        indices = _detect_edges_canny(img_gray, low=50, high=100)
    if len(indices) < min_edges:
        step = max(1, img_gray.size // min_edges)
        indices = np.arange(0, img_gray.size, step, dtype=np.int64)
    return indices.astype(np.int64)


# ---------------------------------------------------------------------------
# Embed / extract
# ---------------------------------------------------------------------------

def _embed_to_edges(
    img_gray: np.ndarray,
    bits: np.ndarray,
    edge_indices: np.ndarray,
) -> np.ndarray:
    stego = img_gray.copy()
    flat  = stego.ravel()
    if bits.size > edge_indices.size:
        raise ValueError(
            f"EBS9: data terlalu besar. "
            f"Kapasitas edge: {edge_indices.size} bits, "
            f"dibutuhkan: {bits.size} bits."
        )
    targets = edge_indices[: bits.size]
    flat[targets] = (flat[targets] & np.uint8(0xFE)) | bits.astype(np.uint8)
    return stego


def _extract_from_edges(
    stego_gray: np.ndarray,
    n_bits: int,
    edge_indices: np.ndarray,
) -> np.ndarray:
    targets = edge_indices[:n_bits]
    return (stego_gray.ravel()[targets] & 1).astype(np.uint8)


# ---------------------------------------------------------------------------
# Matrix helpers
# ---------------------------------------------------------------------------

def _text_to_byte_matrix(text: str) -> np.ndarray:
    data  = text.encode("utf-8")
    n     = len(data)
    rows  = max(1, math.ceil(n / 8))
    padded = data + b"\x00" * (rows * 8 - n)
    return np.frombuffer(padded, dtype=np.uint8).reshape(rows, 8)


def _byte_matrix_to_text(matrix: np.ndarray, original_len: int) -> str:
    if matrix.size == 0:
        return ""
    return matrix.ravel()[:original_len].tobytes().decode("utf-8", errors="replace")


def _circular_right_shift_cols(matrix: np.ndarray, shift: int) -> np.ndarray:
    result    = matrix.copy()
    shift_mod = shift % matrix.shape[1] if matrix.shape[1] > 0 else 0
    for i in range(result.shape[0]):
        result[i] = np.roll(result[i], shift_mod)
    return result


def _xor_left_right(matrix: np.ndarray) -> np.ndarray:
    result = matrix.copy()
    mid    = result.shape[1] // 2
    if mid == 0:
        return result
    result[:, :mid] = result[:, :mid].copy() ^ result[:, mid:].copy()
    return result


def _xor_left_right_inv(matrix: np.ndarray) -> np.ndarray:
    result = matrix.copy()
    mid    = result.shape[1] // 2
    if mid == 0:
        return result
    left  = result[:, :mid].copy()
    result[:, mid:] = result[:, mid:].copy() ^ left
    return result


def _even_odd_interchange(matrix: np.ndarray) -> np.ndarray:
    result = matrix.copy()
    if result.shape[1] < 2:
        return result
    result[:, 0::2], result[:, 1::2] = matrix[:, 1::2].copy(), matrix[:, 0::2].copy()
    return result


def _transpose_matrix(matrix: np.ndarray) -> np.ndarray:
    return matrix.T.copy()


def _three_way_separation(matrix: np.ndarray) -> np.ndarray:
    flat  = matrix.ravel()
    n     = len(flat)
    third = (n + 2) // 3
    if n % 3 != 0:
        flat = np.pad(flat, (0, third * 3 - n), constant_values=0)
    result = np.concatenate([flat[2*third:], flat[:third], flat[third:2*third]])
    return result[:n].reshape(matrix.shape)


def _three_way_separation_inv(matrix: np.ndarray) -> np.ndarray:
    flat  = matrix.ravel()
    n     = len(flat)
    third = (n + 2) // 3
    if n % 3 != 0:
        flat = np.pad(flat, (0, third * 3 - n), constant_values=0)
    result = np.concatenate([flat[third:2*third], flat[2*third:], flat[:third]])
    return result[:n].reshape(matrix.shape)


# ---------------------------------------------------------------------------
# EBS9 permutation & iterations
# ---------------------------------------------------------------------------

def _permutation_9(matrix: np.ndarray) -> np.ndarray:
    perm = np.array([2, 6, 0, 4, 1, 5, 3, 7])
    return matrix[:, perm % matrix.shape[1]]


def _permutation_9_inv(matrix: np.ndarray) -> np.ndarray:
    perm = np.array([2, 6, 0, 4, 1, 5, 3, 7])
    return matrix[:, np.argsort(perm % matrix.shape[1])]


def _one_iteration_9layer(matrix: np.ndarray) -> np.ndarray:
    m = _permutation_9(matrix)
    m = _transpose_matrix(m)
    m = _circular_right_shift_cols(m, 70)
    m = _xor_left_right(m)
    m = _even_odd_interchange(m)
    m = _permutation_9(m)
    m = _transpose_matrix(m)
    m = _three_way_separation(m)
    m = _even_odd_interchange(m)
    return m


def _one_iteration_9layer_inv(matrix: np.ndarray) -> np.ndarray:
    m = _even_odd_interchange(matrix)
    m = _three_way_separation_inv(m)
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


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def embed(cover_img: Image.Image, payload_text: str) -> dict:
    cover_gray = _pil_to_gray(cover_img)

    t_start = time.perf_counter()

    edge_indices      = _detect_edges(cover_gray)
    encrypted_matrix, original_len = _ebs9_encrypt(payload_text)
    data_bits         = np.unpackbits(encrypted_matrix.ravel())

    stego_arr = _embed_to_edges(cover_gray, data_bits, edge_indices)
    stego_img = Image.fromarray(stego_arr, mode="L")

    t_embed = round(time.perf_counter() - t_start, 6)

    cover_pil = Image.fromarray(cover_gray, mode="L")
    fr = LSBHandler.calculate_metrics(cover_pil, stego_img, mode="L")
    nr = LSBHandler.calculate_nriqa_metrics(stego_img, mode="L")

    return {
        "stego_img":    stego_img,
        "original_len": original_len,
        "n_bits":       data_bits.size,
        "timing":       {"embed_seconds": t_embed},
        "metrics":      {**fr, **nr},
    }


def extract(stego_img: Image.Image, original_len: int, n_bits: int) -> dict:
    img_gray     = _pil_to_gray(stego_img)

    t_start = time.perf_counter()

    edge_indices = _detect_edges(img_gray)

    if len(edge_indices) < n_bits:
        raise ValueError(
            f"Edge tidak cukup untuk ekstrak. "
            f"Dibutuhkan: {n_bits} bits, tersedia: {len(edge_indices)} bits."
        )

    extracted_bits = _extract_from_edges(img_gray, n_bits, edge_indices)

    # Reshape ke matrix yang identik dengan saat enkripsi
    rows   = max(1, math.ceil(original_len / 8))
    cols   = 8
    packed = np.packbits(extracted_bits[: rows * cols * 8])
    matrix = packed[: rows * cols].reshape(rows, cols)

    recovered = _ebs9_decrypt(matrix, original_len)

    t_extract = round(time.perf_counter() - t_start, 6)

    return {
        "recovered_text": recovered,
        "timing":         {"extract_seconds": t_extract},
    }