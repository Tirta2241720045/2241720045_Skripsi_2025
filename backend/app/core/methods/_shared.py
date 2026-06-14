from __future__ import annotations

import math
import numpy as np
import cv2
from PIL import Image
from app.core.nriqa.brisque import brisque
from app.core.nriqa.niqe import niqe
from app.core.nriqa.piqe import piqe


def _pil_to_cv2_gray(img: Image.Image) -> np.ndarray:
    return np.array(img.convert("L"), dtype=np.uint8)


def _pil_to_cv2_rgb(img: Image.Image) -> np.ndarray:
    return np.array(img.convert("RGB"), dtype=np.uint8)


def compute_metrics(original: np.ndarray, stego: np.ndarray) -> dict:
    orig = original.astype(np.float64)
    steg = stego.astype(np.float64)
    if orig.shape != steg.shape:
        steg = cv2.resize(steg.astype(np.float32), (orig.shape[1], orig.shape[0])).astype(np.float64)
    mse_val = float(np.mean((orig - steg) ** 2))
    psnr_val = 100.0 if mse_val == 0 else min(10 * math.log10(255.0 ** 2 / mse_val), 100.0)
    ssim_val = _ssim(orig, steg)
    return {
        "mse": mse_val,
        "psnr": psnr_val,
        "ssim": ssim_val,
    }


def _ssim(a: np.ndarray, b: np.ndarray) -> float:
    C1 = (0.01 * 255) ** 2
    C2 = (0.03 * 255) ** 2
    if a.ndim == 3:
        return float(np.mean([_ssim(a[:, :, c], b[:, :, c]) for c in range(a.shape[2])]))
    mu_a, mu_b = a.mean(), b.mean()
    a_c, b_c = a - mu_a, b - mu_b
    n = a.size
    s2a = float(np.dot(a_c.ravel(), a_c.ravel())) / n
    s2b = float(np.dot(b_c.ravel(), b_c.ravel())) / n
    cov = float(np.dot(a_c.ravel(), b_c.ravel())) / n
    num = (2.0 * mu_a * mu_b + C1) * (2.0 * cov + C2)
    den = (mu_a ** 2 + mu_b ** 2 + C1) * (s2a + s2b + C2)
    return 1.0 if den == 0 else float(num / den)


def compute_nriqa(img: Image.Image) -> dict:
    brisque_score = 0.0
    niqe_score = 0.0
    piqe_score = 0.0

    try:
        img_bgr = np.array(img.convert('RGB'))[:, :, ::-1]

        try:
            brisque_score = brisque(img_bgr.copy())
        except Exception:
            pass

        try:
            niqe_score = float(niqe(img_bgr.copy()))
        except Exception:
            pass

        try:
            score, _, _, _ = piqe(img_bgr.copy())
            piqe_score = float(score)
        except Exception:
            pass

    except Exception:
        pass

    return {'brisque': brisque_score, 'niqe': niqe_score, 'piqe': piqe_score}


def _text_to_bits(text: str) -> np.ndarray:
    data = text.encode("utf-8")
    return np.unpackbits(np.frombuffer(data, dtype=np.uint8))


def _bits_to_text(bits: np.ndarray, n_bytes: int) -> str:
    packed = np.packbits(bits[:n_bytes * 8])
    return packed.tobytes().decode("utf-8", errors="replace")


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


def _get_edge_capacity(img_gray: np.ndarray) -> int:
    return len(_detect_edges(img_gray))


def _embed_to_edges(img_gray: np.ndarray, bits: np.ndarray, edge_indices: np.ndarray) -> np.ndarray:
    stego = img_gray.copy()
    flat = stego.ravel()
    capacity = edge_indices.size
    
    if bits.size > capacity:
        raise ValueError(
            f"EBS: data terlalu besar. Kapasitas edge: {capacity} bits, "
            f"dibutuhkan: {bits.size} bits. "
            f"Gunakan payload yang lebih kecil atau cover image dengan lebih banyak edge."
        )
    
    targets = edge_indices[:bits.size]
    flat[targets] = (flat[targets] & np.uint8(0xFE)) | bits.astype(np.uint8)
    return stego


def _extract_from_edges(stego_gray: np.ndarray, n_bits: int, edge_indices: np.ndarray) -> np.ndarray:
    flat = stego_gray.ravel()
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


def _ldpc_encode(data: bytes) -> bytes:
    if len(data) == 0:
        return b''
    out = bytearray()
    for i in range(0, len(data), 7):
        chunk = data[i:i + 7]
        parity = 0
        for b in chunk:
            parity ^= b
        out.extend(chunk)
        out.append(parity)
    return bytes(out)


def _ldpc_decode(data: bytes) -> bytes:
    if len(data) == 0:
        return b''
    out = bytearray()
    for i in range(0, len(data), 8):
        chunk = data[i:i + 8]
        if len(chunk) == 8:
            out.extend(chunk[:7])
        else:
            out.extend(chunk[:-1] if len(chunk) > 1 else chunk)
    return bytes(out)