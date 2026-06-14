import math
import numpy as np
import cv2
import scipy.special
from joblib import load
from os.path import dirname, join

gamma_range = np.arange(0.2, 10, 0.001)
_a = scipy.special.gamma(2.0 / gamma_range)
_a *= _a
_b = scipy.special.gamma(1.0 / gamma_range)
_c = scipy.special.gamma(3.0 / gamma_range)
prec_gammas = _a / (_b * _c)

_CURRENT_DIR = dirname(__file__)
_SVR_MODEL_PATH = join(_CURRENT_DIR, 'svr_brisque.joblib')

_svr_model = None
_scaler = None


def _get_svr_model():
    global _svr_model, _scaler
    if _svr_model is None:
        try:
            model_data = load(_SVR_MODEL_PATH)
            _svr_model = model_data['model']
            _scaler = model_data['scaler']
        except Exception:
            _svr_model = None
            _scaler = None
    return _svr_model, _scaler


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


def ggd_features(imdata):
    nr_gam = 1 / prec_gammas
    sigma_sq = np.var(imdata)
    E = np.mean(np.abs(imdata))
    rho = sigma_sq / E ** 2
    pos = np.argmin(np.abs(nr_gam - rho))
    return gamma_range[pos], sigma_sq


def paired_product(new_im):
    shift1 = np.roll(new_im.copy(), 1, axis=1)
    shift2 = np.roll(new_im.copy(), 1, axis=0)
    shift3 = np.roll(np.roll(new_im.copy(), 1, axis=0), 1, axis=1)
    shift4 = np.roll(np.roll(new_im.copy(), 1, axis=0), -1, axis=1)
    return shift1 * new_im, shift2 * new_im, shift3 * new_im, shift4 * new_im


def calculate_mscn(dis_image):
    dis_image = dis_image.astype(np.float32)
    ux = cv2.GaussianBlur(dis_image, (7, 7), 7 / 6)
    sigma = np.sqrt(np.abs(cv2.GaussianBlur(dis_image ** 2, (7, 7), 7 / 6) - ux * ux))
    return (dis_image - ux) / (1 + sigma)


def extract_brisque_feats(mscncoefs):
    alpha_m, sigma_sq = ggd_features(mscncoefs.copy())
    pps1, pps2, pps3, pps4 = paired_product(mscncoefs)
    alpha1, N1, bl1, br1, lsq1, rsq1 = aggd_features(pps1)
    alpha2, N2, bl2, br2, lsq2, rsq2 = aggd_features(pps2)
    alpha3, N3, bl3, br3, lsq3, rsq3 = aggd_features(pps3)
    alpha4, N4, bl4, br4, lsq4, rsq4 = aggd_features(pps4)
    return [
        alpha_m, sigma_sq,
        alpha1, N1, lsq1 ** 2, rsq1 ** 2,
        alpha2, N2, lsq2 ** 2, rsq2 ** 2,
        alpha3, N3, lsq3 ** 2, rsq3 ** 2,
        alpha4, N4, lsq4 ** 2, rsq4 ** 2,
    ]


def brisque(im):
    if len(im.shape) == 3:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    mscncoefs = calculate_mscn(im)
    features1 = extract_brisque_feats(mscncoefs)
    low_res = cv2.resize(im, (0, 0), fx=0.5, fy=0.5)
    mscncoefs2 = calculate_mscn(low_res)
    features2 = extract_brisque_feats(mscncoefs2)
    features = np.array(features1 + features2)
    clf, scaler = _get_svr_model()
    if clf is not None and scaler is not None:
        features_scaled = scaler.transform(features.reshape(1, -1))
        return float(clf.predict(features_scaled)[0])
    return 0.0