import math
import numpy as np

from .mse import mse


def psnr(original: np.ndarray, distorted: np.ndarray, max_val: float = 255.0) -> float:
    mse_val = mse(original, distorted)
    if mse_val == 0.0:
        return 100.0
    return min(10.0 * math.log10(max_val ** 2 / mse_val), 100.0)