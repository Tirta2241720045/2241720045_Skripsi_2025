import numpy as np
import cv2

def _calculate_mscn(dis_image: np.ndarray) -> np.ndarray:
    dis_image = dis_image.astype(np.float64)
    ux = cv2.GaussianBlur(dis_image, (7, 7), 7.0 / 6.0)
    sigma = np.sqrt(np.abs(
        cv2.GaussianBlur(dis_image ** 2, (7, 7), 7.0 / 6.0) - ux * ux
    ))
    return (dis_image - ux) / (1.0 + sigma)

def _segment_edge(blockEdge: np.ndarray, nSegments: int,
                  blockSize: int, windowSize: int) -> np.ndarray:
    segments = np.zeros((nSegments, windowSize))
    ws = windowSize
    for i in range(nSegments):
        segments[i, :] = blockEdge[i:ws]
        if ws <= (blockSize + 1):
            ws += 1
    return segments

def _notice_dist_criterion(Block: np.ndarray, nSegments: int, blockSize: int,
                            windowSize: int, blockImpairedThreshold: float,
                            N: int) -> int:
    edges = [
        Block[0, :],
        Block[N - 1, :],
        Block[:, N - 1],
        Block[:, 0],
    ]
    for edge in edges:
        segs = _segment_edge(edge, nSegments, blockSize, windowSize)
        std_dev = np.std(segs, axis=1)
        if np.any(std_dev < blockImpairedThreshold):
            return 1
    return 0

def _center_sur_dev(Block: np.ndarray, blockSize: int) -> float:
    c1 = (blockSize + 1) // 2 - 1
    c2 = c1 + 1
    center = np.concatenate([Block[:, c1], Block[:, c2]])
    surround = np.delete(np.delete(Block, c1, axis=1), c1, axis=1)
    c_std = np.std(center)
    s_std = np.std(surround)
    return c_std / s_std if s_std > 0 else 0.0

def _noise_criterion(Block: np.ndarray, blockSize: int,
                     blockVar: float):
    blockSigma = np.sqrt(blockVar)
    cenSurDev = _center_sur_dev(Block, blockSize)
    denom = max(blockSigma, cenSurDev)
    blockBeta = abs(blockSigma - cenSurDev) / denom if denom > 0 else 0.0
    return blockSigma, blockBeta

def piqe(im: np.ndarray):
    blockSize = 16
    activityThreshold = 0.1
    blockImpairedThreshold = 0.1
    windowSize = 6
    nSegments = blockSize - windowSize + 1
    NHSA = 0

    if im.ndim == 3:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)

    originalSize = im.shape
    rows, columns = originalSize

    rowsPad = rows % blockSize
    columnsPad = columns % blockSize
    isPadded = False

    if rowsPad > 0 or columnsPad > 0:
        rowsPad = (blockSize - rowsPad) if rowsPad > 0 else 0
        columnsPad = (blockSize - columnsPad) if columnsPad > 0 else 0
        isPadded = True

    im_padded = np.pad(im, ((0, rowsPad), (0, columnsPad)), mode='edge')
    imnorm = _calculate_mscn(im_padded)

    NoticeableArtifactsMask = np.zeros(imnorm.shape)
    NoiseMask = np.zeros(imnorm.shape)
    ActivityMask = np.zeros(imnorm.shape)
    BlockScores = []

    for i in range(0, imnorm.shape[0] - blockSize + 1, blockSize):
        for j in range(0, imnorm.shape[1] - blockSize + 1, blockSize):
            WNDC = 0
            WNC = 0
            Block = imnorm[i:i + blockSize, j:j + blockSize]
            blockVar = float(np.var(Block))

            if blockVar > activityThreshold:
                ActivityMask[i:i + blockSize, j:j + blockSize] = 1
                NHSA += 1

                blockImpaired = _notice_dist_criterion(
                    Block, nSegments, blockSize - 1,
                    windowSize, blockImpairedThreshold, blockSize
                )
                if blockImpaired:
                    WNDC = 1
                    NoticeableArtifactsMask[i:i + blockSize, j:j + blockSize] = blockVar

                blockSigma, blockBeta = _noise_criterion(Block, blockSize - 1, blockVar)
                if blockSigma > 2 * blockBeta:
                    WNC = 1
                    NoiseMask[i:i + blockSize, j:j + blockSize] = blockVar

                score_val = WNDC * (1 - blockVar) ** 2 + WNC * blockVar ** 2
                if score_val > 0:
                    BlockScores.append(score_val)

    if NHSA == 0 or len(BlockScores) == 0:
        Score = 0.0
    else:
        BlockScores.sort()
        lowSum = sum(BlockScores[:max(1, int(0.1 * len(BlockScores)))])
        total = sum(BlockScores)
        if total > 0:
            Scores = [(s * 10 * lowSum) / total for s in BlockScores]
        else:
            Scores = BlockScores[:]
        C = 1
        Score = ((sum(Scores) + C) / (C + NHSA)) * 100

    if isPadded:
        NoticeableArtifactsMask = NoticeableArtifactsMask[:originalSize[0], :originalSize[1]]
        NoiseMask = NoiseMask[:originalSize[0], :originalSize[1]]
        ActivityMask = ActivityMask[:originalSize[0], :originalSize[1]]

    return float(Score), NoticeableArtifactsMask, NoiseMask, ActivityMask