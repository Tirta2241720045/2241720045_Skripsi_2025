import math
import numpy as np
import cv2
import scipy.special
import scipy.ndimage
from os.path import dirname

gamma_range = np.arange(0.2, 10, 0.001)
_a = scipy.special.gamma(2.0 / gamma_range)
_a *= _a
_b = scipy.special.gamma(1.0 / gamma_range)
_c = scipy.special.gamma(3.0 / gamma_range)
prec_gammas = _a / (_b * _c)

def _gen_gauss_window(lw: int, sigma: float):
    lw = int(lw)
    sd2 = float(sigma) ** 2
    weights = [0.0] * (2 * lw + 1)
    weights[lw] = 1.0
    sum_ = 1.0
    for ii in range(1, lw + 1):
        tmp = math.exp(-0.5 * ii * ii / sd2)
        weights[lw + ii] = tmp
        weights[lw - ii] = tmp
        sum_ += 2.0 * tmp
    return [w / sum_ for w in weights]

def compute_mscn(image: np.ndarray, C: float = 1.0) -> np.ndarray:
    avg_window = _gen_gauss_window(3, 7.0 / 6.0)
    assert image.ndim == 2
    h, w = image.shape
    mu_image = np.zeros((h, w), dtype=np.float32)
    var_image = np.zeros((h, w), dtype=np.float32)
    image_f = image.astype(np.float32)

    scipy.ndimage.correlate1d(image_f, avg_window, 0, mu_image, mode='constant')
    scipy.ndimage.correlate1d(mu_image, avg_window, 1, mu_image, mode='constant')
    scipy.ndimage.correlate1d(image_f ** 2, avg_window, 0, var_image, mode='constant')
    scipy.ndimage.correlate1d(var_image, avg_window, 1, var_image, mode='constant')

    var_image = np.sqrt(np.abs(var_image - mu_image ** 2))
    return (image_f - mu_image) / (var_image + C)

def ggd_features(imdata: np.ndarray):
    nr_gam = 1.0 / prec_gammas
    sigma_sq = float(np.var(imdata))
    E = float(np.mean(np.abs(imdata)))
    if E == 0:
        return 0.2, sigma_sq
    rho = sigma_sq / (E ** 2)
    pos = np.argmin(np.abs(nr_gam - rho))
    return float(gamma_range[pos]), sigma_sq

def aggd_features(imdata: np.ndarray):
    imdata = imdata.ravel()
    imdata2 = imdata * imdata
    left_d = imdata2[imdata < 0]
    right_d = imdata2[imdata >= 0]

    lsq = np.sqrt(left_d.mean()) if left_d.size > 0 else 0.0
    rsq = np.sqrt(right_d.mean()) if right_d.size > 0 else 0.0

    gamma_hat = (lsq / rsq) if rsq != 0 else np.inf
    imdata2_mean = imdata2.mean()
    if imdata2_mean != 0:
        r_hat = (np.abs(imdata).mean() ** 2) / imdata2_mean
    else:
        r_hat = np.inf

    rhat_norm = r_hat * (
        ((math.pow(gamma_hat, 3) + 1) * (gamma_hat + 1))
        / math.pow(math.pow(gamma_hat, 2) + 1, 2)
    )

    pos = np.argmin((prec_gammas - rhat_norm) ** 2)
    alpha = float(gamma_range[pos])

    gam1 = scipy.special.gamma(1.0 / alpha)
    gam2 = scipy.special.gamma(2.0 / alpha)
    gam3 = scipy.special.gamma(3.0 / alpha)

    ratio = np.sqrt(gam1) / np.sqrt(gam3)
    bl = ratio * lsq
    br = ratio * rsq
    N = (br - bl) * (gam2 / gam1)

    return alpha, N, bl, br, lsq, rsq

def paired_product(new_im: np.ndarray):
    shift1 = np.roll(new_im, 1, axis=1)
    shift2 = np.roll(new_im, 1, axis=0)
    shift3 = np.roll(np.roll(new_im, 1, axis=0), 1, axis=1)
    shift4 = np.roll(np.roll(new_im, 1, axis=0), -1, axis=1)
    return shift1 * new_im, shift2 * new_im, shift3 * new_im, shift4 * new_im

def extract_brisque_feats(mscncoefs: np.ndarray) -> list:
    alpha_m, sigma_sq = ggd_features(mscncoefs.ravel())
    pps1, pps2, pps3, pps4 = paired_product(mscncoefs)

    a1, N1, _, _, lsq1, rsq1 = aggd_features(pps1)
    a2, N2, _, _, lsq2, rsq2 = aggd_features(pps2)
    a3, N3, _, _, lsq3, rsq3 = aggd_features(pps3)
    a4, N4, _, _, lsq4, rsq4 = aggd_features(pps4)

    return [
        alpha_m, sigma_sq,
        a1, N1, lsq1 ** 2, rsq1 ** 2,
        a2, N2, lsq2 ** 2, rsq2 ** 2,
        a3, N3, lsq3 ** 2, rsq3 ** 2,
        a4, N4, lsq4 ** 2, rsq4 ** 2,
    ]

def brisque(im: np.ndarray) -> np.ndarray:
    if im.ndim == 3:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)

    im = im.astype(np.float64)

    mscn1 = compute_mscn(im)
    feats1 = extract_brisque_feats(mscn1)

    low_res = cv2.resize(im, (0, 0), fx=0.5, fy=0.5,
                           interpolation=cv2.INTER_LINEAR)
    mscn2 = compute_mscn(low_res)
    feats2 = extract_brisque_feats(mscn2)

    return np.array(feats1 + feats2, dtype=np.float64)