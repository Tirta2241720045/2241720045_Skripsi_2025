import math
import numpy as np
import cv2
import scipy.special
import scipy.ndimage

# ── precompute gamma lookup once at import ──────────────────────────────────
_gamma_range = np.arange(0.2, 10, 0.001)
_prec_gammas = (scipy.special.gamma(2.0 / _gamma_range) ** 2) / (
    scipy.special.gamma(1.0 / _gamma_range) * scipy.special.gamma(3.0 / _gamma_range)
)
_nr_gam = 1.0 / _prec_gammas          # for ggd_features rho lookup

# precompute Gaussian window once
def _make_avg_window(lw: int = 3, sigma: float = 7.0 / 6.0):
    sd2 = sigma ** 2
    w = np.exp(-0.5 * np.arange(-lw, lw + 1) ** 2 / sd2)
    return (w / w.sum()).tolist()

_AVG_WINDOW = _make_avg_window()


def _compute_mscn(image: np.ndarray, C: float = 1.0) -> np.ndarray:
    image_f = image.astype(np.float32)
    mu = np.empty_like(image_f)
    var = np.empty_like(image_f)
    scipy.ndimage.correlate1d(image_f, _AVG_WINDOW, 0, mu, mode='constant')
    scipy.ndimage.correlate1d(mu,      _AVG_WINDOW, 1, mu, mode='constant')
    scipy.ndimage.correlate1d(image_f * image_f, _AVG_WINDOW, 0, var, mode='constant')
    scipy.ndimage.correlate1d(var,               _AVG_WINDOW, 1, var, mode='constant')
    np.subtract(var, mu * mu, out=var)
    np.abs(var, out=var)
    np.sqrt(var, out=var)
    return (image_f - mu) / (var + C)


def _ggd_features(imdata: np.ndarray):
    sigma_sq = float(np.var(imdata))
    E = float(np.mean(np.abs(imdata)))
    if E == 0:
        return 0.2, sigma_sq
    rho = sigma_sq / (E * E)
    pos = int(np.argmin(np.abs(_nr_gam - rho)))
    return float(_gamma_range[pos]), sigma_sq


def _aggd_features(imdata: np.ndarray):
    flat = imdata.ravel()
    flat2 = flat * flat
    left_mask = flat < 0
    lsq = math.sqrt(float(flat2[left_mask].mean())) if left_mask.any() else 0.0
    rsq = math.sqrt(float(flat2[~left_mask].mean())) if (~left_mask).any() else 0.0

    gamma_hat = (lsq / rsq) if rsq != 0 else math.inf
    mean2 = float(flat2.mean())
    if mean2 != 0:
        r_hat = (float(np.mean(np.abs(flat))) ** 2) / mean2
    else:
        r_hat = math.inf

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
    return alpha, N, lsq, rsq


def _extract_feats(mscn: np.ndarray) -> list:
    alpha_m, sigma_sq = _ggd_features(mscn.ravel())

    # paired products via roll (reuse mscn, avoid copies)
    h_shift = np.roll(mscn, 1, axis=1) * mscn
    v_shift = np.roll(mscn, 1, axis=0) * mscn
    d1_shift = np.roll(np.roll(mscn, 1, axis=0), 1, axis=1) * mscn
    d2_shift = np.roll(np.roll(mscn, 1, axis=0), -1, axis=1) * mscn

    feats = [alpha_m, sigma_sq]
    for pp in (h_shift, v_shift, d1_shift, d2_shift):
        a, N, lsq, rsq = _aggd_features(pp)
        feats += [a, N, lsq * lsq, rsq * rsq]
    return feats


def brisque(im: np.ndarray) -> np.ndarray:
    if im.ndim == 3:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    im = im.astype(np.float64)

    feats1 = _extract_feats(_compute_mscn(im))
    low_res = cv2.resize(im, (0, 0), fx=0.5, fy=0.5, interpolation=cv2.INTER_LINEAR)
    feats2 = _extract_feats(_compute_mscn(low_res))

    return np.array(feats1 + feats2, dtype=np.float64)