import time
import os
import pytest
import numpy as np
from PIL import Image
import pandas as pd

from app.core.aes_handler import AESHandler
from app.core.lsb_handler import LSBHandler

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(BASE_DIR, "results")
os.makedirs(RESULTS_DIR, exist_ok=True)

EXCEL_OUTPUT = os.path.join(RESULTS_DIR, "performance_testing_lengkap.xlsx")

MRI_SIZES     = [400, 512, 600]
PHOTO_SIZES   = [1200, 1500, 2000]
DATA_SIZES_KB = [1, 5, 10]

embedding_results  = []
extraction_results = []
layer1_results     = []
layer2_results     = []


def _cap_data_to_roni(mri_size: int, data_kb: int, aes) -> bytes:
    capacity_bytes = (LSBHandler.get_roni_capacity(mri_size, mri_size) // 8) - 4
    plaintext_raw  = generate_data(data_kb)

    encrypted      = aes.encrypt(plaintext_raw)
    candidate      = f"{encrypted['ciphertext']}::{encrypted['iv']}".encode()

    if len(candidate) <= capacity_bytes:
        return candidate

    lo, hi = 0, len(plaintext_raw)
    while lo < hi:
        mid       = (lo + hi + 1) // 2
        enc_try   = aes.encrypt(plaintext_raw[:mid])
        candidate = f"{enc_try['ciphertext']}::{enc_try['iv']}".encode()
        if len(candidate) <= capacity_bytes:
            lo = mid
        else:
            hi = mid - 1

    enc_final = aes.encrypt(plaintext_raw[:lo])
    return f"{enc_final['ciphertext']}::{enc_final['iv']}".encode()


def generate_mri(size, tmp_dir, suffix=""):
    path = str(tmp_dir / f"mri_{size}{suffix}.png")
    arr  = np.random.randint(0, 256, (size, size), dtype=np.uint8)
    Image.fromarray(arr, mode='L').save(path, 'PNG')
    return path


def generate_photo(size, tmp_dir, suffix=""):
    path = str(tmp_dir / f"photo_{size}{suffix}.png")
    arr  = np.random.randint(0, 256, (size, size, 3), dtype=np.uint8)
    Image.fromarray(arr, mode='RGB').save(path, 'PNG')
    return path


def generate_data(kb: int) -> str:
    return ("Data rekam medis pasien. " * (kb * 50))[: kb * 1024]


class TestPerformance:

    @pytest.mark.parametrize("data_kb",    DATA_SIZES_KB)
    @pytest.mark.parametrize("photo_size", PHOTO_SIZES)
    @pytest.mark.parametrize("mri_size",   MRI_SIZES)
    def test_waktu_embedding(self, mri_size, photo_size, data_kb, tmp_dir, aes):
        mri_path   = generate_mri(mri_size, tmp_dir,
                                  suffix=f"_emb_{mri_size}_{photo_size}_{data_kb}")
        photo_path = generate_photo(photo_size, tmp_dir,
                                    suffix=f"_emb_{photo_size}_{mri_size}_{data_kb}")

        data_to_embed = _cap_data_to_roni(mri_size, data_kb, aes)
        actual_kb     = round(len(data_to_embed) / 1024, 2)

        mri_stego   = str(tmp_dir / f"mri_stego_emb_{mri_size}_{data_kb}.png")
        stego_final = str(tmp_dir / f"stego_final_emb_{mri_size}_{photo_size}_{data_kb}.png")

        start = time.perf_counter()
        LSBHandler.embed_to_grayscale(mri_path, data_to_embed, mri_stego)
        LSBHandler.embed_to_rgb(photo_path, mri_stego, stego_final)
        durasi = round(time.perf_counter() - start, 4)

        embedding_results.append({
            'MRI (px)'           : f"{mri_size}×{mri_size}",
            'Foto (px)'          : f"{photo_size}×{photo_size}",
            'Data Target (KB)'   : data_kb,
            'Data Aktual (KB)'   : actual_kb,
            'Waktu (detik)'      : durasi,
        })

        assert os.path.exists(stego_final)

    @pytest.mark.parametrize("data_kb",    DATA_SIZES_KB)
    @pytest.mark.parametrize("photo_size", PHOTO_SIZES)
    @pytest.mark.parametrize("mri_size",   MRI_SIZES)
    def test_waktu_extraction(self, mri_size, photo_size, data_kb, tmp_dir, aes):
        mri_path   = generate_mri(mri_size, tmp_dir,
                                  suffix=f"_ext_{mri_size}_{photo_size}_{data_kb}")
        photo_path = generate_photo(photo_size, tmp_dir,
                                    suffix=f"_ext_{photo_size}_{mri_size}_{data_kb}")

        data_to_embed = _cap_data_to_roni(mri_size, data_kb, aes)
        actual_kb     = round(len(data_to_embed) / 1024, 2)

        mri_stego   = str(tmp_dir / f"mri_stego_ext_{mri_size}_{photo_size}_{data_kb}.png")
        stego_final = str(tmp_dir / f"stego_final_ext_{mri_size}_{photo_size}_{data_kb}.png")
        ext_mri     = str(tmp_dir / f"ext_mri_{mri_size}_{photo_size}_{data_kb}.png")

        LSBHandler.embed_to_grayscale(mri_path, data_to_embed, mri_stego)
        LSBHandler.embed_to_rgb(photo_path, mri_stego, stego_final)

        start = time.perf_counter()
        LSBHandler.extract_from_rgb(stego_final, ext_mri)
        LSBHandler.extract_from_grayscale(ext_mri)
        durasi = round(time.perf_counter() - start, 4)

        extraction_results.append({
            'MRI (px)'           : f"{mri_size}×{mri_size}",
            'Foto (px)'          : f"{photo_size}×{photo_size}",
            'Data Target (KB)'   : data_kb,
            'Data Aktual (KB)'   : actual_kb,
            'Waktu (detik)'      : durasi,
        })

        assert os.path.exists(ext_mri)

    @pytest.mark.parametrize("data_kb",  DATA_SIZES_KB)
    @pytest.mark.parametrize("mri_size", MRI_SIZES)
    def test_metrik_layer1(self, mri_size, data_kb, tmp_dir, aes):
        mri_path = generate_mri(mri_size, tmp_dir,
                                suffix=f"_m1_{mri_size}_{data_kb}")

        data_to_embed = _cap_data_to_roni(mri_size, data_kb, aes)
        actual_kb     = round(len(data_to_embed) / 1024, 2)

        mri_stego = str(tmp_dir / f"mri_stego_m1_{mri_size}_{data_kb}.png")
        LSBHandler.embed_to_grayscale(mri_path, data_to_embed, mri_stego)

        metrics = LSBHandler.calculate_metrics(mri_path, mri_stego, mode='L')

        layer1_results.append({
            'MRI (px)'         : f"{mri_size}×{mri_size}",
            'Data Target (KB)' : data_kb,
            'Data Aktual (KB)' : actual_kb,
            'PSNR (dB)'        : round(metrics['psnr'], 2),
            'SSIM'             : round(metrics['ssim'], 4),
            'MSE'              : round(metrics['mse'],  6),
        })

        assert metrics['psnr'] > 30.0
        assert metrics['ssim'] > 0.9

    @pytest.mark.parametrize("mri_size",   MRI_SIZES)
    @pytest.mark.parametrize("photo_size", PHOTO_SIZES)
    def test_metrik_layer2(self, photo_size, mri_size, tmp_dir, aes):
        mri_path   = generate_mri(mri_size, tmp_dir,
                                  suffix=f"_m2_{mri_size}_{photo_size}")
        photo_path = generate_photo(photo_size, tmp_dir,
                                    suffix=f"_m2_{photo_size}_{mri_size}")

        encrypted     = aes.encrypt("Data test metrik layer 2")
        data_to_embed = f"{encrypted['ciphertext']}::{encrypted['iv']}".encode()

        mri_stego   = str(tmp_dir / f"mri_stego_m2_{mri_size}_{photo_size}.png")
        stego_final = str(tmp_dir / f"stego_final_m2_{photo_size}_{mri_size}.png")

        LSBHandler.embed_to_grayscale(mri_path, data_to_embed, mri_stego)
        LSBHandler.embed_to_rgb(photo_path, mri_stego, stego_final)

        metrics = LSBHandler.calculate_metrics(photo_path, stego_final, mode='RGB')

        layer2_results.append({
            'Foto (px)': f"{photo_size}×{photo_size}",
            'MRI (px)' : f"{mri_size}×{mri_size}",
            'PSNR (dB)': round(metrics['psnr'], 2),
            'SSIM'     : round(metrics['ssim'], 4),
            'MSE'      : round(metrics['mse'],  6),
        })

        assert metrics['psnr'] > 30.0
        assert metrics['ssim'] > 0.9