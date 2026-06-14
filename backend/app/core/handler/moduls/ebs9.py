from __future__ import annotations

import struct
import time
import numpy as np
import cv2
from PIL import Image

from app.core.handler.moduls.lsb_handler import LSBHandler


def _pil_to_gray(img: Image.Image) -> np.ndarray:
    return np.array(img.convert("L"), dtype=np.uint8)


def _detect_edges_prewitt(img_gray: np.ndarray, threshold: float = 0.025) -> np.ndarray:
    img_float = img_gray.astype(np.float32)
    kernel_x = np.array([[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]], dtype=np.float32)
    kernel_y = np.array([[-1, -1, -1], [0, 0, 0], [1, 1, 1]], dtype=np.float32)
    grad_x = cv2.filter2D(img_float, -1, kernel_x)
    grad_y = cv2.filter2D(img_float, -1, kernel_y)
    magnitude = np.sqrt(grad_x ** 2 + grad_y ** 2)
    thresh_value = threshold * np.max(magnitude)
    edges = magnitude > thresh_value
    return np.flatnonzero(edges.ravel())


def _detect_edges_canny(img_gray: np.ndarray, low: int = 50, high: int = 100) -> np.ndarray:
    edges = cv2.Canny(img_gray, low, high)
    return np.flatnonzero(edges.ravel())


def _detect_edges(img_gray: np.ndarray, min_edges: int = 500) -> np.ndarray:
    indices = _detect_edges_prewitt(img_gray, threshold=0.025)
    if len(indices) < min_edges:
        indices = _detect_edges_canny(img_gray, low=50, high=100)
    if len(indices) < min_edges:
        step = max(1, img_gray.size // min_edges)
        indices = np.arange(0, img_gray.size, step, dtype=np.int64)
    return indices.astype(np.int64)


def _embed_to_edges(img_gray: np.ndarray, bits: np.ndarray, edge_indices: np.ndarray) -> np.ndarray:
    stego = img_gray.copy()
    flat = stego.ravel()
    if bits.size > edge_indices.size:
        raise ValueError(
            f"EBS: data terlalu besar. Kapasitas edge: {edge_indices.size} bits, "
            f"dibutuhkan: {bits.size} bits."
        )
    targets = edge_indices[:bits.size]
    flat[targets] = (flat[targets] & np.uint8(0xFE)) | bits.astype(np.uint8)
    return stego


def _extract_from_edges(stego_gray: np.ndarray, n_bits: int, edge_indices: np.ndarray) -> np.ndarray:
    flat = stego_gray.ravel()
    if n_bits > len(edge_indices):
        raise ValueError(f"Tidak cukup edge. Dibutuhkan: {n_bits}, tersedia: {len(edge_indices)}")
    targets = edge_indices[:n_bits]
    return (flat[targets] & 1).astype(np.uint8)


def _text_to_byte_matrix(text: str) -> np.ndarray:
    import math as _math
    data = text.encode("utf-8")
    n = len(data)
    rows = max(1, _math.ceil(n / 8))
    padded = data + b"\x00" * (rows * 8 - n)
    return np.frombuffer(padded, dtype=np.uint8).reshape(rows, 8)


def _byte_matrix_to_text(matrix: np.ndarray, original_len: int) -> str:
    if matrix.size == 0:
        return ""
    data = matrix.ravel()[:original_len].tobytes()
    return data.decode("utf-8", errors="replace")


def _circular_right_shift_cols(matrix: np.ndarray, shift: int) -> np.ndarray:
    result = matrix.copy()
    shift_mod = shift % matrix.shape[1] if matrix.shape[1] > 0 else 0
    for i in range(result.shape[0]):
        result[i] = np.roll(result[i], shift_mod)
    return result


def _xor_left_right(matrix: np.ndarray) -> np.ndarray:
    result = matrix.copy()
    mid = result.shape[1] // 2
    if mid == 0:
        return result
    left = result[:, :mid].copy()
    right = result[:, mid:].copy()
    result[:, :mid] = left ^ right
    return result


def _xor_left_right_inv(matrix: np.ndarray) -> np.ndarray:
    result = matrix.copy()
    mid = result.shape[1] // 2
    if mid == 0:
        return result
    new_left = result[:, :mid].copy()
    new_right = result[:, mid:].copy()
    left = new_left.copy()
    right = new_right ^ left
    result[:, :mid] = left
    result[:, mid:] = right
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
    """Three way separation sesuai kode lama (safe version)"""
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


def _three_way_separation_inv(matrix: np.ndarray) -> np.ndarray:
    """Inverse three way separation sesuai kode lama (safe version)"""
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


def _permutation_9(matrix: np.ndarray) -> np.ndarray:
    """Permutation untuk EBS9 sesuai kode lama"""
    perm = np.array([2, 6, 0, 4, 1, 5, 3, 7])
    return matrix[:, perm % matrix.shape[1]]


def _permutation_9_inv(matrix: np.ndarray) -> np.ndarray:
    """Inverse permutation untuk EBS9 sesuai kode lama"""
    perm = np.array([2, 6, 0, 4, 1, 5, 3, 7])
    inv = np.argsort(perm % matrix.shape[1])
    return matrix[:, inv]


def _one_iteration_9layer(matrix: np.ndarray) -> np.ndarray:
    """Satu iterasi EBS9 sesuai kode lama"""
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
    """Inverse satu iterasi EBS9 sesuai kode lama"""
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
    """Proses enkripsi EBS9 sesuai kode lama (6 iterasi)"""
    original_len = len(text.encode("utf-8"))
    m = _text_to_byte_matrix(text)
    for _ in range(6):
        m = _one_iteration_9layer(m)
    return m, original_len


def _ebs9_decrypt(matrix: np.ndarray, original_len: int) -> str:
    """Proses dekripsi EBS9 sesuai kode lama (6 iterasi)"""
    m = matrix.copy()
    for _ in range(6):
        m = _one_iteration_9layer_inv(m)
    return _byte_matrix_to_text(m, original_len)


def embed(cover_img: Image.Image, payload_text: str) -> dict:
    cover_gray = _pil_to_gray(cover_img)

    t_start = time.perf_counter()

    edge_indices = _detect_edges(cover_gray)
    encrypted_matrix, original_len = _ebs9_encrypt(payload_text)
    data_bits = np.unpackbits(encrypted_matrix.ravel())
    n_bits = data_bits.size

    # TANPA header (sama seperti kode lama)
    full_bits = data_bits

    stego_arr = _embed_to_edges(cover_gray, full_bits, edge_indices)
    stego_img = Image.fromarray(stego_arr, mode="L")

    t_embed = round(time.perf_counter() - t_start, 6)

    cover_img_pil = Image.fromarray(cover_gray, mode="L")
    fr = LSBHandler.calculate_metrics(cover_img_pil, stego_img, mode='L')
    nr = LSBHandler.calculate_nriqa_metrics(stego_img, mode='L')

    return {
        "stego_img": stego_img,
        "original_len": original_len,
        "n_bits": n_bits,
        "timing": {"embed_seconds": t_embed},
        "metrics": {**fr, **nr},
    }


def extract(stego_img: Image.Image, original_len: int = None, n_bits: int = None) -> dict:
    img_gray = _pil_to_gray(stego_img)

    t_start = time.perf_counter()

    edge_indices = _detect_edges(img_gray)

    # Jika original_len dan n_bits tidak diberikan, kita harus mengekstrak semuanya
    # Ini untuk kompatibilitas dengan cara lama (semua edge digunakan)
    if original_len is None or n_bits is None:
        # Ekstrak semua edge yang tersedia
        total_bits = min(len(edge_indices), img_gray.size)
        all_bits = _extract_from_edges(img_gray, total_bits, edge_indices)
        data_bits = all_bits
        n_bits = len(data_bits)
    else:
        # Ekstrak sesuai dengan panjang yang diketahui
        if len(edge_indices) < n_bits:
            raise ValueError(f"Edge tidak cukup. Dibutuhkan: {n_bits}, tersedia: {len(edge_indices)}")
        data_bits = _extract_from_edges(img_gray, n_bits, edge_indices)

    expected_bytes = (n_bits + 7) // 8
    packed = np.packbits(data_bits[:expected_bytes * 8])

    # Coba tebak original_len dari data jika tidak diberikan
    if original_len is None:
        # Asumsikan semua data adalah teks yang valid
        original_len = len(packed)

    rows = (original_len + 7) // 8
    cols = 8
    expected_matrix_size = rows * cols

    if len(packed) < expected_matrix_size:
        raise ValueError(f"Data tidak cukup. Dibutuhkan: {expected_matrix_size}, tersedia: {len(packed)}")

    matrix = packed[:expected_matrix_size].reshape(rows, cols)
    recovered = _ebs9_decrypt(matrix, original_len)

    t_extract = round(time.perf_counter() - t_start, 6)

    return {
        "recovered_text": recovered,
        "timing": {"extract_seconds": t_extract},
    }