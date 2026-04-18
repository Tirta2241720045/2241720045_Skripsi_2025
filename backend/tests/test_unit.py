import os
import pytest
import numpy as np
from PIL import Image

from app.core.aes_handler import AESHandler
from app.core.lsb_handler import LSBHandler

# Semua fixtures (tmp_dir, mri_*, photo_*, aes) dan hooks pelaporan
# sudah dipindah ke conftest.py — file ini hanya berisi test case.


class TestAESHandler:
    def test_enkripsi_dekripsi_teks_biasa(self, aes):
        plaintext = "Pasien menderita hipertensi stadium 2"
        result = aes.encrypt(plaintext)
        decrypted = aes.decrypt(result['ciphertext'], result['iv'])
        assert decrypted == plaintext

    def test_enkripsi_dekripsi_teks_panjang(self, aes):
        plaintext = "Data rekam medis pasien. " * 400
        result = aes.encrypt(plaintext)
        decrypted = aes.decrypt(result['ciphertext'], result['iv'])
        assert decrypted == plaintext

    def test_enkripsi_dekripsi_karakter_khusus(self, aes):
        plaintext = "Diagnosis: Tumor otak — Grade III\nTanggal: 2026-01-15\nCatatan: Perlu operasi!"
        result = aes.encrypt(plaintext)
        decrypted = aes.decrypt(result['ciphertext'], result['iv'])
        assert decrypted == plaintext

    def test_iv_selalu_berbeda(self, aes):
        r1 = aes.encrypt("data rekam medis")
        r2 = aes.encrypt("data rekam medis")
        assert r1['iv'] != r2['iv']

    def test_ciphertext_berbeda(self, aes):
        r1 = aes.encrypt("data sama")
        r2 = aes.encrypt("data sama")
        assert r1['ciphertext'] != r2['ciphertext']

    def test_output_base64(self, aes):
        import base64
        result = aes.encrypt("test base64")
        base64.b64decode(result['ciphertext'])
        base64.b64decode(result['iv'])

    def test_kunci_salah_gagal(self, aes):
        wrong_aes = AESHandler("KUNCI_SALAH_123")
        result = aes.encrypt("data sensitif")
        with pytest.raises(Exception):
            wrong_aes.decrypt(result['ciphertext'], result['iv'])

    def test_enkripsi_teks_kosong(self, aes):
        result = aes.encrypt("")
        decrypted = aes.decrypt(result['ciphertext'], result['iv'])
        assert decrypted == ""


class TestLSBLayer1Grayscale:
    def test_embed_extract_512(self, mri_512, tmp_dir):
        data = b"ciphertext_aes::iv_base64"
        stego_path = str(tmp_dir / "stego_l1_512.png")
        LSBHandler.embed_to_grayscale(mri_512, data, stego_path)
        result = LSBHandler.extract_from_grayscale(stego_path)
        assert result == data

    def test_embed_extract_400(self, mri_400, tmp_dir):
        data = b"ciphertext::iv_400"
        stego_path = str(tmp_dir / "stego_l1_400.png")
        LSBHandler.embed_to_grayscale(mri_400, data, stego_path)
        result = LSBHandler.extract_from_grayscale(stego_path)
        assert result == data

    def test_embed_extract_600(self, mri_600, tmp_dir):
        data = b"ciphertext::iv_600"
        stego_path = str(tmp_dir / "stego_l1_600.png")
        LSBHandler.embed_to_grayscale(mri_600, data, stego_path)
        result = LSBHandler.extract_from_grayscale(stego_path)
        assert result == data

    def test_embed_rekam_medis_real(self, mri_512, tmp_dir, aes):
        plaintext = "Nama: Budi Santoso\nDiagnosis: Tumor otak Grade II"
        encrypted = aes.encrypt(plaintext)
        data_to_embed = f"{encrypted['ciphertext']}::{encrypted['iv']}".encode()
        stego_path = str(tmp_dir / "stego_l1_medis.png")
        LSBHandler.embed_to_grayscale(mri_512, data_to_embed, stego_path)
        extracted = LSBHandler.extract_from_grayscale(stego_path)
        assert extracted == data_to_embed
        parts = extracted.decode().split("::")
        decrypted = aes.decrypt(parts[0], parts[1])
        assert decrypted == plaintext

    def test_roni_tidak_modifikasi_roi(self, mri_512, tmp_dir):
        data = b"test_roni::iv123"
        stego_path = str(tmp_dir / "stego_roni.png")
        LSBHandler.embed_to_grayscale(mri_512, data, stego_path)
        orig = np.array(Image.open(mri_512), dtype=np.uint8)
        stego = np.array(Image.open(stego_path), dtype=np.uint8)
        h, w = orig.shape
        br, bc = max(1, int(h * 0.15)), max(1, int(w * 0.15))
        assert np.array_equal(orig[br:h-br, bc:w-bc], stego[br:h-br, bc:w-bc])

    def test_kapasitas_roni_512(self):
        cap_bytes = (LSBHandler.get_roni_capacity(512, 512) // 8) - 4
        assert cap_bytes >= 10 * 1024

    def test_data_terlalu_besar_error(self, mri_400, tmp_dir):
        kapasitas = LSBHandler.get_roni_capacity(400, 400) // 8
        data_besar = b"X" * (kapasitas + 100)
        stego_path = str(tmp_dir / "stego_overflow.png")
        with pytest.raises(ValueError):
            LSBHandler.embed_to_grayscale(mri_400, data_besar, stego_path)

    def test_output_mode_grayscale(self, mri_512, tmp_dir):
        stego_path = str(tmp_dir / "stego_mode.png")
        LSBHandler.embed_to_grayscale(mri_512, b"test::iv", stego_path)
        assert Image.open(stego_path).mode == 'L'


class TestLSBLayer2RGB:
    def test_embed_extract_1200(self, mri_512, photo_1200, tmp_dir):
        mri_stego = str(tmp_dir / "mri_stego_l2.png")
        LSBHandler.embed_to_grayscale(mri_512, b"data::iv", mri_stego)
        stego_final = str(tmp_dir / "stego_final.png")
        extracted = str(tmp_dir / "extracted.png")
        LSBHandler.embed_to_rgb(photo_1200, mri_stego, stego_final)
        LSBHandler.extract_from_rgb(stego_final, extracted)
        assert open(mri_stego, 'rb').read() == open(extracted, 'rb').read()

    def test_embed_extract_1500(self, mri_512, photo_1500, tmp_dir):
        mri_stego = str(tmp_dir / "mri_stego_1500.png")
        stego_final = str(tmp_dir / "stego_final_1500.png")
        extracted = str(tmp_dir / "extracted_1500.png")
        LSBHandler.embed_to_grayscale(mri_512, b"data::iv", mri_stego)
        LSBHandler.embed_to_rgb(photo_1500, mri_stego, stego_final)
        LSBHandler.extract_from_rgb(stego_final, extracted)
        assert open(mri_stego, 'rb').read() == open(extracted, 'rb').read()

    def test_embed_extract_2000(self, mri_512, photo_2000, tmp_dir):
        mri_stego = str(tmp_dir / "mri_stego_2000.png")
        stego_final = str(tmp_dir / "stego_final_2000.png")
        extracted = str(tmp_dir / "extracted_2000.png")
        LSBHandler.embed_to_grayscale(mri_512, b"data::iv", mri_stego)
        LSBHandler.embed_to_rgb(photo_2000, mri_stego, stego_final)
        LSBHandler.extract_from_rgb(stego_final, extracted)
        assert open(mri_stego, 'rb').read() == open(extracted, 'rb').read()

    def test_output_mode_rgb(self, mri_512, photo_1200, tmp_dir):
        mri_stego = str(tmp_dir / "mri_stego_mode.png")
        stego_final = str(tmp_dir / "stego_mode.png")
        LSBHandler.embed_to_grayscale(mri_512, b"test::iv", mri_stego)
        LSBHandler.embed_to_rgb(photo_1200, mri_stego, stego_final)
        assert Image.open(stego_final).mode == 'RGB'


class TestDoubleLayerEndToEnd:
    def _full_embed(self, plaintext, mri_path, photo_path, tmp_dir, aes, suffix=""):
        encrypted = aes.encrypt(plaintext)
        data_to_embed = f"{encrypted['ciphertext']}::{encrypted['iv']}".encode()
        mri_gray = str(tmp_dir / f"mri_gray{suffix}.png")
        mri_stego = str(tmp_dir / f"mri_stego{suffix}.png")
        stego_out = str(tmp_dir / f"stego_final{suffix}.png")
        Image.open(mri_path).convert('L').save(mri_gray, 'PNG')
        LSBHandler.embed_to_grayscale(mri_gray, data_to_embed, mri_stego)
        LSBHandler.embed_to_rgb(photo_path, mri_stego, stego_out)
        return stego_out, mri_stego

    def _full_extract(self, stego_out, tmp_dir, aes, suffix=""):
        ext_mri = str(tmp_dir / f"ext_mri{suffix}.png")
        LSBHandler.extract_from_rgb(stego_out, ext_mri)
        extracted = LSBHandler.extract_from_grayscale(ext_mri)
        parts = extracted.decode().split("::")
        return aes.decrypt(parts[0], parts[1])

    def test_e2e_512_1200(self, mri_512, photo_1200, tmp_dir, aes):
        plaintext = "Rekam medis: Diagnosis tumor otak Grade II"
        stego_out, _ = self._full_embed(plaintext, mri_512, photo_1200, tmp_dir, aes, "_512_1200")
        assert self._full_extract(stego_out, tmp_dir, aes, "_512_1200") == plaintext

    def test_e2e_400_1200(self, mri_400, photo_1200, tmp_dir, aes):
        plaintext = "Data medis: Hipertensi stadium 2"
        stego_out, _ = self._full_embed(plaintext, mri_400, photo_1200, tmp_dir, aes, "_400_1200")
        assert self._full_extract(stego_out, tmp_dir, aes, "_400_1200") == plaintext

    def test_e2e_600_1500(self, mri_600, photo_1500, tmp_dir, aes):
        plaintext = "Catatan klinis: Pasien perlu operasi"
        stego_out, _ = self._full_embed(plaintext, mri_600, photo_1500, tmp_dir, aes, "_600_1500")
        assert self._full_extract(stego_out, tmp_dir, aes, "_600_1500") == plaintext

    def test_e2e_600_2000(self, mri_600, photo_2000, tmp_dir, aes):
        plaintext = "Discharge summary: kondisi stabil"
        stego_out, _ = self._full_embed(plaintext, mri_600, photo_2000, tmp_dir, aes, "_600_2000")
        assert self._full_extract(stego_out, tmp_dir, aes, "_600_2000") == plaintext

    def test_e2e_data_10kb(self, mri_512, photo_1200, tmp_dir, aes):
        plaintext = "Rekam medis lengkap. " * 200
        stego_out, _ = self._full_embed(plaintext, mri_512, photo_1200, tmp_dir, aes, "_10kb")
        assert self._full_extract(stego_out, tmp_dir, aes, "_10kb") == plaintext


class TestFormatDanKompresi:
    def test_png_aman_untuk_lsb(self, mri_512, tmp_dir):
        data = b"test_png_aman::iv"
        stego = str(tmp_dir / "stego.png")
        LSBHandler.embed_to_grayscale(mri_512, data, stego)
        assert LSBHandler.extract_from_grayscale(stego) == data

    def test_jpeg_merusak_lsb(self, mri_512, tmp_dir):
        """JPEG lossy compression merusak bit LSB — data hasil ekstraksi tidak cocok."""
        data = b"test_jpeg_rusak::iv"
        stego_png = str(tmp_dir / "stego_temp.png")
        stego_jpg = str(tmp_dir / "stego.jpg")
        stego_dari_jpg = str(tmp_dir / "stego_dari_jpg.png")
        LSBHandler.embed_to_grayscale(mri_512, data, stego_png)
        # Simpan sebagai JPEG lalu baca kembali sebagai PNG (simulate buka-simpan ulang)
        img = Image.open(stego_png).convert('L')
        img.save(stego_jpg, 'JPEG', quality=85)
        Image.open(stego_jpg).save(stego_dari_jpg, 'PNG')
        # Setelah kompresi JPEG, data harus rusak (tidak sama) atau raise exception
        try:
            extracted = LSBHandler.extract_from_grayscale(stego_dari_jpg)
            assert extracted != data, \
                "JPEG seharusnya merusak data LSB — data tidak boleh sama dengan aslinya"
        except Exception:
            pass  # Raise exception juga diterima sebagai bukti kerusakan

    def test_resize_merusak_lsb(self, mri_512, tmp_dir):
        """Resize mengubah dimensi dan posisi piksel — data LSB harus rusak."""
        data = b"test_resize_rusak::iv"
        stego_asli  = str(tmp_dir / "stego_asli.png")
        stego_kecil = str(tmp_dir / "stego_kecil.png")
        LSBHandler.embed_to_grayscale(mri_512, data, stego_asli)
        Image.open(stego_asli).resize((256, 256)).save(stego_kecil, 'PNG')
        # Setelah resize, data harus rusak atau raise exception
        try:
            extracted = LSBHandler.extract_from_grayscale(stego_kecil)
            assert extracted != data, \
                "Resize seharusnya merusak data LSB — data tidak boleh sama dengan aslinya"
        except Exception:
            pass  # Raise exception juga diterima

    def test_gif_tidak_didukung(self, mri_512, tmp_dir):
        """Format GIF tidak mendukung embedding LSB (palette mode / lossy)."""
        gif_path = str(tmp_dir / "stego.gif")
        # GIF harus raise exception ATAU menghasilkan file yang tidak bisa diekstrak
        try:
            LSBHandler.embed_to_grayscale(mri_512, b"test::iv", gif_path)
            # Jika tidak raise saat embed, pastikan ekstraksi gagal / rusak
            try:
                extracted = LSBHandler.extract_from_grayscale(gif_path)
                assert extracted != b"test::iv", \
                    "GIF seharusnya tidak mendukung LSB — data tidak boleh terekstrak utuh"
            except Exception:
                pass  # Exception saat ekstraksi juga valid
        except Exception:
            pass  # Exception saat embed adalah perilaku yang diharapkan

    def test_roni_perlindungan_diagnostik(self, mri_512, tmp_dir):
        data = b"test_roi_protection::iv"
        stego = str(tmp_dir / "stego_roni.png")
        LSBHandler.embed_to_grayscale(mri_512, data, stego)
        orig = np.array(Image.open(mri_512), dtype=np.uint8)
        stg = np.array(Image.open(stego), dtype=np.uint8)
        h, w = orig.shape
        br, bc = max(1, int(h * 0.15)), max(1, int(w * 0.15))
        diff = np.sum(orig[br:h-br, bc:w-bc] != stg[br:h-br, bc:w-bc])
        assert diff == 0


class TestMetricsQuality:
    def test_psnr_layer1_above_30(self, mri_512, tmp_dir):
        stego = str(tmp_dir / "stego_psnr.png")
        mri_gray = str(tmp_dir / "mri_gray.png")
        Image.open(mri_512).convert('L').save(mri_gray, 'PNG')
        LSBHandler.embed_to_grayscale(mri_gray, b"test::iv", stego)
        metrics = LSBHandler.calculate_metrics(mri_gray, stego, mode='L')
        assert metrics['psnr'] > 30.0

    def test_ssim_layer1_above_09(self, mri_512, tmp_dir):
        stego = str(tmp_dir / "stego_ssim.png")
        mri_gray = str(tmp_dir / "mri_gray.png")
        Image.open(mri_512).convert('L').save(mri_gray, 'PNG')
        LSBHandler.embed_to_grayscale(mri_gray, b"test::iv", stego)
        metrics = LSBHandler.calculate_metrics(mri_gray, stego, mode='L')
        assert metrics['ssim'] > 0.9

    def test_mse_layer1_below_1(self, mri_512, tmp_dir):
        stego = str(tmp_dir / "stego_mse.png")
        mri_gray = str(tmp_dir / "mri_gray.png")
        Image.open(mri_512).convert('L').save(mri_gray, 'PNG')
        LSBHandler.embed_to_grayscale(mri_gray, b"test::iv", stego)
        metrics = LSBHandler.calculate_metrics(mri_gray, stego, mode='L')
        assert metrics['mse'] < 1.0

    def test_psnr_layer2_above_30(self, mri_512, photo_1200, tmp_dir):
        mri_gray  = str(tmp_dir / "mri_gray.png")
        mri_stego = str(tmp_dir / "mri_stego.png")
        stego_out = str(tmp_dir / "stego_out.png")
        Image.open(mri_512).convert('L').save(mri_gray, 'PNG')
        LSBHandler.embed_to_grayscale(mri_gray, b"test::iv", mri_stego)
        LSBHandler.embed_to_rgb(photo_1200, mri_stego, stego_out)
        metrics = LSBHandler.calculate_metrics(photo_1200, stego_out, mode='RGB')
        assert metrics['psnr'] > 30.0

    def test_ssim_layer2_above_09(self, mri_512, photo_1200, tmp_dir):
        mri_gray  = str(tmp_dir / "mri_gray.png")
        mri_stego = str(tmp_dir / "mri_stego.png")
        stego_out = str(tmp_dir / "stego_out.png")
        Image.open(mri_512).convert('L').save(mri_gray, 'PNG')
        LSBHandler.embed_to_grayscale(mri_gray, b"test::iv", mri_stego)
        LSBHandler.embed_to_rgb(photo_1200, mri_stego, stego_out)
        metrics = LSBHandler.calculate_metrics(photo_1200, stego_out, mode='RGB')
        assert metrics['ssim'] > 0.9

    def test_metrics_identik(self, mri_512):
        metrics = LSBHandler.calculate_metrics(mri_512, mri_512, mode='L')
        assert metrics['mse'] == 0.0
        assert metrics['psnr'] == 100.0
        assert metrics['ssim'] == 1.0