from __future__ import annotations

from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from Crypto.Random import get_random_bytes
import base64
import hashlib
import hmac
import unicodedata

from PIL import Image
import numpy as np
import struct
import io
from joblib import load
from os.path import dirname, join
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
        except Exception:
            _svr_model = None
            _scaler = None
    return _svr_model, _scaler


class AESHandler:
    def __init__(self, key: str):
        if not key or len(key) == 0:
            raise ValueError("AES key cannot be empty")

        key_bytes = key.encode('utf-8')
        self.enc_key = hashlib.sha256(key_bytes).digest()[:16]
        self.mac_key = hashlib.sha256(key_bytes + b'mac').digest()

    def _normalize_plaintext(self, plaintext: str) -> str:
        text = unicodedata.normalize('NFC', plaintext)
        replacements = {
            '\u201c': '"', '\u201d': '"',
            '\u2018': "'", '\u2019': "'",
            '\u2014': '-', '\u2013': '-',
            '\u2026': '...', '\u00a0': ' ',
            '\u200b': '', '\u200c': '', '\u200d': '',
        }
        for src, dst in replacements.items():
            text = text.replace(src, dst)
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        return text

    def _compute_hmac(self, ciphertext_b64: str, iv_b64: str) -> str:
        message = (ciphertext_b64 + "::" + iv_b64).encode('utf-8')
        return base64.b64encode(
            hmac.new(self.mac_key, message, hashlib.sha256).digest()
        ).decode('utf-8')

    def _verify_hmac(self, ciphertext_b64: str, iv_b64: str, mac_b64: str) -> None:
        if not mac_b64:
            raise ValueError("MAC tidak boleh kosong")
        expected = self._compute_hmac(ciphertext_b64, iv_b64)
        if not hmac.compare_digest(expected, mac_b64):
            raise ValueError("Verifikasi integritas data gagal: data mungkin telah dimanipulasi.")

    def encrypt(self, plaintext: str) -> dict:
        if not plaintext:
            raise ValueError("Plaintext tidak boleh kosong")
        plaintext = self._normalize_plaintext(plaintext)
        iv = get_random_bytes(16)
        cipher = AES.new(self.enc_key, AES.MODE_CBC, iv)
        plaintext_bytes = plaintext.encode('utf-8')
        padded_data = pad(plaintext_bytes, AES.block_size)
        ciphertext = cipher.encrypt(padded_data)
        ciphertext_b64 = base64.b64encode(ciphertext).decode('utf-8')
        iv_b64 = base64.b64encode(iv).decode('utf-8')
        mac_b64 = self._compute_hmac(ciphertext_b64, iv_b64)
        return {
            'ciphertext': ciphertext_b64,
            'iv': iv_b64,
            'mac': mac_b64,
        }

    def decrypt(self, ciphertext_b64: str, iv_b64: str, mac_b64: str = None) -> str:
        if not ciphertext_b64 or not iv_b64:
            raise ValueError("Ciphertext dan IV tidak boleh kosong")
        if mac_b64 is not None:
            self._verify_hmac(ciphertext_b64, iv_b64, mac_b64)
        try:
            ciphertext = base64.b64decode(ciphertext_b64)
            iv = base64.b64decode(iv_b64)
        except Exception as e:
            raise ValueError(f"Gagal decode Base64: {str(e)}")
        if len(iv) != 16:
            raise ValueError("IV tidak valid: panjang harus 16 byte.")
        if len(ciphertext) == 0 or len(ciphertext) % AES.block_size != 0:
            raise ValueError("Ciphertext tidak valid: panjang tidak sesuai blok AES.")
        try:
            cipher = AES.new(self.enc_key, AES.MODE_CBC, iv)
            decrypted_padded = cipher.decrypt(ciphertext)
            plaintext_bytes = unpad(decrypted_padded, AES.block_size)
            plaintext = plaintext_bytes.decode('utf-8')
            plaintext = self._normalize_plaintext(plaintext)
            return plaintext
        except Exception as e:
            raise ValueError(f"Gagal dekripsi: {str(e)}")


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
        secret_img.save(buf, format='PNG', compress_level=1)
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
    def embed_to_rgb_full_with_bytes(cover_img: Image.Image, data_bytes: bytes) -> Image.Image:
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
        try:
            mse_val = mse(orig, steg)
        except Exception:
            mse_val = 0.0
        try:
            psnr_val = psnr(orig, steg)
        except Exception:
            psnr_val = 0.0
        try:
            ssim_val = ssim(orig, steg)
        except Exception:
            ssim_val = 0.0
        return {
            'mse': round(max(0.0, mse_val), 6),
            'psnr': round(max(0.0, psnr_val), 4),
            'ssim': round(max(0.0, min(ssim_val, 1.0)), 6),
        }

    @staticmethod
    def calculate_nriqa_metrics(img: Image.Image, mode: str = 'L') -> dict:
        brisque_score = 0.0
        niqe_score = 0.0
        piqe_score = 0.0

        try:
            img_bgr = np.array(img.convert('RGB'))[:, :, ::-1]

            try:
                features = brisque(img_bgr.copy()).reshape(1, -1)
                clf, scaler = _get_svr_model()
                if clf is not None and scaler is not None:
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

        return {
            'brisque': brisque_score,
            'niqe': niqe_score,
            'piqe': piqe_score,
        }