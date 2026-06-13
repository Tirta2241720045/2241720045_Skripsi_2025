import numpy as np


def mse(original: np.ndarray, distorted: np.ndarray) -> float:
    if original.shape != distorted.shape:
        raise ValueError(
            f"Shape tidak cocok: original {original.shape} vs distorted {distorted.shape}"
        )
    return float(np.mean((original.astype(np.float64) - distorted.astype(np.float64)) ** 2))