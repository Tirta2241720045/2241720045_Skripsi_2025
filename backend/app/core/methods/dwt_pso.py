from __future__ import annotations

import numpy as np
import pywt
from PIL import Image

from app.core.methods._shared import (
    _pil_to_cv2_gray,
    _ldpc_encode,
    _ldpc_decode,
)


class _PSO:
    def __init__(
        self,
        n_particles: int,
        n_iter: int,
        band_flat: np.ndarray,
        n_bits: int,
        seed: int = 42,
    ) -> None:
        self.n_particles = n_particles
        self.n_iter = n_iter
        self.band_flat = band_flat
        self.n_bits = n_bits
        self.total_coeff = len(band_flat)
        self.rng = np.random.default_rng(seed)

    def _fitness(self, indices: np.ndarray) -> float:
        selected = self.band_flat[indices]
        energy = np.sum(np.abs(selected))
        return energy

    def optimize(self) -> np.ndarray:
        if self.n_bits > self.total_coeff:
            raise ValueError(
                f"PSO: data terlalu besar. Kapasitas HH: {self.total_coeff} bits, "
                f"dibutuhkan: {self.n_bits} bits."
            )

        positions = self.rng.integers(
            0, self.total_coeff - self.n_bits + 1, size=self.n_particles
        )
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

            velocities = (
                w * velocities
                + c1 * r1 * (personal_best_pos - positions)
                + c2 * r2 * (global_best_pos - positions)
            )

            positions = positions + velocities
            positions = np.clip(
                positions, 0, self.total_coeff - self.n_bits
            ).astype(int)

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

    def _get_indices(self, start: int) -> np.ndarray:
        return np.arange(start, start + self.n_bits, dtype=np.int64)


def dwt_pso_embed(cover_img: Image.Image, payload_text: str) -> Image.Image:
    img_gray = _pil_to_cv2_gray(cover_img).astype(np.float64)
    coeffs = pywt.dwt2(img_gray, "haar")
    cA, (cH, cV, cD) = coeffs

    encoded = _ldpc_encode(payload_text.encode("utf-8"))
    bits = np.unpackbits(np.frombuffer(encoded, dtype=np.uint8))
    n_bits = bits.size

    flat_cD = cD.ravel().copy()

    pso = _PSO(n_particles=15, n_iter=20, band_flat=flat_cD, n_bits=n_bits, seed=1234)
    indices = pso.optimize()

    for i, idx in enumerate(indices):
        coeff_val = flat_cD[idx]
        coeff_int = int(round(coeff_val))
        coeff_int = (coeff_int & ~1) | int(bits[i])
        flat_cD[idx] = float(coeff_int)

    cD_modified = flat_cD.reshape(cD.shape)
    reconstructed = pywt.idwt2((cA, (cH, cV, cD_modified)), "haar")
    reconstructed = np.clip(reconstructed, 0, 255).astype(np.uint8)
    return Image.fromarray(reconstructed, mode="L")


def dwt_pso_extract(stego_img: Image.Image, payload_text: str) -> str:
    img_gray = _pil_to_cv2_gray(stego_img).astype(np.float64)
    _, (_, _, cD) = pywt.dwt2(img_gray, "haar")

    encoded = _ldpc_encode(payload_text.encode("utf-8"))
    bits = np.unpackbits(np.frombuffer(encoded, dtype=np.uint8))
    n_bits = bits.size

    flat_cD = cD.ravel()
    total_coeff = len(flat_cD)

    if n_bits > total_coeff:
        raise ValueError(f"n_bits {n_bits} melebihi kapasitas {total_coeff}")

    pso = _PSO(n_particles=15, n_iter=20, band_flat=flat_cD, n_bits=n_bits, seed=1234)
    indices = pso.optimize()

    extracted_bits = np.array([int(round(flat_cD[idx])) & 1 for idx in indices], dtype=np.uint8)
    n_bytes = n_bits // 8
    packed = np.packbits(extracted_bits[:n_bytes * 8])
    decoded = _ldpc_decode(packed.tobytes())
    return decoded.decode("utf-8", errors="replace")