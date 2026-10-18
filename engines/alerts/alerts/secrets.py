"""Decifra de segredos guardados na BD pela API (formato partilhado com api/src/secrets.js).

Formato: "v1:" + base64(iv[12] | tag[16] | texto cifrado), AES-256-GCM. A chave (32 bytes em base64)
vem de STOCKS_SECRET_KEY ou do ficheiro STOCKS_SECRET_KEY_FILE (por omissão /etc/stocks/secret.key).
"""
import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

DEFAULT_KEY_FILE = "/etc/stocks/secret.key"


def load_key(env=os.environ) -> bytes | None:
    b64 = env.get("STOCKS_SECRET_KEY")
    path = env.get("STOCKS_SECRET_KEY_FILE", DEFAULT_KEY_FILE)
    if not b64 and path and os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            b64 = fh.read().strip()
    if not b64:
        return None
    key = base64.b64decode(b64)
    if len(key) != 32:
        raise ValueError("a chave de cifra deve ter 32 bytes em base64")
    return key


def decrypt(key: bytes, value: str) -> str:
    if not value.startswith("v1:"):
        raise ValueError("formato de segredo desconhecido")
    raw = base64.b64decode(value[3:])
    iv, tag, ct = raw[:12], raw[12:28], raw[28:]
    return AESGCM(key).decrypt(iv, ct + tag, None).decode("utf-8")
