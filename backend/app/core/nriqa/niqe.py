import math
import numpy as np
import cv2
import scipy.special
import scipy.ndimage
import scipy.io
import scipy.linalg
from os.path import dirname, join
from functools import lru_cache

# ── precompute gamma lookup once at import ──────────────────────────────────
_gamma_range = np.arange(0.2, 10, 0.001)
_prec_gammas = (scipy.special.gamma(2.0 / _gamma_range) ** 2) / (
    scipy.special.gamma(1.0 / _gamma_range) * scipy.special.gamma(3.0 / _gamma_range)
)

def _make_avg_window(lw: int = 3, sigma: float = 7.0 / 6.0):
    w = np.exp(-0.5 * np.arange(-lw, lw + 1) ** 2 / sigma ** 2)
    return (w / w.sum()).tolist()

_AVG_WINDOW = _make_avg_window()


@lru_cache(maxsize=1)
def _load_params(module_path: str):
    params = scipy.io.loadmat(join(module_path, 'niqe_image_params.mat'))
    pop_mu = np.ravel(params["pop_mu"])
    pop_cov = params["pop_cov"]
    return pop_mu, pop_cov


def _compute_mscn(image: np.ndarray, C: float = 1.0):
    image_f = image.astype(np.float32)
    mu = np.empty_like(image_f)
    var = np.empty_like(image_f)
    scipy.ndimage.correlate1d(image_f,           _AVG_WINDOW, 0, mu,  mode='constant')
    scipy.ndimage.correlate1d(mu,                _AVG_WINDOW, 1, mu,  mode='constant')
    scipy.ndimage.correlate1d(image_f * image_f, _AVG_WINDOW, 0, var, mode='constant')
    scipy.ndimage.correlate1d(var,               _AVG_WINDOW, 1, var, mode='constant')
    np.subtract(var, mu * mu, out=var)
    np.abs(var, out=var)
    np.sqrt(var, out=var)
    return (image_f - mu) / (var + C), var, mu


def _aggd_features(imdata: np.ndarray):
    flat = imdata.ravel()
    flat2 = flat * flat
    left_mask = flat < 0
    lsq = math.sqrt(float(flat2[left_mask].mean())) if left_mask.any() else 0.0
    rsq = math.sqrt(float(flat2[~left_mask].mean())) if (~left_mask).any() else 0.0

    gamma_hat = (lsq / rsq) if rsq != 0 else math.inf
    mean2 = float(flat2.mean())
    r_hat = (float(np.mean(np.abs(flat))) ** 2) / mean2 if mean2 != 0 else math.inf

    rhat_norm = r_hat * (
        (gamma_hat ** 3 + 1) * (gamma_hat + 1) / (gamma_hat ** 2 + 1) ** 2
    )
    pos = int(np.argmin((_prec_gammas - rhat_norm) ** 2))
    alpha = float(_gamma_range[pos])

    g1 = scipy.special.gamma(1.0 / alpha)
    g2 = scipy.special.gamma(2.0 / alpha)
    g3 = scipy.special.gamma(3.0 / alpha)
    ratio = math.sqrt(g1 / g3)
    N = (ratio * rsq - ratio * lsq) * (g2 / g1)
    return alpha, N, ratio * lsq, ratio * rsq


def _subband_feats(mscn: np.ndarray) -> np.ndarray:
    a_m, N_m, bl_m, br_m = _aggd_features(mscn)

    h  = np.roll(mscn,  1, axis=1) * mscn
    v  = np.roll(mscn,  1, axis=0) * mscn
    d1 = np.roll(np.roll(mscn, 1, axis=0),  1, axis=1) * mscn
    d2 = np.roll(np.roll(mscn, 1, axis=0), -1, axis=1) * mscn

    out = [a_m, (bl_m + br_m) / 2.0]
    for pp in (h, v, d1, d2):
        a, N, bl, br = _aggd_features(pp)
        out += [a, N, bl, br]
    return np.array(out, dtype=np.float64)


def _patches_feats(img: np.ndarray, ps: int) -> np.ndarray:
    h, w = img.shape
    img = img[:h - h % ps, :w - w % ps].astype(np.float32)
    img2 = cv2.resize(img, (0, 0), fx=0.5, fy=0.5)

    mscn1, _, _ = _compute_mscn(img)
    mscn2, _, _ = _compute_mscn(img2)

    ps2 = ps // 2
    h1, w1 = mscn1.shape
    h2, w2 = mscn2.shape

    f1 = np.array([
        _subband_feats(mscn1[r:r+ps, c:c+ps])
        for r in range(0, h1 - ps + 1, ps)
        for c in range(0, w1 - ps + 1, ps)
    ])
    f2 = np.array([
        _subband_feats(mscn2[r:r+ps2, c:c+ps2])
        for r in range(0, h2 - ps2 + 1, ps2)
        for c in range(0, w2 - ps2 + 1, ps2)
    ])

    n = min(len(f1), len(f2))
    return np.hstack((f1[:n], f2[:n]))


def niqe(inputImgData: np.ndarray) -> float:
    PS = 96
    module_path = dirname(__file__)
    pop_mu, pop_cov = _load_params(module_path)

    if inputImgData.ndim == 3:
        inputImgData = cv2.cvtColor(inputImgData, cv2.COLOR_BGR2GRAY)

    M, N = inputImgData.shape
    min_dim = PS * 2 + 1
    assert M > min_dim and N > min_dim, \
        f"Image too small ({M}×{N}), requires > {min_dim}×{min_dim}"

    feats = _patches_feats(inputImgData, PS)
    sample_mu = np.mean(feats, axis=0)
    sample_cov = np.cov(feats.T)

    X = sample_mu - pop_mu
    covmat = (pop_cov + sample_cov) / 2.0
    pinvmat = scipy.linalg.pinv(covmat)

    return float(max(0.0, math.sqrt(float(X @ pinvmat @ X))))