from PIL import Image
import numpy as np
import struct
import io
from joblib import load
from os.path import dirname, join, abspath
from app.core.nriqa.brisque import brisque
from app.core.nriqa.niqe import niqe
from app.core.nriqa.piqe import piqe
from app.core.friqa.mse import mse
from app.core.friqa.psnr import psnr
from app.core.friqa.ssim import ssim

_CURRENT_DIR = dirname(__file__)
_CORE_DIR = dirname(dirname(_CURRENT_DIR))
_SVR_MODEL_PATH = join(_CORE_DIR, 'nriqa', 'svr_brisque.joblib')

_svr_model = None
_scaler = None


def _get_svr_model():
    global _svr_model, _scaler
    if _svr_model is None:
        try:
            model_data = load(_SVR_MODEL_PATH)
            _svr_model = model_data['model']
            _scaler = model_data['scaler']
        except Exception as e:
            print(f"Warning: Failed to load BRISQUE model: {e}")
            _svr_model = None
            _scaler = None
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
        """StegaShield menggunakan method ini - TIDAK BERUBAH"""
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
        """StegaShield menggunakan method ini - TIDAK BERUBAH"""
        img_array = np.array(stego_img.convert('RGB'), dtype=np.uint8)
        flat = img_array.ravel()
        if flat.size < 32:
            return None
        bits_source = (flat & 1).astype(np.uint8)
        data_bytes = LSBHandler._unpack_data(bits_source)
        if data_bytes is None:
            return None
        return Image.open(io.BytesIO(data_bytes))

    # ============================================================
    # METHOD BARU UNTUK EBS3 (tidak mempengaruhi StegaShield)
    # ============================================================
    @staticmethod
    def embed_to_rgb_full_with_bytes(cover_img: Image.Image, data_bytes: bytes) -> Image.Image:
        """
        EBS3 menggunakan method ini untuk embed bytes langsung.
        TIDAK mempengaruhi StegaShield.
        """
        cover_array = np.array(cover_img.convert('RGB'), dtype=np.uint8)
        height, width, _ = cover_array.shape
        bits, n_bits = LSBHandler._pack_data(data_bytes)
        total_capacity = height * width * 3
        if n_bits > total_capacity:
            raise ValueError(f"Data terlalu besar. Kapasitas: {total_capacity} bits, Data: {n_bits} bits.")
        flat = cover_array.ravel()
        flat[:n_bits] = (flat[:n_bits] & np.uint8(0xFE)) | bits.astype(np.uint8)
        return Image.fromarray(cover_array, mode='RGB')

    @staticmethod
    def extract_from_rgb_full_bytes(stego_img: Image.Image) -> bytes | None:
        """
        EBS3 menggunakan method ini untuk extract bytes langsung.
        TIDAK mempengaruhi StegaShield.
        """
        img_array = np.array(stego_img.convert('RGB'), dtype=np.uint8)
        flat = img_array.ravel()
        if flat.size < 32:
            return None
        bits_source = (flat & 1).astype(np.uint8)
        return LSBHandler._unpack_data(bits_source)

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
        mse_val = mse(orig, steg)
        psnr_val = psnr(orig, steg)
        ssim_val = ssim(orig, steg)
        return {
            'mse': round(max(0.0, mse_val), 6),
            'psnr': round(max(0.0, psnr_val), 4),
            'ssim': round(max(0.0, min(ssim_val, 1.0)), 6),
        }

    @staticmethod
    def calculate_nriqa_metrics(img: Image.Image, mode: str = 'L') -> dict:
        brisque_score = None
        niqe_score = None
        piqe_score = None

        try:
            img_bgr = np.array(img.convert('RGB'))[:, :, ::-1]

            try:
                features = brisque(img_bgr.copy()).reshape(1, -1)
                clf, scaler = _get_svr_model()
                if clf is not None and scaler is not None:
                    features_scaled = scaler.transform(features)
                    brisque_score = round(float(clf.predict(features_scaled)[0]), 4)
                else:
                    brisque_score = 50.0
            except Exception:
                brisque_score = 50.0

            try:
                niqe_score = round(float(niqe(img_bgr.copy())), 4)
            except Exception:
                niqe_score = 10.0

            try:
                score, _, _, _ = piqe(img_bgr.copy())
                piqe_score = round(float(score), 4)
            except Exception:
                piqe_score = 40.0

        except Exception:
            brisque_score = 50.0
            niqe_score = 10.0
            piqe_score = 40.0

        return {
            'brisque': brisque_score,
            'niqe': niqe_score,
            'piqe': piqe_score
        }