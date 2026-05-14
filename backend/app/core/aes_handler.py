from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from Crypto.Random import get_random_bytes
import base64
import hashlib
import hmac


class AESHandler:
    def __init__(self, key: str):
        key_bytes = key.encode('utf-8')
        self.enc_key = hashlib.sha256(key_bytes).digest()[:16]
        self.mac_key = hashlib.sha256(key_bytes + b'mac').digest()

    def _compute_hmac(self, ciphertext_b64: str, iv_b64: str) -> str:
        message = (ciphertext_b64 + "::" + iv_b64).encode('utf-8')
        return base64.b64encode(
            hmac.new(self.mac_key, message, hashlib.sha256).digest()
        ).decode('utf-8')

    def _verify_hmac(self, ciphertext_b64: str, iv_b64: str, mac_b64: str) -> None:
        expected = self._compute_hmac(ciphertext_b64, iv_b64)
        if not hmac.compare_digest(expected, mac_b64):
            raise ValueError("Verifikasi integritas data gagal: data mungkin telah dimanipulasi.")

    def encrypt(self, plaintext: str) -> dict:
        iv = get_random_bytes(16)
        cipher = AES.new(self.enc_key, AES.MODE_CBC, iv)
        ciphertext = cipher.encrypt(pad(plaintext.encode('utf-8'), AES.block_size))

        ciphertext_b64 = base64.b64encode(ciphertext).decode('utf-8')
        iv_b64 = base64.b64encode(iv).decode('utf-8')
        mac_b64 = self._compute_hmac(ciphertext_b64, iv_b64)

        return {
            'ciphertext': ciphertext_b64,
            'iv': iv_b64,
            'mac': mac_b64,
        }

    def decrypt(self, ciphertext_b64: str, iv_b64: str, mac_b64: str = None) -> str:
        if mac_b64 is not None:
            self._verify_hmac(ciphertext_b64, iv_b64, mac_b64)

        ciphertext = base64.b64decode(ciphertext_b64)
        iv = base64.b64decode(iv_b64)

        if len(iv) != 16:
            raise ValueError("IV tidak valid: panjang harus 16 byte.")
        if len(ciphertext) == 0 or len(ciphertext) % AES.block_size != 0:
            raise ValueError("Ciphertext tidak valid: panjang tidak sesuai blok AES.")

        cipher = AES.new(self.enc_key, AES.MODE_CBC, iv)
        plaintext = unpad(cipher.decrypt(ciphertext), AES.block_size)

        return plaintext.decode('utf-8')