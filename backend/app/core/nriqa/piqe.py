import numpy as np
import cv2

def calculate_mscn(dis_image):
    dis_image = dis_image.astype(np.float32)
    dis_image = np.maximum(dis_image, 0)
    ux = cv2.GaussianBlur(dis_image, (7, 7), 7 / 6)
    sigma = np.sqrt(np.abs(cv2.GaussianBlur(dis_image ** 2, (7, 7), 7 / 6) - ux * ux))
    return (dis_image - ux) / (sigma + 1)

def segmentEdge(blockEdge, nSegments, blockSize, windowSize):
    segments = np.zeros((nSegments, windowSize))
    for i in range(nSegments):
        segments[i, :] = blockEdge[i:windowSize + i]
        if windowSize <= (blockSize + 1):
            windowSize = windowSize + 1
    return segments

def noticeDistCriterion(Block, nSegments, blockSize, windowSize, blockImpairedThreshold, N):
    topEdge = Block[0, :]
    segTopEdge = segmentEdge(topEdge, nSegments, blockSize, windowSize)
    rightSideEdge = np.transpose(Block[:, N - 1])
    segRightSideEdge = segmentEdge(rightSideEdge, nSegments, blockSize, windowSize)
    downSideEdge = Block[N - 1, :]
    segDownSideEdge = segmentEdge(downSideEdge, nSegments, blockSize, windowSize)
    leftSideEdge = np.transpose(Block[:, 0])
    segLeftSideEdge = segmentEdge(leftSideEdge, nSegments, blockSize, windowSize)
    segTopEdge_stdDev = np.std(segTopEdge, axis=1)
    segRightSideEdge_stdDev = np.std(segRightSideEdge, axis=1)
    segDownSideEdge_stdDev = np.std(segDownSideEdge, axis=1)
    segLeftSideEdge_stdDev = np.std(segLeftSideEdge, axis=1)
    blockImpaired = 0
    for segIndex in range(segTopEdge.shape[0]):
        if (
            segTopEdge_stdDev[segIndex] < blockImpairedThreshold
            or segRightSideEdge_stdDev[segIndex] < blockImpairedThreshold
            or segDownSideEdge_stdDev[segIndex] < blockImpairedThreshold
            or segLeftSideEdge_stdDev[segIndex] < blockImpairedThreshold
        ):
            blockImpaired = 1
            break
    return blockImpaired

def centerSurDev(Block, blockSize):
    center1 = int((blockSize + 1) / 2) - 1
    center2 = center1 + 1
    center = np.vstack((Block[:, center1], Block[:, center2]))
    Block = np.delete(Block, center1, axis=1)
    Block = np.delete(Block, center1, axis=1)
    center_std = np.std(center)
    surround_std = np.std(Block)
    if surround_std == 0:
        return 1.0
    return center_std / surround_std

def noiseCriterion(Block, blockSize, blockVar):
    blockSigma = np.sqrt(blockVar)
    cenSurDev = centerSurDev(Block, blockSize)
    blockBeta = abs(blockSigma - cenSurDev) / max(blockSigma, cenSurDev)
    return blockSigma, blockBeta

def piqe(im):
    if im is None:
        return 35.0, None, None, None
    blockSize = 16
    activityThreshold = 0.08
    blockImpairedThreshold = 0.12
    windowSize = 6
    nSegments = blockSize - windowSize + 1
    if len(im.shape) == 3:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    im = cv2.normalize(im, None, 0, 255, cv2.NORM_MINMAX)
    originalSize = im.shape
    rows, columns = originalSize
    rowsPad = rows % blockSize
    columnsPad = columns % blockSize
    isPadded = False
    if rowsPad > 0 or columnsPad > 0:
        if rowsPad > 0:
            rowsPad = blockSize - rowsPad
        if columnsPad > 0:
            columnsPad = blockSize - columnsPad
        isPadded = True
    im = np.pad(im, ((0, rowsPad), (0, columnsPad)), 'edge')
    imnorm = calculate_mscn(im)
    NoticeableArtifactsMask = np.zeros(imnorm.shape)
    NoiseMask = np.zeros(imnorm.shape)
    ActivityMask = np.zeros(imnorm.shape)
    BlockScores = []
    NHSA = 0
    for i in np.arange(0, imnorm.shape[0] - 1, blockSize):
        for j in np.arange(0, imnorm.shape[1] - 1, blockSize):
            WNDC = 0
            WNC = 0
            Block = imnorm[i:i + blockSize, j:j + blockSize]
            blockVar = np.var(Block)
            if blockVar > activityThreshold:
                ActivityMask[i:i + blockSize, j:j + blockSize] = 1
                NHSA += 1
                blockImpaired = noticeDistCriterion(
                    Block, nSegments, blockSize - 1, windowSize,
                    blockImpairedThreshold, blockSize
                )
                if blockImpaired:
                    WNDC = 1
                    NoticeableArtifactsMask[i:i + blockSize, j:j + blockSize] = blockVar
                blockSigma, blockBeta = noiseCriterion(Block, blockSize - 1, blockVar)
                if blockSigma > 1.8 * blockBeta:
                    WNC = 1
                    NoiseMask[i:i + blockSize, j:j + blockSize] = blockVar
                score_val = WNDC * pow(1 - blockVar, 2) + WNC * pow(blockVar, 2)
                if score_val > 0:
                    BlockScores.append(score_val)
    if len(BlockScores) == 0 or NHSA == 0:
        Score = 35.0
    else:
        BlockScores = sorted(BlockScores)
        lowCount = max(1, int(0.1 * len(BlockScores)))
        lowSum = sum(BlockScores[:lowCount])
        Sum = sum(BlockScores)
        Scores = [(s * 10 * lowSum) / Sum for s in BlockScores]
        C = 1
        Score = ((sum(Scores) + C) / (C + NHSA)) * 100
        Score = max(0, min(100, Score))
    if isPadded:
        NoticeableArtifactsMask = NoticeableArtifactsMask[0:originalSize[0], 0:originalSize[1]]
        NoiseMask = NoiseMask[0:originalSize[0], 0:originalSize[1]]
        ActivityMask = ActivityMask[0:originalSize[0], 0:originalSize[1]]
    return Score, NoticeableArtifactsMask, NoiseMask, ActivityMask