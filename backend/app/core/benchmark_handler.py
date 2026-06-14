from __future__ import annotations

import time
import unicodedata
from typing import Optional

import numpy as np
from PIL import Image
from sqlalchemy.orm import Session

from app.core.methods._shared   import compute_metrics, compute_nriqa, _pil_to_cv2_gray
from app.core.methods.dwt_pso   import dwt_pso_embed,  dwt_pso_extract
from app.core.methods.ebs3      import ebs3_embed,      ebs3_extract
from app.core.methods.ebs5      import ebs5_embed,      ebs5_extract
from app.core.methods.ebs9      import ebs9_embed,      ebs9_extract
from app.core.methods.stegoshield_method import stegoshield_embed, stegoshield_extract

ENABLE_FR_IQA: bool = True
ENABLE_NR_IQA: bool = True

_METHOD_MAP: dict = {
    "stegoshield": {
        "embed_fn":   stegoshield_embed,
        "extract_fn": stegoshield_extract,
    },
    "dwt_pso": {
        "embed_fn":   dwt_pso_embed,
        "extract_fn": dwt_pso_extract,
    },
    "ebs3": {
        "embed_fn":   ebs3_embed,
        "extract_fn": ebs3_extract,
    },
    "ebs5": {
        "embed_fn":   ebs5_embed,
        "extract_fn": ebs5_extract,
    },
    "ebs9": {
        "embed_fn":   ebs9_embed,
        "extract_fn": ebs9_extract,
    },
}

DEFAULT_METHOD = "stegoshield"


def _normalize(text: str) -> str:
    text = text.lstrip('\ufeff')
    text = unicodedata.normalize('NFC', text)
    for src, dst in {
        '\u201c': '"', '\u201d': '"', '\u2018': "'", '\u2019': "'",
        '\u2014': '-', '\u2013': '-', '\u2012': '-', '\u2011': '-',
        '\u2010': '-', '\u2026': '...', '\u00a0': ' ', '\u200b': '',
        '\u200c': '', '\u200d': '', '\u00ad': '', '\u2002': ' ',
        '\u2003': ' ', '\u2009': ' ', '\u202f': ' ', '\u0000': '',
    }.items():
        text = text.replace(src, dst)
    return text.replace('\r\n', '\n').replace('\r', '\n')


def _calc_acctxt(original: str, recovered: str) -> dict:
    original = _normalize(original)
    recovered = _normalize(recovered)
    orig_b = original.encode('utf-8')
    recv_b = recovered.encode('utf-8')
    T = len(orig_b) * 8
    if T == 0:
        return {"acc_txt": 100.0, "D": 0, "T": 0, "bit_errors": 0}
    min_len = min(len(orig_b), len(recv_b))
    ob = np.unpackbits(np.frombuffer(orig_b[:min_len], dtype=np.uint8))
    rb = np.unpackbits(np.frombuffer(recv_b[:min_len], dtype=np.uint8))
    D = int(np.sum(ob == rb))
    return {
        "acc_txt":    round((D / T) * 100, 4),
        "D":          D,
        "T":          T,
        "bit_errors": T - D,
    }


def run_benchmark(
    cover_img:    Image.Image,
    payload_text: str,
    filename:     str,
    db:           Optional[Session] = None,
    record_id:    Optional[int]     = None,
    photo_img:    Optional[Image.Image] = None,
    method:       str = DEFAULT_METHOD,
) -> None:
    if method not in _METHOD_MAP:
        method = DEFAULT_METHOD

    method_info  = _METHOD_MAP[method]
    embed_fn     = method_info["embed_fn"]
    extract_fn   = method_info["extract_fn"]

    cover_gray = cover_img.convert("L")
    cover_arr  = _pil_to_cv2_gray(cover_gray)

    try:
        t0 = time.perf_counter()
        if photo_img is not None and embed_fn is stegoshield_embed:
            stego_img = embed_fn(cover_gray, payload_text, photo_img=photo_img)
        else:
            stego_img = embed_fn(cover_gray, payload_text)
        t_embed = round(time.perf_counter() - t0, 6)

        t0 = time.perf_counter()
        recovered = extract_fn(stego_img, payload_text)
        t_extract = round(time.perf_counter() - t0, 6)

        acc = _calc_acctxt(payload_text, recovered or "")

        if ENABLE_FR_IQA:
            stego_arr = _pil_to_cv2_gray(stego_img.convert("L"))
            compute_metrics(cover_arr, stego_arr)

        if ENABLE_NR_IQA:
            compute_nriqa(stego_img)

    except Exception:
        pass