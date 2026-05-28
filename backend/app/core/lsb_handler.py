from PIL import Image
import numpy as np
import math
import struct
import io
import cv2
from joblib import load
from os.path import dirname, join

from app.core.nriqa.brisque import brisque
from app.core.nriqa.niqe import niqe
from app.core.nriqa.piqe import piqe

_SVR_MODEL_PATH = join(dirname(__file__), 'nriqa', 'svr_brisque.joblib')
_svr_model = None
_scaler = None


def _get_svr_model():
    global _svr_model, _scaler
    if _svr_model is None:
        model_data = load(_SVR_MODEL_PATH)
        _svr_model = model_data['model']
        _scaler = model_data['scaler']
    return _svr_model, _scaler


def _shuffled_indices(indices: np.ndarray) -> np.ndarray:
    perm = np.random.default_rng(1234567890).permutation(len(indices))
    return indices[perm]


class LSBHandler:

    @staticmethod
    def _get_roni_mask_border(height: int, width: int, border_ratio: float = 0.15) -> np.ndarray:
        border_r = max(1, int(height * border_ratio))
        border_c = max(1, int(width * border_ratio))
        mask = np.zeros((height, width), dtype=bool)
        mask[:border_r, :] = True
        mask[-border_r:, :] = True
        mask[:, :border_c] = True
        mask[:, -border_c:] = True
        return mask

    @staticmethod
    def _get_roni_indices_border(height: int, width: int, border_ratio: float = 0.15) -> np.ndarray:
        mask = LSBHandler._get_roni_mask_border(height, width, border_ratio)
        return np.flatnonzero(mask).astype(np.int64)

    @staticmethod
    def get_roni_capacity_border(height: int, width: int, border_ratio: float = 0.15) -> int:
        return int(LSBHandler._get_roni_indices_border(height, width, border_ratio).size)

    @staticmethod
    def _pack_data(data_bytes: bytes) -> tuple:
        full_data = struct.pack('>I', len(data_bytes)) + data_bytes
        bits = np.unpackbits(np.frombuffer(full_data, dtype=np.uint8))
        return bits, bits.size

    @staticmethod
    def _unpack_data(bits_source: np.ndarray) -> bytes | None:
        if bits_source.size < 32:
            return None
        header_bytes = np.packbits(bits_source[:32]).tobytes()
        data_length = struct.unpack('>I', header_bytes)[0]
        total_bits = 32 + data_length * 8
        if total_bits > bits_source.size:
            return None
        return np.packbits(bits_source[32:total_bits]).tobytes()[:data_length]

    @staticmethod
    def embed_to_grayscale_geometric(img: Image.Image, data_bytes: bytes, border_ratio: float = 0.15) -> Image.Image:
        img_array = np.array(img.convert('L'), dtype=np.uint8)
        height, width = img_array.shape
        flat = img_array.ravel()
        bits, n_bits = LSBHandler._pack_data(data_bytes)
        roni_idx = _shuffled_indices(LSBHandler._get_roni_indices_border(height, width, border_ratio))
        if n_bits > roni_idx.size:
            raise ValueError(f"Data terlalu besar. Kapasitas: {roni_idx.size} bits, Data: {n_bits} bits.")
        target_idx = roni_idx[:n_bits]
        flat[target_idx] = (flat[target_idx] & np.uint8(0xFE)) | bits.astype(np.uint8)
        return Image.fromarray(flat.reshape(height, width), mode='L')

    @staticmethod
    def extract_from_grayscale_geometric(img: Image.Image, border_ratio: float = 0.15) -> bytes | None:
        img_array = np.array(img.convert('L'), dtype=np.uint8)
        height, width = img_array.shape
        flat = img_array.ravel()
        roni_idx = _shuffled_indices(LSBHandler._get_roni_indices_border(height, width, border_ratio))
        if roni_idx.size < 32:
            return None
        bits_source = (flat[roni_idx] & 1).astype(np.uint8)
        return LSBHandler._unpack_data(bits_source)

    @staticmethod
    def embed_to_rgb_full(cover_img: Image.Image, secret_img: Image.Image) -> Image.Image:
        cover_array = np.array(cover_img.convert('RGB'), dtype=np.uint8)
        height, width, _ = cover_array.shape
        buf = io.BytesIO()
        secret_img.save(buf, format='PNG', compress_level=3)
        secret_bytes = buf.getvalue()
        bits, n_bits = LSBHandler._pack_data(secret_bytes)
        total_capacity = height * width * 3
        if n_bits > total_capacity:
            raise ValueError(f"Data terlalu besar. Kapasitas: {total_capacity} bits, Data: {n_bits} bits.")
        flat = cover_array.ravel()
        flat[:n_bits] = (flat[:n_bits] & np.uint8(0xFE)) | bits.astype(np.uint8)
        return Image.fromarray(cover_array, mode='RGB')

    @staticmethod
    def extract_from_rgb_full(stego_img: Image.Image) -> Image.Image | None:
        img_array = np.array(stego_img.convert('RGB'), dtype=np.uint8)
        flat = img_array.ravel()
        if flat.size < 32:
            return None
        bits_source = (flat & 1).astype(np.uint8)
        data_bytes = LSBHandler._unpack_data(bits_source)
        if data_bytes is None:
            return None
        return Image.open(io.BytesIO(data_bytes))

    @staticmethod
    def calculate_metrics(orig_img: Image.Image, stego_img: Image.Image, mode: str = 'L') -> dict:
        orig = np.array(orig_img.convert(mode), dtype=np.float64)
        steg = np.array(stego_img.convert(mode), dtype=np.float64)
        if orig.shape != steg.shape:
            steg = np.array(
                stego_img.convert(mode).resize(
                    (orig.shape[1], orig.shape[0]), Image.Resampling.LANCZOS
                ),
                dtype=np.float64,
            )
        mse = float(np.mean((orig - steg) ** 2))
        psnr = 100.0 if mse == 0 else min(10 * math.log10(255.0 ** 2 / mse), 100.0)
        try:
            if mode == 'RGB':
                ssim_val = float(np.mean([
                    LSBHandler._ssim_channel(orig[:, :, c], steg[:, :, c])
                    for c in range(3)
                ]))
            else:
                ssim_val = LSBHandler._ssim_channel(orig, steg)
        except Exception:
            ssim_val = 1.0
        return {
            'mse': round(max(0.0, mse), 6),
            'psnr': round(max(0.0, psnr), 4),
            'ssim': round(max(0.0, min(ssim_val, 1.0)), 6),
        }

    @staticmethod
    def calculate_nriqa_metrics(img: Image.Image, mode: str = 'L') -> dict:
        brisque_score = niqe_score = piqe_score = None
        try:
            img_bgr = np.array(img.convert('RGB'))[:, :, ::-1]

            try:
                features = brisque(img_bgr.copy()).reshape(1, -1)
                clf, scaler = _get_svr_model()
                features_scaled = scaler.transform(features)
                brisque_score = round(float(clf.predict(features_scaled)[0]), 4)
            except Exception:
                pass

            try:
                niqe_score = round(float(niqe(img_bgr.copy())), 4)
            except Exception:
                pass

            try:
                score, _, _, _ = piqe(img_bgr.copy())
                piqe_score = round(float(score), 4)
            except Exception:
                pass

        except Exception:
            pass

        return {'brisque': brisque_score, 'niqe': niqe_score, 'piqe': piqe_score}

    @staticmethod
    def _ssim_channel(a: np.ndarray, b: np.ndarray) -> float:
        C1 = (0.01 * 255) ** 2
        C2 = (0.03 * 255) ** 2
        mu_a = a.mean()
        mu_b = b.mean()
        a_c = a - mu_a
        b_c = b - mu_b
        n = a.size
        s2_a = float(np.dot(a_c.ravel(), a_c.ravel())) / n
        s2_b = float(np.dot(b_c.ravel(), b_c.ravel())) / n
        cov = float(np.dot(a_c.ravel(), b_c.ravel())) / n
        num = (2.0 * mu_a * mu_b + C1) * (2.0 * cov + C2)
        den = (mu_a ** 2 + mu_b ** 2 + C1) * (s2_a + s2_b + C2)
        return 1.0 if den == 0 else float(num / den)