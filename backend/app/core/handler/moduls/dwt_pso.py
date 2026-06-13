from __future__ import annotations

import time
import numpy as np
import cv2
import pywt
from PIL import Image

from app.core.handler.moduls.lsb_handler import LSBHandler


# =============================================================================
# Helpers internal (tanpa metrics)
# =============================================================================

def _pil_to_gray(img: Image.Image) -> np.ndarray:
    return np.array(img.convert("L"), dtype=np.uint8)


# =============================================================================
# LDPC simulation
# =============================================================================

def _ldpc_encode(data: bytes) -> bytes:
    if len(data) == 0:
        return b""
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
        return b""
    out = bytearray()
    for i in range(0, len(data), 8):
        chunk = data[i:i + 8]
        if len(chunk) == 8:
            out.extend(chunk[:7])
        else:
            out.extend(chunk[:-1] if len(chunk) > 1 else chunk)
    return bytes(out)


# =============================================================================
# PSO
# =============================================================================

class _PSO:
    def __init__(self, n_particles: int, n_iter: int, band_flat: np.ndarray, n_bits: int, seed: int = 42) -> None:
        self.n_particles = n_particles
        self.n_iter = n_iter
        self.band_flat = band_flat
        self.n_bits = n_bits
        self.total_coeff = len(band_flat)
        self.rng = np.random.default_rng(seed)

    def _fitness(self, indices: np.ndarray) -> float:
        return float(np.sum(np.abs(self.band_flat[indices])))

    def _get_indices(self, start: int) -> np.ndarray:
        return np.arange(start, start + self.n_bits, dtype=np.int64)

    def optimize(self) -> np.ndarray:
        if self.n_bits > self.total_coeff:
            raise ValueError(
                f"PSO: data terlalu besar. Kapasitas HH: {self.total_coeff} bits, "
                f"dibutuhkan: {self.n_bits} bits."
            )
        positions = self.rng.integers(0, self.total_coeff - self.n_bits + 1, size=self.n_particles)
        velocities = self.rng.uniform(-50, 50, size=self.n_particles)
        personal_best_pos = positions.copy()
        personal_best_fitness = np.array([self._fitness(self._get_indices(p)) for p in positions])
        global_best_idx = np.argmin(personal_best_fitness)
        global_best_pos = personal_best_pos[global_best_idx]
        global_best_fitness = personal_best_fitness[global_best_idx]
        w, c1, c2 = 0.5, 1.5, 1.5
        for _ in range(self.n_iter):
            r1 = self.rng.uniform(size=self.n_particles)
            r2 = self.rng.uniform(size=self.n_particles)
            velocities = w * velocities + c1 * r1 * (personal_best_pos - positions) + c2 * r2 * (global_best_pos - positions)
            positions = np.clip(positions + velocities, 0, self.total_coeff - self.n_bits).astype(int)
            for i in range(self.n_particles):
                fitness = self._fitness(self._get_indices(positions[i]))
                if fitness < personal_best_fitness[i]:
                    personal_best_fitness[i] = fitness
                    personal_best_pos[i] = positions[i]
            current_best_idx = np.argmin(personal_best_fitness)
            if personal_best_fitness[current_best_idx] < global_best_fitness:
                global_best_fitness = personal_best_fitness[current_best_idx]
                global_best_pos = personal_best_pos[current_best_idx]
        return self._get_indices(global_best_pos)


# =============================================================================
# Public API
# =============================================================================

def embed(cover_img: Image.Image, payload_text: str) -> dict:
    cover_gray = _pil_to_gray(cover_img)
    img_float = cover_gray.astype(np.float64)

    t_start = time.perf_counter()

    coeffs = pywt.dwt2(img_float, "haar")
    cA, (cH, cV, cD) = coeffs
    encoded = _ldpc_encode(payload_text.encode("utf-8"))
    bits = np.unpackbits(np.frombuffer(encoded, dtype=np.uint8))
    n_bits = bits.size
    flat_cD = cD.ravel().copy()
    pso = _PSO(n_particles=15, n_iter=20, band_flat=flat_cD, n_bits=n_bits, seed=1234)
    indices = pso.optimize()
    for i, idx in enumerate(indices):
        coeff_int = (int(round(flat_cD[idx])) & ~1) | int(bits[i])
        flat_cD[idx] = float(coeff_int)
    cD_modified = flat_cD.reshape(cD.shape)
    reconstructed = pywt.idwt2((cA, (cH, cV, cD_modified)), "haar")
    reconstructed = np.clip(reconstructed, 0, 255).astype(np.uint8)
    stego_img = Image.fromarray(reconstructed, mode="L")

    t_embed = round(time.perf_counter() - t_start, 6)

    # Gunakan LSBHandler untuk metrics
    cover_img_pil = Image.fromarray(cover_gray, mode="L")
    fr = LSBHandler.calculate_metrics(cover_img_pil, stego_img, mode='L')
    nr = LSBHandler.calculate_nriqa_metrics(stego_img, mode='L')

    return {
        "stego_img": stego_img,
        "timing": {"embed_seconds": t_embed},
        "metrics": {**fr, **nr},
    }


def extract(stego_img: Image.Image, payload_text: str) -> dict:
    img_gray = _pil_to_gray(stego_img)

    t_start = time.perf_counter()

    _, (_, _, cD) = pywt.dwt2(img_gray.astype(np.float64), "haar")
    encoded = _ldpc_encode(payload_text.encode("utf-8"))
    bits = np.unpackbits(np.frombuffer(encoded, dtype=np.uint8))
    n_bits = bits.size
    flat_cD = cD.ravel()
    if n_bits > len(flat_cD):
        raise ValueError(f"n_bits {n_bits} melebihi kapasitas {len(flat_cD)}")
    pso = _PSO(n_particles=15, n_iter=20, band_flat=flat_cD, n_bits=n_bits, seed=1234)
    indices = pso.optimize()
    extracted_bits = np.array([int(round(flat_cD[idx])) & 1 for idx in indices], dtype=np.uint8)
    n_bytes = n_bits // 8
    packed = np.packbits(extracted_bits[:n_bytes * 8])
    decoded = _ldpc_decode(packed.tobytes())
    recovered = decoded.decode("utf-8", errors="replace")

    t_extract = round(time.perf_counter() - t_start, 6)

    return {
        "recovered_text": recovered,
        "timing": {"extract_seconds": t_extract},
    }