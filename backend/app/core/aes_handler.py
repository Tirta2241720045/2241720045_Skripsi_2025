from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from Crypto.Random import get_random_bytes
import base64
import hashlib
import hmac
import unicodedata


class AESHandler:
    def __init__(self, key: str):
        if not key or len(key) == 0:
            raise ValueError("AES key cannot be empty")
        
        key_bytes = key.encode('utf-8')
        self.enc_key = hashlib.sha256(key_bytes).digest()[:16]
        self.mac_key = hashlib.sha256(key_bytes + b'mac').digest()

    def _normalize_plaintext(self, plaintext: str) -> str:
        """
        Normalisasi plaintext sebelum enkripsi untuk konsistensi.
        Sama seperti normalize_text di medical.py
        """
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
        
        # Normalisasi plaintext sebelum enkripsi
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
            
            # Normalisasi hasil dekripsi untuk konsistensi
            plaintext = self._normalize_plaintext(plaintext)
            
            return plaintext
        except Exception as e:
            raise ValueError(f"Gagal dekripsi: {str(e)}")