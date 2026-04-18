from PIL import Image
import numpy as np
import math
import struct


class LSBHandler:

    @staticmethod
    def _get_roni_indices(height: int, width: int,
                          roni_border_ratio: float = 0.15) -> np.ndarray:
        border_r = max(1, int(height * roni_border_ratio))
        border_c = max(1, int(width  * roni_border_ratio))

        rows = np.arange(height)
        cols = np.arange(width)
        rr, cc = np.meshgrid(rows, cols, indexing='ij')

        mask = (
            (rr < border_r) |
            (rr >= height - border_r) |
            (cc < border_c) |
            (cc >= width  - border_c)
        )

        flat_indices = (rr * width + cc)[mask]
        return flat_indices.flatten()

    @staticmethod
    def get_roni_capacity(height: int, width: int,
                          roni_border_ratio: float = 0.15) -> int:
        return int(LSBHandler._get_roni_indices(height, width, roni_border_ratio).size)

    @staticmethod
    def embed_to_grayscale(image_path: str, data_bytes: bytes,
                           output_path: str,
                           roni_border_ratio: float = 0.15) -> bool:
        img = Image.open(image_path).convert('L')
        img_array = np.array(img, dtype=np.uint8)
        height, width = img_array.shape
        flat = img_array.flatten()

        full_data = struct.pack('>I', len(data_bytes)) + data_bytes
        n_bits    = len(full_data) * 8
        bits      = np.unpackbits(np.frombuffer(full_data, dtype=np.uint8))

        roni_idx = LSBHandler._get_roni_indices(height, width, roni_border_ratio)
        roni_cap = roni_idx.size

        if n_bits > roni_cap:
            raise ValueError(
                f"Data terlalu besar untuk area RONI. "
                f"Kapasitas RONI: {roni_cap} bits ({roni_cap // 8} bytes), "
                f"Data: {n_bits} bits ({n_bits // 8} bytes). "
                f"Gunakan citra MRI yang lebih besar atau kurangi ukuran data."
            )

        target_idx       = roni_idx[:n_bits]
        flat[target_idx] = (flat[target_idx] & np.uint8(0xFE)) | bits.astype(np.uint8)

        result = Image.fromarray(flat.reshape(img_array.shape), mode='L')
        result.save(output_path, 'PNG')
        return True

    @staticmethod
    def embed_to_rgb(cover_image_path: str, secret_image_path: str,
                     output_path: str) -> bool:
        cover = Image.open(cover_image_path).convert('RGB')
        with open(secret_image_path, 'rb') as f:
            secret_bytes = f.read()

        cover_array = np.array(cover, dtype=np.uint8)
        total_cap   = cover_array.size

        full_data = struct.pack('>I', len(secret_bytes)) + secret_bytes
        n_bits    = len(full_data) * 8

        if n_bits > total_cap:
            raise ValueError(
                f"Data terlalu besar untuk citra foto. "
                f"Kapasitas: {total_cap} bits, Data: {n_bits} bits."
            )

        bits  = np.unpackbits(np.frombuffer(full_data, dtype=np.uint8))
        flat  = cover_array.flatten()
        flat[:n_bits] = (flat[:n_bits] & np.uint8(0xFE)) | bits.astype(np.uint8)

        result = Image.fromarray(flat.reshape(cover_array.shape), mode='RGB')
        result.save(output_path, 'PNG')
        return True

    @staticmethod
    def extract_from_grayscale(image_path: str,
                               roni_border_ratio: float = 0.15):
        img = Image.open(image_path).convert('L')
        img_array = np.array(img, dtype=np.uint8)
        height, width = img_array.shape
        flat = img_array.flatten()

        roni_idx = LSBHandler._get_roni_indices(height, width, roni_border_ratio)
        if roni_idx.size < 32:
            return None

        header_bits  = (flat[roni_idx[:32]] & 1).astype(np.uint8)
        header_bytes = np.packbits(header_bits).tobytes()
        data_length  = struct.unpack('>I', header_bytes)[0]

        total_bits = 32 + data_length * 8
        if total_bits > roni_idx.size:
            return None

        data_bits  = (flat[roni_idx[32:total_bits]] & 1).astype(np.uint8)
        data_bytes = np.packbits(data_bits).tobytes()

        return data_bytes[:data_length]

    @staticmethod
    def extract_from_rgb(stego_image_path: str, output_path: str) -> bool:
        flat = np.array(Image.open(stego_image_path).convert('RGB'),
                        dtype=np.uint8).flatten()

        if flat.size < 32:
            raise ValueError("Citra terlalu kecil untuk diekstrak.")

        header_bits  = (flat[:32] & 1).astype(np.uint8)
        header_bytes = np.packbits(header_bits).tobytes()
        data_length  = struct.unpack('>I', header_bytes)[0]

        total_bits = 32 + data_length * 8
        if total_bits > flat.size:
            raise ValueError(
                f"Data korup atau ukuran tidak valid. "
                f"Dibutuhkan {total_bits} bits, tersedia {flat.size} bits."
            )

        data_bits  = (flat[32:total_bits] & 1).astype(np.uint8)
        data_bytes = np.packbits(data_bits).tobytes()

        with open(output_path, 'wb') as f:
            f.write(data_bytes[:data_length])

        return True

    @staticmethod
    def calculate_metrics(original_path: str, stego_path: str,
                          mode: str = 'L') -> dict:
        orig = np.array(Image.open(original_path).convert(mode), dtype=np.float64)
        steg = np.array(Image.open(stego_path).convert(mode),    dtype=np.float64)

        if orig.shape != steg.shape:
            steg_img = Image.open(stego_path).convert(mode).resize(
                (orig.shape[1], orig.shape[0]), Image.Resampling.LANCZOS
            )
            steg = np.array(steg_img, dtype=np.float64)

        mse  = float(np.mean((orig - steg) ** 2))
        psnr = 100.0 if mse == 0 else min(10 * math.log10(255.0 ** 2 / mse), 100.0)

        try:
            ssim_val = (
                float(np.mean([
                    LSBHandler._ssim_channel(orig[:, :, c], steg[:, :, c])
                    for c in range(3)
                ]))
                if mode == 'RGB'
                else LSBHandler._ssim_channel(orig, steg)
            )
        except Exception:
            ssim_val = 1.0

        return {
            'mse' : round(max(0.0, mse),                6),
            'psnr': round(max(0.0, psnr),               4),
            'ssim': round(max(0.0, min(ssim_val, 1.0)), 6),
        }

    @staticmethod
    def _ssim_channel(a: np.ndarray, b: np.ndarray) -> float:
        C1 = (0.01 * 255) ** 2
        C2 = (0.03 * 255) ** 2

        mu_a, mu_b = a.mean(), b.mean()
        s2_a, s2_b = a.var(),  b.var()
        try:
            cov = float(np.cov(a.flatten(), b.flatten())[0, 1])
        except Exception:
            cov = 0.0

        num = (2 * mu_a * mu_b + C1) * (2 * cov  + C2)
        den = (mu_a**2 + mu_b**2 + C1) * (s2_a + s2_b + C2)
        return 1.0 if den == 0 else float(num / den)