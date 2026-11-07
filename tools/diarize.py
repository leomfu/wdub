"""说话人分离（diarization）：听声音判断每段话是谁说的，整段音频一起分，同一个人从头到尾编号一致。

流程：VAD 找出有人说话的片段 → 每 1.5 秒取一段算声纹（CAM++，中英文通用）→ 聚类成几个人
     → 按 0.25 秒一格投票、平滑 → 合并成「几秒到几秒是第几个人」→ 用音高判断男女。
模型第一次用时自动下载（VAD 约 2MB，声纹约 28MB），之后离线可用。
"""

import numpy as np

RATE = 16000
WIN, HOP, FRAME = 1.5, 0.75, 0.25  # 声纹窗口长度、步长，投票的格子大小（秒）
EMB_MODEL = "iic/speech_campplus_sv_zh_en_16k-common_advanced"

_models = None


def models():
    global _models
    if _models is None:
        from funasr import AutoModel

        vad = AutoModel(model="fsmn-vad", disable_update=True, disable_pbar=True)
        emb = AutoModel(model=EMB_MODEL, disable_update=True, disable_pbar=True)
        _models = (vad, emb)
    return _models


def _windows(segs):
    """把每个说话片段切成重叠的小窗口；太短的片段整段算一个窗口。"""
    wins = []
    for s, e in segs:
        if e - s < WIN:
            if e - s >= 0.4:
                wins.append((s, e))
            continue
        t = s
        while t + WIN <= e + 1e-6:
            wins.append((t, t + WIN))
            t += HOP
        if wins[-1][1] < e - 0.3:
            wins.append((e - WIN, e))
    return wins


def _cluster(X, num_speakers):
    from sklearn.cluster import AgglomerativeClustering

    if len(X) < 2:
        return np.zeros(len(X), dtype=int)
    if num_speakers:
        k = min(num_speakers, len(X))
        return AgglomerativeClustering(n_clusters=k, metric="cosine", linkage="average").fit_predict(X)
    # 人数未知：余弦距离 0.6 以内算同一个人（实测同一人约 0.35、不同人约 0.7）
    lab = AgglomerativeClustering(n_clusters=None, distance_threshold=0.6, metric="cosine", linkage="average").fit_predict(X)
    # 只占极少几个窗口的小簇多半是笑声、咳嗽、音乐，并到最像的人里
    counts = np.bincount(lab)
    big = [c for c in range(len(counts)) if counts[c] >= max(3, 0.03 * len(X))]
    if not big:
        return np.zeros(len(X), dtype=int)
    cents = np.array([X[lab == c].mean(0) for c in big])
    cents /= np.linalg.norm(cents, axis=1, keepdims=True)
    out = np.array([big.index(l) if l in big else int(np.argmax(cents @ x)) for l, x in zip(lab, X)])
    return out


def _gender(pcm):
    """用音高中位数粗分男女：低于 165Hz 算男声。"""
    import librosa

    if len(pcm) < RATE:
        return "u"
    f0 = librosa.yin(pcm, fmin=60, fmax=400, sr=RATE, frame_length=1024)
    rms = librosa.feature.rms(y=pcm, frame_length=1024, hop_length=256)[0][: len(f0)]
    voiced = f0[: len(rms)][rms > np.percentile(rms, 50)]
    if not len(voiced):
        return "u"
    return "m" if float(np.median(voiced)) < 165 else "f"


def diarize(pcm, num_speakers=None, progress=lambda stage, done=0, total=0: None):
    """pcm：16kHz 单声道 float32。返回 {segments: [{start, end, speaker}], speakers: [{id, gender, seconds}]}"""
    vad, emb = models()
    progress("vad")
    segs = [(s / 1000, e / 1000) for s, e in vad.generate(input=pcm, fs=RATE, disable_pbar=True)[0]["value"]]
    wins = _windows(segs)
    if not wins:
        return {"segments": [], "speakers": []}

    X = []
    for i, (s, e) in enumerate(wins):
        r = emb.generate(input=pcm[int(s * RATE) : int(e * RATE)], disable_pbar=True)
        v = r[0]["spk_embedding"].reshape(-1).cpu().numpy()
        X.append(v / (np.linalg.norm(v) + 1e-9))
        if i % 50 == 0:
            progress("embed", i, len(wins))
    X = np.array(X)
    progress("cluster")
    lab = _cluster(X, num_speakers)
    n = int(lab.max()) + 1

    # 按 0.25 秒一格，让覆盖这一格的窗口投票；只在 VAD 认为有人说话的地方标人
    total = max(e for _, e in segs)
    frames = int(np.ceil(total / FRAME)) + 1
    votes = np.zeros((frames, n))
    for (s, e), l in zip(wins, lab):
        votes[int(s / FRAME) : int(np.ceil(e / FRAME)), l] += 1
    speech = np.zeros(frames, dtype=bool)
    for s, e in segs:
        speech[int(s / FRAME) : int(np.ceil(e / FRAME))] = True
    who = np.where(speech & (votes.sum(1) > 0), votes.argmax(1), -1)

    # 合并成连续片段；短于 0.5 秒的夹心片段并到前一段
    out = []
    for f, w in enumerate(who):
        if w < 0:
            continue
        t = f * FRAME
        if out and out[-1]["speaker"] == w and t - out[-1]["end"] < 0.3:
            out[-1]["end"] = t + FRAME
        else:
            out.append({"start": t, "end": t + FRAME, "speaker": int(w)})
    merged = []
    for seg in out:
        if merged and seg["end"] - seg["start"] < 0.5 and seg["start"] - merged[-1]["end"] < 0.3:
            merged[-1]["end"] = seg["end"]
        elif merged and merged[-1]["speaker"] == seg["speaker"] and seg["start"] - merged[-1]["end"] < 0.3:
            merged[-1]["end"] = seg["end"]
        else:
            merged.append(dict(seg))

    # 按出场顺序重新编号（第一个开口的是 0），并判断男女
    order = []
    for seg in merged:
        if seg["speaker"] not in order:
            order.append(seg["speaker"])
    remap = {old: i for i, old in enumerate(order)}
    speakers = []
    for old in order:
        mine = [seg for seg in merged if seg["speaker"] == old]
        clip = np.concatenate([pcm[int(s["start"] * RATE) : int(s["end"] * RATE)] for s in mine])[: RATE * 30]
        speakers.append({"id": remap[old], "gender": _gender(clip), "seconds": round(sum(s["end"] - s["start"] for s in mine), 1)})
    segments = [{"start": round(s["start"], 2), "end": round(s["end"], 2), "speaker": remap[s["speaker"]]} for s in merged]
    return {"segments": segments, "speakers": speakers}
