import math
import numpy as np
import cv2
import scipy.special
import scipy.ndimage
import scipy.io
import scipy.linalg
from os.path import dirname, join

gamma_range = np.arange(0.2, 10, 0.001)
_a = scipy.special.gamma(2.0 / gamma_range)
_a *= _a
_b = scipy.special.gamma(1.0 / gamma_range)
_c = scipy.special.gamma(3.0 / gamma_range)
prec_gammas = _a / (_b * _c)

def aggd_features(imdata: np.ndarray):
    imdata = imdata.ravel()
    imdata2 = imdata * imdata
    left_data = imdata2[imdata < 0]
    right_data = imdata2[imdata >= 0]

    left_mean_sqrt = np.sqrt(left_data.mean()) if left_data.size > 0 else 0.0
    right_mean_sqrt = np.sqrt(right_data.mean()) if right_data.size > 0 else 0.0

    gamma_hat = (left_mean_sqrt / right_mean_sqrt) if right_mean_sqrt != 0 else np.inf

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
    alpha = gamma_range[pos]

    gam1 = scipy.special.gamma(1.0 / alpha)
    gam2 = scipy.special.gamma(2.0 / alpha)
    gam3 = scipy.special.gamma(3.0 / alpha)

    aggdratio = np.sqrt(gam1) / np.sqrt(gam3)
    bl = aggdratio * left_mean_sqrt
    br = aggdratio * right_mean_sqrt
    N = (br - bl) * (gam2 / gam1)

    return alpha, N, bl, br, left_mean_sqrt, right_mean_sqrt

def paired_product(new_im: np.ndarray):
    shift1 = np.roll(new_im, 1, axis=1)
    shift2 = np.roll(new_im, 1, axis=0)
    shift3 = np.roll(np.roll(new_im, 1, axis=0), 1, axis=1)
    shift4 = np.roll(np.roll(new_im, 1, axis=0), -1, axis=1)
    return shift1 * new_im, shift2 * new_im, shift3 * new_im, shift4 * new_im

def gen_gauss_window(lw: int, sigma: float):
    sd = float(sigma)
    lw = int(lw)
    weights = [0.0] * (2 * lw + 1)
    weights[lw] = 1.0
    sum_ = 1.0
    sd2 = sd * sd
    for ii in range(1, lw + 1):
        tmp = math.exp(-0.5 * ii * ii / sd2)
        weights[lw + ii] = tmp
        weights[lw - ii] = tmp
        sum_ += 2.0 * tmp
    return [w / sum_ for w in weights]

def compute_image_mscn_transform(image: np.ndarray, C: float = 1.0,
                                  avg_window=None, extend_mode: str = 'constant'):
    if avg_window is None:
        avg_window = gen_gauss_window(3, 7.0 / 6.0)
    assert image.ndim == 2
    h, w = image.shape
    mu_image = np.zeros((h, w), dtype=np.float32)
    var_image = np.zeros((h, w), dtype=np.float32)
    image_f = image.astype(np.float32)

    scipy.ndimage.correlate1d(image_f, avg_window, 0, mu_image, mode=extend_mode)
    scipy.ndimage.correlate1d(mu_image, avg_window, 1, mu_image, mode=extend_mode)
    scipy.ndimage.correlate1d(image_f ** 2, avg_window, 0, var_image, mode=extend_mode)
    scipy.ndimage.correlate1d(var_image, avg_window, 1, var_image, mode=extend_mode)

    var_image = np.sqrt(np.abs(var_image - mu_image ** 2))
    return (image_f - mu_image) / (var_image + C), var_image, mu_image

def _niqe_extract_subband_feats(mscncoefs: np.ndarray) -> np.ndarray:
    alpha_m, N_m, bl_m, br_m, _, _ = aggd_features(mscncoefs.copy())

    pps1, pps2, pps3, pps4 = paired_product(mscncoefs)

    alpha1, N1, bl1, br1, _, _ = aggd_features(pps1)
    alpha2, N2, bl2, br2, _, _ = aggd_features(pps2)
    alpha3, N3, bl3, br3, _, _ = aggd_features(pps3)
    alpha4, N4, bl4, br4, _, _ = aggd_features(pps4)

    return np.array([
        alpha_m, (bl_m + br_m) / 2.0,
        alpha1, N1, bl1, br1,
        alpha2, N2, bl2, br2,
        alpha3, N3, bl3, br3,
        alpha4, N4, bl4, br4,
    ])

def extract_on_patches(img: np.ndarray, patch_size: int) -> np.ndarray:
    h, w = img.shape
    ps = int(patch_size)
    patches = [
        img[j:j + ps, i:i + ps]
        for j in range(0, h - ps + 1, ps)
        for i in range(0, w - ps + 1, ps)
    ]
    return np.array([_niqe_extract_subband_feats(p) for p in patches])

def get_patches_test_features(img: np.ndarray, patch_size: int) -> np.ndarray:
    h, w = img.shape
    hoffset = h % patch_size
    woffset = w % patch_size
    if hoffset > 0:
        img = img[:-hoffset, :]
    if woffset > 0:
        img = img[:, :-woffset]

    img = img.astype(np.float32)
    img2 = cv2.resize(img, (0, 0), fx=0.5, fy=0.5)

    mscn1, _, _ = compute_image_mscn_transform(img)
    mscn2, _, _ = compute_image_mscn_transform(img2)

    feats1 = extract_on_patches(mscn1.astype(np.float32), patch_size)
    feats2 = extract_on_patches(mscn2.astype(np.float32), patch_size // 2)

    return np.hstack((feats1, feats2))

def niqe(inputImgData: np.ndarray) -> float:
    patch_size = 96
    module_path = dirname(__file__)
    params = scipy.io.loadmat(join(module_path, 'niqe_image_params.mat'))
    pop_mu = np.ravel(params["pop_mu"])
    pop_cov = params["pop_cov"]

    if inputImgData.ndim == 3:
        inputImgData = cv2.cvtColor(inputImgData, cv2.COLOR_BGR2GRAY)

    M, N = inputImgData.shape
    assert M > (patch_size * 2 + 1), \
        f"Image too small ({M}×{N}), requires > {patch_size * 2 + 1}×{patch_size * 2 + 1}"
    assert N > (patch_size * 2 + 1), \
        f"Image too small ({M}×{N}), requires > {patch_size * 2 + 1}×{patch_size * 2 + 1}"

    feats = get_patches_test_features(inputImgData, patch_size)
    sample_mu = np.mean(feats, axis=0)
    sample_cov = np.cov(feats.T)

    X = sample_mu - pop_mu
    covmat = (pop_cov + sample_cov) / 2.0
    pinvmat = scipy.linalg.pinv(covmat)

    score = float(np.sqrt(np.dot(np.dot(X, pinvmat), X)))
    return max(0.0, score)