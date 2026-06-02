import math
import numpy as np
import cv2
import scipy.special
import scipy.ndimage
import scipy.io
import scipy.linalg
import os

gamma_range = np.arange(0.2, 10, 0.001)
_a = scipy.special.gamma(2.0 / gamma_range)
_a *= _a
_b = scipy.special.gamma(1.0 / gamma_range)
_c = scipy.special.gamma(3.0 / gamma_range)
prec_gammas = _a / (_b * _c)

_params_path = os.path.join(os.path.dirname(__file__), 'niqe_image_params.mat')
_pop_mu = None
_pop_cov = None

def _load_params():
    global _pop_mu, _pop_cov
    if _pop_mu is None or _pop_cov is None:
        try:
            params = scipy.io.loadmat(_params_path)
            _pop_mu = np.ravel(params["pop_mu"])
            _pop_cov = params["pop_cov"]
        except:
            _pop_mu = np.zeros(18)
            _pop_cov = np.eye(18)
    return _pop_mu, _pop_cov

def aggd_features(imdata):
    imdata.shape = (len(imdata.flat),)
    imdata2 = imdata * imdata
    left_data = imdata2[imdata < 0]
    right_data = imdata2[imdata >= 0]
    left_mean_sqrt = 0
    right_mean_sqrt = 0
    if len(left_data) > 0:
        left_mean_sqrt = np.sqrt(np.average(left_data))
    if len(right_data) > 0:
        right_mean_sqrt = np.sqrt(np.average(right_data))
    if right_mean_sqrt != 0:
        gamma_hat = left_mean_sqrt / right_mean_sqrt
    else:
        gamma_hat = np.inf
    imdata2_mean = np.mean(imdata2)
    if imdata2_mean != 0:
        r_hat = (np.average(np.abs(imdata)) ** 2) / np.average(imdata2)
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
    return (alpha, N, bl, br, left_mean_sqrt, right_mean_sqrt)

def paired_product(new_im):
    shift1 = np.roll(new_im.copy(), 1, axis=1)
    shift2 = np.roll(new_im.copy(), 1, axis=0)
    shift3 = np.roll(np.roll(new_im.copy(), 1, axis=0), 1, axis=1)
    shift4 = np.roll(np.roll(new_im.copy(), 1, axis=0), -1, axis=1)
    return shift1 * new_im, shift2 * new_im, shift3 * new_im, shift4 * new_im

def gen_gauss_window(lw, sigma):
    sd = np.float32(sigma)
    lw = int(lw)
    weights = [0.0] * (2 * lw + 1)
    weights[lw] = 1.0
    sum_ = 1.0
    sd *= sd
    for ii in range(1, lw + 1):
        tmp = np.exp(-0.5 * np.float32(ii * ii) / sd)
        weights[lw + ii] = tmp
        weights[lw - ii] = tmp
        sum_ += 2.0 * tmp
    for ii in range(2 * lw + 1):
        weights[ii] /= sum_
    return weights

def compute_image_mscn_transform(image, C=1, avg_window=None, extend_mode='constant'):
    if avg_window is None:
        avg_window = gen_gauss_window(3, 7.0 / 6.0)
    assert len(np.shape(image)) == 2
    h, w = np.shape(image)
    mu_image = np.zeros((h, w), dtype=np.float32)
    var_image = np.zeros((h, w), dtype=np.float32)
    image = np.array(image).astype('float32')
    scipy.ndimage.correlate1d(image, avg_window, 0, mu_image, mode=extend_mode)
    scipy.ndimage.correlate1d(mu_image, avg_window, 1, mu_image, mode=extend_mode)
    scipy.ndimage.correlate1d(image ** 2, avg_window, 0, var_image, mode=extend_mode)
    scipy.ndimage.correlate1d(var_image, avg_window, 1, var_image, mode=extend_mode)
    var_image = np.sqrt(np.abs(var_image - mu_image ** 2))
    return (image - mu_image) / (var_image + C), var_image, mu_image

def _niqe_extract_subband_feats(mscncoefs):
    alpha_m, N, bl, br, lsq, rsq = aggd_features(mscncoefs.copy())
    pps1, pps2, pps3, pps4 = paired_product(mscncoefs)
    alpha1, N1, bl1, br1, lsq1, rsq1 = aggd_features(pps1)
    alpha2, N2, bl2, br2, lsq2, rsq2 = aggd_features(pps2)
    alpha3, N3, bl3, br3, lsq3, rsq3 = aggd_features(pps3)
    alpha4, N4, bl4, br4, lsq4, rsq4 = aggd_features(pps4)
    return np.array([
        alpha_m, (bl + br) / 2.0,
        alpha1, N1, bl1, br1,
        alpha2, N2, bl2, br2,
        alpha3, N3, bl3, bl3,
        alpha4, N4, bl4, bl4,
    ])

def extract_on_patches(img, patch_size):
    h, w = img.shape
    patch_size = int(patch_size)
    patches = []
    for j in range(0, h - patch_size + 1, patch_size):
        for i in range(0, w - patch_size + 1, patch_size):
            patches.append(img[j:j + patch_size, i:i + patch_size])
    if len(patches) == 0:
        return np.array([])
    patches = np.array(patches)
    return np.array([_niqe_extract_subband_feats(p) for p in patches])

def get_patches_test_features(img, patch_size):
    h, w = np.shape(img)
    hoffset = h % patch_size
    woffset = w % patch_size
    if hoffset > 0:
        img = img[:-hoffset, :]
    if woffset > 0:
        img = img[:, :-woffset]
    img = img.astype(np.float32)
    img2 = cv2.resize(img, (0, 0), fx=0.5, fy=0.5)
    mscn1, _, _ = compute_image_mscn_transform(img)
    mscn1 = mscn1.astype(np.float32)
    mscn2, _, _ = compute_image_mscn_transform(img2)
    mscn2 = mscn2.astype(np.float32)
    feats_lvl1 = extract_on_patches(mscn1, patch_size)
    feats_lvl2 = extract_on_patches(mscn2, patch_size // 2)
    if len(feats_lvl1) == 0 or len(feats_lvl2) == 0:
        return np.array([])
    return np.hstack((feats_lvl1, feats_lvl2))

def niqe(inputImgData):
    if inputImgData is None:
        return 8.0
    if inputImgData.ndim == 3:
        inputImgData = cv2.cvtColor(inputImgData, cv2.COLOR_BGR2GRAY)
    patch_size = 96
    M, N = inputImgData.shape
    min_size = patch_size * 2 + 1
    if M < min_size or N < min_size:
        scale = max(min_size / M, min_size / N)
        new_w = int(N * scale)
        new_h = int(M * scale)
        inputImgData = cv2.resize(inputImgData, (new_w, new_h))
        M, N = inputImgData.shape
    feats = get_patches_test_features(inputImgData, patch_size)
    if len(feats) == 0:
        return 8.0
    pop_mu, pop_cov = _load_params()
    sample_mu = np.mean(feats, axis=0)
    sample_cov = np.cov(feats.T)
    X = sample_mu - pop_mu
    covmat = (pop_cov + sample_cov) / 2.0
    covmat = covmat + np.eye(covmat.shape[0]) * 1e-6
    try:
        pinvmat = scipy.linalg.pinv(covmat)
        score = float(np.sqrt(np.dot(np.dot(X, pinvmat), X)))
        score = max(0, min(15, score))
        return score
    except:
        return 8.0