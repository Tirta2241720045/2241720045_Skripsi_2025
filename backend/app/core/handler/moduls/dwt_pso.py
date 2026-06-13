from __future__ import annotations

import math
import time
import struct
import numpy as np
import cv2
import pywt
from PIL import Image

from app.core.handler.moduls.lsb_handler import LSBHandler


def _pil_to_gray(img: Image.Image) -> np.ndarray:
    return np.array(img.convert("L"), dtype=np.uint8)


def _compute_metrics(original: np.ndarray, stego: np.ndarray) -> dict:
    orig = original.astype(np.float64)
    steg = stego.astype(np.float64)
    if orig.shape != steg.shape:
        steg = cv2.resize(steg.astype(np.float32), (orig.shape[1], orig.shape[0])).astype(np.float64)
    mse = float(np.mean((orig - steg) ** 2))
    psnr = 100.0 if mse == 0 else min(10 * math.log10(255.0 ** 2 / mse), 100.0)
    ssim = _ssim(orig, steg)
    return {
        "mse": round(mse, 6),
        "psnr": round(psnr, 4),
        "ssim": round(max(0.0, min(ssim, 1.0)), 6),
    }


def _ssim(a: np.ndarray, b: np.ndarray) -> float:
    C1 = (0.01 * 255) ** 2
    C2 = (0.03 * 255) ** 2
    mu_a, mu_b = a.mean(), b.mean()
    a_c, b_c = a - mu_a, b - mu_b
    n = a.size
    s2a = float(np.dot(a_c.ravel(), a_c.ravel())) / n
    s2b = float(np.dot(b_c.ravel(), b_c.ravel())) / n
    cov = float(np.dot(a_c.ravel(), b_c.ravel())) / n
    num = (2.0 * mu_a * mu_b + C1) * (2.0 * cov + C2)
    den = (mu_a ** 2 + mu_b ** 2 + C1) * (s2a + s2b + C2)
    return 1.0 if den == 0 else float(num / den)


def _compute_nriqa(img: Image.Image) -> dict:
    brisque = niqe = piqe = None
    try:
        import torch
        import pyiqa
        img_np = np.array(img.convert("RGB")).astype(np.float32) / 255.0
        tensor = torch.from_numpy(img_np).permute(2, 0, 1).unsqueeze(0)
        for name, kwargs in [
            ("brisque", {"test_y_channel": True}),
            ("niqe", {"test_y_channel": True}),
            ("piqe", {}),
        ]:
            try:
                metric = pyiqa.create_metric(name, device="cpu", **kwargs)
                score = round(metric(tensor).item(), 4)
                if name == "brisque":
                    brisque = score
                elif name == "niqe":
                    niqe = score
                else:
                    piqe = score
            except Exception:
                pass
    except Exception:
        pass
    return {"brisque": brisque, "niqe": niqe, "piqe": piqe}


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


def embed(cover_img: Image.Image, payload_text: str) -> dict:
    cover_gray = _pil_to_gray(cover_img)
    img_float = cover_gray.astype(np.float64)

    t_start = time.perf_counter()

    coeffs = pywt.dwt2(img_float, "haar")
    cA, (cH, cV, cD) = coeffs
    
    data_bytes = payload_text.encode("utf-8")
    data_length = len(data_bytes)
    header = struct.pack('>I', data_length)
    full_data = header + data_bytes
    
    encoded = _ldpc_encode(full_data)
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

    cover_img_pil = Image.fromarray(cover_gray, mode="L")
    fr = LSBHandler.calculate_metrics(cover_img_pil, stego_img, mode='L')
    nr = LSBHandler.calculate_nriqa_metrics(stego_img, mode='L')

    return {
        "stego_img": stego_img,
        "timing": {"embed_seconds": t_embed},
        "metrics": {**fr, **nr},
    }


def extract(stego_img: Image.Image, payload_text: str = None) -> dict:
    img_gray = _pil_to_gray(stego_img)

    t_start = time.perf_counter()

    _, (_, _, cD) = pywt.dwt2(img_gray.astype(np.float64), "haar")
    flat_cD = cD.ravel()
    
    max_capacity = len(flat_cD)
    search_bits = min(max_capacity, 10000)
    
    pso = _PSO(n_particles=15, n_iter=20, band_flat=flat_cD, n_bits=search_bits, seed=1234)
    indices = pso.optimize()
    
    extracted_bits = np.array([int(round(flat_cD[idx])) & 1 for idx in indices], dtype=np.uint8)
    
    if len(extracted_bits) < 32:
        raise ValueError("Gagal mengekstrak header. Data terlalu pendek atau tidak valid.")
    
    header_bits = extracted_bits[:32]
    header_bytes = np.packbits(header_bits).tobytes()
    data_length = struct.unpack('>I', header_bytes)[0]
    
    if data_length <= 0 or data_length > 100000:
        raise ValueError(f"Panjang data tidak valid: {data_length}. Ekstraksi gagal.")
    
    total_bits_needed = 32 + (data_length * 8)
    
    if total_bits_needed > len(extracted_bits):
        remaining = total_bits_needed - len(extracted_bits)
        if remaining <= len(flat_cD) - search_bits:
            additional_indices = np.arange(search_bits, search_bits + remaining, dtype=np.int64)
            additional_bits = np.array([int(round(flat_cD[idx])) & 1 for idx in additional_indices], dtype=np.uint8)
            extracted_bits = np.concatenate([extracted_bits, additional_bits])
    
    if len(extracted_bits) < total_bits_needed:
        raise ValueError(f"Bit tidak mencukupi. Dibutuhkan: {total_bits_needed}, tersedia: {len(extracted_bits)}")
    
    data_bits = extracted_bits[32:total_bits_needed]
    
    n_bytes = (len(data_bits) + 7) // 8
    packed = np.packbits(data_bits[:n_bytes * 8])
    
    decoded = _ldpc_decode(packed.tobytes())
    recovered = decoded[:data_length].decode("utf-8", errors="replace")

    t_extract = round(time.perf_counter() - t_start, 6)

    return {
        "recovered_text": recovered,
        "timing": {"extract_seconds": t_extract},
    }