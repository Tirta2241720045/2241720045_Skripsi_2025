import numpy as np


def ssim(original: np.ndarray, distorted: np.ndarray) -> float:
    if original.shape != distorted.shape:
        raise ValueError(
            f"Shape tidak cocok: original {original.shape} vs distorted {distorted.shape}"
        )
    if original.ndim == 3:
        return float(np.mean([
            _ssim_channel(original[:, :, c].astype(np.float64), distorted[:, :, c].astype(np.float64))
            for c in range(original.shape[2])
        ]))
    return _ssim_channel(original.astype(np.float64), distorted.astype(np.float64))


def _ssim_channel(a: np.ndarray, b: np.ndarray) -> float:
    C1 = (0.01 * 255) ** 2
    C2 = (0.03 * 255) ** 2
    mu_a = a.mean()
    mu_b = b.mean()
    a_c = a - mu_a
    b_c = b - mu_b
    n = a.size
    s2_a = float(np.dot(a_c.ravel(), a_c.ravel())) / n
    s2_b = float(np.dot(b_c.ravel(), b_c.ravel())) / n
    cov = float(np.dot(a_c.ravel(), b_c.ravel())) / n
    num = (2.0 * mu_a * mu_b + C1) * (2.0 * cov + C2)
    den = (mu_a ** 2 + mu_b ** 2 + C1) * (s2_a + s2_b + C2)
    return 1.0 if den == 0 else float(num / den)