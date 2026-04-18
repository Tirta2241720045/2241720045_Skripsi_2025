from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from Crypto.Random import get_random_bytes
import base64
import hashlib

class AESHandler:
    def __init__(self, key: str):
        self.key = hashlib.sha256(key.encode()).digest()[:16]

    def encrypt(self, plaintext: str) -> dict:
        iv = get_random_bytes(16)
        cipher = AES.new(self.key, AES.MODE_CBC, iv)
        ciphertext = cipher.encrypt(pad(plaintext.encode(), AES.block_size))

        return {
            'ciphertext': base64.b64encode(ciphertext).decode('utf-8'),
            'iv': base64.b64encode(iv).decode('utf-8')
        }

    def decrypt(self, ciphertext_b64: str, iv_b64: str) -> str:
        ciphertext = base64.b64decode(ciphertext_b64)
        iv = base64.b64decode(iv_b64)

        cipher = AES.new(self.key, AES.MODE_CBC, iv)
        plaintext = unpad(cipher.decrypt(ciphertext), AES.block_size)

        return plaintext.decode('utf-8')