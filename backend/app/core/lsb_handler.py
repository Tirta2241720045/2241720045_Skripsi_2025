from PIL import Image
import numpy as np
import math
import struct
import io


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
        return np.where(mask.ravel())[0].astype(np.int64)

    @staticmethod
    def _get_roni_indices_rgb_border(height: int, width: int, border_ratio: float = 0.15) -> np.ndarray:
        mask = LSBHandler._get_roni_mask_border(height, width, border_ratio)
        pixel_indices = np.where(mask.ravel())[0].astype(np.int64)
        roni_flat = np.empty(pixel_indices.size * 3, dtype=np.int64)
        roni_flat[0::3] = pixel_indices * 3
        roni_flat[1::3] = pixel_indices * 3 + 1
        roni_flat[2::3] = pixel_indices * 3 + 2
        return roni_flat

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
    def embed_to_grayscale_geometric(img: Image.Image, data_bytes: bytes, border_ratio: float = 0.12) -> Image.Image:
        img_array = np.array(img.convert('L'), dtype=np.uint8)
        height, width = img_array.shape
        flat = img_array.ravel()
        bits, n_bits = LSBHandler._pack_data(data_bytes)
        roni_idx = LSBHandler._get_roni_indices_border(height, width, border_ratio)
        if n_bits > roni_idx.size:
            raise ValueError(f"Data terlalu besar. Kapasitas: {roni_idx.size} bits, Data: {n_bits} bits.")
        target_idx = roni_idx[:n_bits]
        flat[target_idx] = (flat[target_idx] & 0xFE) | bits.astype(np.uint8)
        return Image.fromarray(flat.reshape(height, width), mode='L')

    @staticmethod
    def embed_to_rgb_geometric(cover_img: Image.Image, secret_img: Image.Image, border_ratio: float = 0.12) -> Image.Image:
        cover_array = np.array(cover_img.convert('RGB'), dtype=np.uint8)
        height, width, _ = cover_array.shape
        buf = io.BytesIO()
        secret_img.save(buf, format='PNG')
        secret_bytes = buf.getvalue()
        bits, n_bits = LSBHandler._pack_data(secret_bytes)
        roni_idx = LSBHandler._get_roni_indices_rgb_border(height, width, border_ratio)
        if n_bits > roni_idx.size:
            raise ValueError(f"Data terlalu besar. Kapasitas: {roni_idx.size} bits, Data: {n_bits} bits.")
        target_idx = roni_idx[:n_bits]
        flat = cover_array.ravel()
        flat[target_idx] = (flat[target_idx] & 0xFE) | bits.astype(np.uint8)
        return Image.fromarray(cover_array, mode='RGB')

    @staticmethod
    def extract_from_grayscale_geometric(img: Image.Image, border_ratio: float = 0.12) -> bytes | None:
        img_array = np.array(img.convert('L'), dtype=np.uint8)
        height, width = img_array.shape
        flat = img_array.ravel()
        roni_idx = LSBHandler._get_roni_indices_border(height, width, border_ratio)
        if roni_idx.size < 32:
            return None
        bits_source = (flat[roni_idx] & 1).astype(np.uint8)
        return LSBHandler._unpack_data(bits_source)

    @staticmethod
    def extract_from_rgb_geometric(stego_img: Image.Image, border_ratio: float = 0.12) -> Image.Image | None:
        img_array = np.array(stego_img.convert('RGB'), dtype=np.uint8)
        height, width, _ = img_array.shape
        flat = img_array.ravel()
        roni_idx = LSBHandler._get_roni_indices_rgb_border(height, width, border_ratio)
        if roni_idx.size < 32:
            return None
        bits_source = (flat[roni_idx] & 1).astype(np.uint8)
        data_bytes = LSBHandler._unpack_data(bits_source)
        if data_bytes is None:
            return None
        return Image.open(io.BytesIO(data_bytes))

    @staticmethod
    def calculate_metrics(orig_img: Image.Image, stego_img: Image.Image, mode: str = 'L') -> dict:
        orig = np.array(orig_img.convert(mode), dtype=np.float64)
        steg = np.array(stego_img.convert(mode), dtype=np.float64)
        if orig.shape != steg.shape:
            steg = np.array(stego_img.convert(mode).resize((orig.shape[1], orig.shape[0]), Image.Resampling.LANCZOS), dtype=np.float64)
        mse = float(np.mean((orig - steg) ** 2))
        psnr = 100.0 if mse == 0 else min(10 * math.log10(255.0 ** 2 / mse), 100.0)
        try:
            if mode == 'RGB':
                ssim_val = float(np.mean([LSBHandler._ssim_channel(orig[:, :, c], steg[:, :, c]) for c in range(3)]))
            else:
                ssim_val = LSBHandler._ssim_channel(orig, steg)
        except Exception:
            ssim_val = 1.0
        return {'mse': round(max(0.0, mse), 6), 'psnr': round(max(0.0, psnr), 4), 'ssim': round(max(0.0, min(ssim_val, 1.0)), 6)}

    @staticmethod
    def calculate_nriqa_metrics(img: Image.Image, mode: str = 'L') -> dict:
        import warnings
        brisque_score = None
        niqe_score = None
        piqe_score = None

        img_gray = img.convert('L')
        img_array = np.array(img_gray, dtype=np.float64)

        try:
            import brisque
            bq = brisque.BRISQUE(url=False)
            brisque_score = round(float(bq.score(img_gray)), 4)
        except Exception:
            try:
                h, w = img_array.shape
                mu = np.mean(img_array)
                sigma = np.std(img_array)
                if sigma > 1e-6:
                    normalized = (img_array - mu) / sigma
                    kurtosis = float(np.mean(normalized ** 4))
                    skewness = float(np.mean(normalized ** 3))
                    brisque_score = round(abs(kurtosis - 3) * 10 + abs(skewness) * 5, 4)
                else:
                    brisque_score = 0.0
            except Exception:
                brisque_score = None

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                from piq import niqe
                import torch
                tensor = torch.tensor(img_array / 255.0, dtype=torch.float32).unsqueeze(0).unsqueeze(0)
                niqe_score = round(float(niqe(tensor).item()), 4)
        except Exception:
            try:
                h, w = img_array.shape
                block_size = 32
                scores = []
                for i in range(0, h - block_size, block_size):
                    for j in range(0, w - block_size, block_size):
                        block = img_array[i:i + block_size, j:j + block_size]
                        mu = np.mean(block)
                        sigma = np.std(block)
                        if sigma > 1e-6:
                            scores.append(abs(float(np.mean(((block - mu) / sigma) ** 2)) - 1))
                niqe_score = round(float(np.mean(scores)), 4) if scores else None
            except Exception:
                niqe_score = None

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                from piq import piqe
                import torch
                tensor = torch.tensor(img_array / 255.0, dtype=torch.float32).unsqueeze(0).unsqueeze(0)
                piqe_score = round(float(piqe(tensor).item()), 4)
        except Exception:
            try:
                h, w = img_array.shape
                block_size = 16
                noisy_blocks = []
                for i in range(0, h - block_size, block_size):
                    for j in range(0, w - block_size, block_size):
                        block = img_array[i:i + block_size, j:j + block_size]
                        variance = float(np.var(block))
                        mean_val = float(np.mean(block))
                        if mean_val > 1e-6:
                            noisy_blocks.append(variance / (mean_val + 1e-6))
                noisy_blocks.sort(reverse=True)
                top_n = max(1, len(noisy_blocks) // 4)
                piqe_score = round(float(np.mean(noisy_blocks[:top_n])), 4) if noisy_blocks else None
            except Exception:
                piqe_score = None

        return {
            'brisque': brisque_score,
            'niqe': niqe_score,
            'piqe': piqe_score,
        }

    @staticmethod
    def _ssim_channel(a: np.ndarray, b: np.ndarray) -> float:
        C1 = (0.01 * 255) ** 2
        C2 = (0.03 * 255) ** 2
        mu_a, mu_b = a.mean(), b.mean()
        s2_a, s2_b = a.var(), b.var()
        cov = float(np.cov(a.ravel(), b.ravel())[0, 1])
        num = (2 * mu_a * mu_b + C1) * (2 * cov + C2)
        den = (mu_a ** 2 + mu_b ** 2 + C1) * (s2_a + s2_b + C2)
        return 1.0 if den == 0 else float(num / den)

    @staticmethod
    def generate_lsb_visualization_grayscale_geometric(
        orig_img: Image.Image, stego_img: Image.Image, n_bits_embedded: int,
        border_ratio: float = 0.12, highlight_color: tuple = (255, 0, 0), highlight_alpha: float = 0.6
    ) -> Image.Image:
        orig_array = np.array(orig_img.convert('L'), dtype=np.uint8)
        stego_array = np.array(stego_img.convert('L'), dtype=np.uint8)
        height, width = orig_array.shape
        vis = np.stack([orig_array, orig_array, orig_array], axis=2).astype(np.float64)
        roni_mask = LSBHandler._get_roni_mask_border(height, width, border_ratio)
        roni_rows, roni_cols = np.where(roni_mask)
        all_roni_idx = np.where(roni_mask.ravel())[0]
        used_count = min(n_bits_embedded, all_roni_idx.size)
        if used_count <= 0:
            return Image.fromarray(vis.astype(np.uint8), mode='RGB')
        active_idx = all_roni_idx[:used_count]
        rows_active = active_idx // width
        cols_active = active_idx % width
        changed_mask = orig_array.ravel()[active_idx] != stego_array.ravel()[active_idx]
        changed_rows = rows_active[changed_mask]
        changed_cols = cols_active[changed_mask]
        unchanged_rows = rows_active[~changed_mask]
        unchanged_cols = cols_active[~changed_mask]
        r, g, b = highlight_color
        a = highlight_alpha
        if roni_rows.size > 0:
            vis[roni_rows, roni_cols, 0] = np.clip(vis[roni_rows, roni_cols, 0] * 0.7 + 100, 0, 255)
            vis[roni_rows, roni_cols, 1] = np.clip(vis[roni_rows, roni_cols, 1] * 0.7 + 100, 0, 255)
            vis[roni_rows, roni_cols, 2] = np.clip(vis[roni_rows, roni_cols, 2] * 0.7 + 255, 0, 255)
        if unchanged_rows.size > 0:
            vis[unchanged_rows, unchanged_cols, 0] = np.clip(vis[unchanged_rows, unchanged_cols, 0] * (1 - a * 0.4) + 255 * a * 0.4, 0, 255)
            vis[unchanged_rows, unchanged_cols, 1] = np.clip(vis[unchanged_rows, unchanged_cols, 1] * (1 - a * 0.4) + 165 * a * 0.4, 0, 255)
            vis[unchanged_rows, unchanged_cols, 2] = np.clip(vis[unchanged_rows, unchanged_cols, 2] * (1 - a * 0.4), 0, 255)
        if changed_rows.size > 0:
            vis[changed_rows, changed_cols, 0] = np.clip(vis[changed_rows, changed_cols, 0] * (1 - a) + r * a, 0, 255)
            vis[changed_rows, changed_cols, 1] = np.clip(vis[changed_rows, changed_cols, 1] * (1 - a) + g * a, 0, 255)
            vis[changed_rows, changed_cols, 2] = np.clip(vis[changed_rows, changed_cols, 2] * (1 - a) + b * a, 0, 255)
        return Image.fromarray(vis.astype(np.uint8), mode='RGB')

    @staticmethod
    def generate_lsb_visualization_rgb_geometric(
        orig_img: Image.Image, stego_img: Image.Image, n_bits_embedded: int,
        border_ratio: float = 0.12, highlight_color: tuple = (255, 0, 0), highlight_alpha: float = 0.6
    ) -> Image.Image:
        orig_array = np.array(orig_img.convert('RGB'), dtype=np.uint8)
        stego_array = np.array(stego_img.convert('RGB'), dtype=np.uint8)
        height, width, _ = orig_array.shape
        vis = orig_array.copy().astype(np.float64)
        roni_mask = LSBHandler._get_roni_mask_border(height, width, border_ratio)
        roni_rows, roni_cols = np.where(roni_mask)
        roni_idx = LSBHandler._get_roni_indices_rgb_border(height, width, border_ratio)
        total_bits_affected = min(n_bits_embedded, roni_idx.size)
        if total_bits_affected <= 0:
            return Image.fromarray(vis.astype(np.uint8), mode='RGB')
        affected_flat_indices = roni_idx[:total_bits_affected]
        pixel_indices = np.unique(affected_flat_indices // 3)
        row_indices = pixel_indices // width
        col_indices = pixel_indices % width
        orig_flat = orig_array.reshape(-1, 3)
        stego_flat = stego_array.reshape(-1, 3)
        changed_mask = np.any(orig_flat[pixel_indices] != stego_flat[pixel_indices], axis=1)
        changed_rows = row_indices[changed_mask]
        changed_cols = col_indices[changed_mask]
        unchanged_rows = row_indices[~changed_mask]
        unchanged_cols = col_indices[~changed_mask]
        r, g, b = highlight_color
        a = highlight_alpha
        if roni_rows.size > 0:
            vis[roni_rows, roni_cols, 0] = np.clip(vis[roni_rows, roni_cols, 0] * 0.7 + 100, 0, 255)
            vis[roni_rows, roni_cols, 1] = np.clip(vis[roni_rows, roni_cols, 1] * 0.7 + 100, 0, 255)
            vis[roni_rows, roni_cols, 2] = np.clip(vis[roni_rows, roni_cols, 2] * 0.7 + 255, 0, 255)
        if unchanged_rows.size > 0:
            vis[unchanged_rows, unchanged_cols, 0] = np.clip(vis[unchanged_rows, unchanged_cols, 0] * (1 - a * 0.4) + 255 * a * 0.4, 0, 255)
            vis[unchanged_rows, unchanged_cols, 1] = np.clip(vis[unchanged_rows, unchanged_cols, 1] * (1 - a * 0.4) + 165 * a * 0.4, 0, 255)
            vis[unchanged_rows, unchanged_cols, 2] = np.clip(vis[unchanged_rows, unchanged_cols, 2] * (1 - a * 0.4), 0, 255)
        if changed_rows.size > 0:
            vis[changed_rows, changed_cols, 0] = np.clip(vis[changed_rows, changed_cols, 0] * (1 - a) + r * a, 0, 255)
            vis[changed_rows, changed_cols, 1] = np.clip(vis[changed_rows, changed_cols, 1] * (1 - a) + g * a, 0, 255)
            vis[changed_rows, changed_cols, 2] = np.clip(vis[changed_rows, changed_cols, 2] * (1 - a) + b * a, 0, 255)
        return Image.fromarray(vis.astype(np.uint8), mode='RGB')