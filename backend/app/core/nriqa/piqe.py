import numpy as np
import cv2


def _calculate_mscn(dis_image: np.ndarray) -> np.ndarray:
    dis_image = dis_image.astype(np.float32)
    ux = cv2.GaussianBlur(dis_image, (7, 7), 7.0 / 6.0)
    sigma = np.sqrt(np.abs(cv2.GaussianBlur(dis_image * dis_image, (7, 7), 7.0 / 6.0) - ux * ux))
    return (dis_image - ux) / (1.0 + sigma)


def _extract_blocks(arr: np.ndarray, block_size: int) -> np.ndarray:
    """Extract non-overlapping blocks via stride tricks — zero copy."""
    H, W = arr.shape
    bH = H // block_size
    bW = W // block_size
    s0, s1 = arr.strides
    shape = (bH, bW, block_size, block_size)
    strides = (s0 * block_size, s1 * block_size, s0, s1)
    return np.lib.stride_tricks.as_strided(arr, shape=shape, strides=strides)


def _segment_edge_std(edge: np.ndarray, n_segments: int, window_size: int) -> np.ndarray:
    """Compute std of all sliding windows along edge in one vectorized pass."""
    idx = np.arange(window_size)[None, :] + np.arange(n_segments)[:, None]
    segments = edge[idx]
    return np.std(segments, axis=1)


def _block_impaired(block: np.ndarray, n_segments: int, block_size: int,
                    window_size: int, threshold: float) -> bool:
    edges = (block[0, :], block[-1, :], block[:, -1], block[:, 0])
    for edge in edges:
        if np.any(_segment_edge_std(edge, n_segments, window_size) < threshold):
            return True
    return False


def _center_sur_std_ratio(block: np.ndarray, bs: int) -> float:
    c1 = (bs + 1) // 2 - 1
    c2 = c1 + 1
    center = np.concatenate([block[:, c1], block[:, c2]])
    mask = np.ones(block.shape[1], dtype=bool)
    mask[c1] = False
    surround = block[:, mask].ravel()
    s_std = surround.std()
    return center.std() / s_std if s_std > 0 else 0.0


def piqe(im: np.ndarray):
    BLOCK = 16
    ACT_THRESH = 0.1
    IMP_THRESH = 0.1
    WIN = 6
    N_SEG = BLOCK - WIN + 1
    NHSA = 0

    if im.ndim == 3:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)

    orig_shape = im.shape
    rows, cols = orig_shape
    rpad = (-rows % BLOCK)
    cpad = (-cols % BLOCK)
    isPadded = rpad > 0 or cpad > 0

    if isPadded:
        im = np.pad(im, ((0, rpad), (0, cpad)), mode='edge')

    imnorm = _calculate_mscn(im)

    NoticeableArtifactsMask = np.zeros(imnorm.shape, dtype=np.float32)
    NoiseMask = np.zeros(imnorm.shape, dtype=np.float32)
    ActivityMask = np.zeros(imnorm.shape, dtype=np.float32)
    BlockScores = []

    # stride-trick block view: shape (bH, bW, BLOCK, BLOCK)
    blocks = _extract_blocks(imnorm, BLOCK)
    bH, bW = blocks.shape[:2]

    for bi in range(bH):
        for bj in range(bW):
            block = blocks[bi, bj]          # (BLOCK, BLOCK) view
            block_var = float(np.var(block))

            if block_var <= ACT_THRESH:
                continue

            ri, ci = bi * BLOCK, bj * BLOCK
            ActivityMask[ri:ri+BLOCK, ci:ci+BLOCK] = 1
            NHSA += 1
            WNDC = WNC = 0

            if _block_impaired(block, N_SEG, BLOCK - 1, WIN, IMP_THRESH):
                WNDC = 1
                NoticeableArtifactsMask[ri:ri+BLOCK, ci:ci+BLOCK] = block_var

            block_sigma = float(np.sqrt(block_var))
            csd = _center_sur_std_ratio(block, BLOCK - 1)
            denom = max(block_sigma, csd)
            block_beta = abs(block_sigma - csd) / denom if denom > 0 else 0.0

            if block_sigma > 2 * block_beta:
                WNC = 1
                NoiseMask[ri:ri+BLOCK, ci:ci+BLOCK] = block_var

            score_val = WNDC * (1 - block_var) ** 2 + WNC * block_var ** 2
            if score_val > 0:
                BlockScores.append(score_val)

    if NHSA == 0 or not BlockScores:
        Score = 0.0
    else:
        BlockScores.sort()
        n_low = max(1, int(0.1 * len(BlockScores)))
        low_sum = sum(BlockScores[:n_low])
        total = sum(BlockScores)
        if total > 0:
            Scores = [(s * 10 * low_sum) / total for s in BlockScores]
        else:
            Scores = BlockScores[:]
        Score = ((sum(Scores) + 1) / (1 + NHSA)) * 100

    if isPadded:
        NoticeableArtifactsMask = NoticeableArtifactsMask[:orig_shape[0], :orig_shape[1]]
        NoiseMask = NoiseMask[:orig_shape[0], :orig_shape[1]]
        ActivityMask = ActivityMask[:orig_shape[0], :orig_shape[1]]

    return float(Score), NoticeableArtifactsMask, NoiseMask, ActivityMask