"""W 声幕本地语音识别服务，提供 OpenAI 兼容的 /v1/audio/transcriptions。

两个后端，按请求里的 model 自动选择：
  - mlx-whisper（Apple 芯片加速）：英文等外语视频，model 形如 mlx-community/whisper-large-v3-turbo
  - SenseVoice（阿里 FunASR）：中文、粤语视频，model 为 iic/SenseVoiceSmall

另有「识别人物」：POST /v1/speakers 提交视频地址，用 yt-dlp 下载音频后分出每段话是谁说的
（本地声纹模型，或者用 ElevenLabs），GET /v1/speakers/<任务号> 查进度和结果。
无字幕流媒体：POST /v1/video/transcriptions 用 yt-dlp 提取音频并用本地模型生成带时间字幕，
GET /v1/video/transcriptions/<任务号> 查询进度和结果。

启动：bash tools/start-whisper.sh               # 只用 Whisper
      bash tools/start-whisper.sh --sensevoice  # 同时安装并启用 SenseVoice
默认地址：http://127.0.0.1:8199/v1   只监听本机，不对外开放。
"""

import argparse
import glob
import ipaddress
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import mlx_whisper
import numpy as np

DEFAULT_MODEL = "mlx-community/whisper-large-v3-turbo"
# 所有识别都放在同一个常驻线程里跑：MLX 在新线程上会重新初始化 GPU 上下文，
# 每个请求换一个线程会慢约 3 倍；单线程也保证 GPU 同一时间只跑一个任务。
gpu_worker = ThreadPoolExecutor(max_workers=1)


def parse_multipart(content_type: str, body: bytes) -> dict:
    """解析 multipart/form-data，返回 {字段名: bytes}；同名字段（如 timestamp_granularities[]）合并成列表。"""
    msg = BytesParser(policy=HTTP).parsebytes(b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + body)
    fields = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        data = part.get_payload(decode=True) or b""
        if name in fields:
            prev = fields[name]
            fields[name] = (prev if isinstance(prev, list) else [prev]) + [data]
        else:
            fields[name] = data
    return fields


def text_field(fields: dict, name: str, default: str = "") -> str:
    value = fields.get(name, default.encode())
    if isinstance(value, list):
        value = value[0]
    return value.decode("utf-8", "replace").strip() if isinstance(value, bytes) else value


SENSEVOICE_MODEL = "iic/SenseVoiceSmall"
_sensevoice = None  # (vad 模型, 识别模型)，首次使用时加载


def is_sensevoice(model: str) -> bool:
    return "sensevoice" in model.lower()


def load_sensevoice():
    global _sensevoice
    if _sensevoice is None:
        try:
            from funasr import AutoModel
        except ImportError as e:
            raise RuntimeError("没有安装 SenseVoice，请用 bash tools/start-whisper.sh --sensevoice 启动服务") from e
        # 模型默认从 ModelScope 下载（国内速度快），之后离线可用
        # 默认 0.8 秒静音才断开，对话里换人时的停顿常常不到这么长，整段会被当成一句，
        # SenseVoice 处理过长片段时会丢掉后半部分文字；改成 0.3 秒断开，单段最长 15 秒
        vad = AutoModel(model="fsmn-vad", disable_update=True, device="cpu", max_end_silence_time=300, max_single_segment_time=15000)
        asr = AutoModel(model=SENSEVOICE_MODEL, disable_update=True, device="cpu")
        _sensevoice = (vad, asr)
    return _sensevoice


def read_pcm16k(path: str) -> np.ndarray:
    """用 ffmpeg 把任意音频转成 16kHz 单声道 float32。"""
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


SV_TAG = re.compile(r"<\|[^|]*\|>")  # SenseVoice 输出里的 <|zh|><|NEUTRAL|><|Speech|> 等标签
SENTENCE = re.compile(r"[^。！？!?；;]+[。！？!?；;]*")


def split_sentences(text: str, start: float, end: float) -> list[dict]:
    """一段 VAD 片段可能包含好几句话：按句末标点拆开，时间按字数比例分配。"""
    parts = [p.strip() for p in SENTENCE.findall(text) if p.strip()]
    total = sum(len(p) for p in parts) or 1
    out, t = [], start
    for p in parts:
        d = (end - start) * len(p) / total
        out.append({"start": round(t, 3), "end": round(t + d, 3), "text": p})
        t += d
    return out


def transcribe_sensevoice(path: str, language: str | None) -> dict:
    vad, asr = load_sensevoice()
    audio = read_pcm16k(path)
    spans = vad.generate(input=audio)[0]["value"]  # [[开始毫秒, 结束毫秒], ...]
    # VAD 切得很碎；相邻且间隔 < 0.3 秒的合并到最长 15 秒，给模型足够的上下文
    merged = []
    for b, e in spans:
        if merged and b - merged[-1][1] < 300 and e - merged[-1][0] < 15000:
            merged[-1][1] = e
        else:
            merged.append([b, e])
    lang = {"zh": "zh", "en": "en", "ja": "ja", "ko": "ko", "yue": "yue"}.get((language or "").lower(), "auto")
    segments = []
    for b, e in merged:
        clip = audio[b * 16 : e * 16]
        if len(clip) < 1600:  # 不到 0.1 秒
            continue
        text = asr.generate(input=clip, language=lang, use_itn=True)[0]["text"]
        text = SV_TAG.sub("", text).strip()
        if text:
            segments += split_sentences(text, b / 1000, e / 1000)
    return {
        "language": lang if lang != "auto" else "zh",
        "text": "".join(s["text"] for s in segments),
        "segments": [{"id": i, **s} for i, s in enumerate(segments)],
    }


def transcribe_path(path: str, model: str, language: str | None) -> dict:
    if is_sensevoice(model):
        started = time.time()
        result = gpu_worker.submit(transcribe_sensevoice, path, language).result()
        print(f"SenseVoice 识别完成：{len(result['segments'])} 句，用时 {time.time() - started:.1f}s", flush=True)
        return {"task": "transcribe", "duration": result["segments"][-1]["end"] if result["segments"] else 0, **result}
    started = time.time()
    result = gpu_worker.submit(
        mlx_whisper.transcribe,
        path,
        path_or_hf_repo=model,
        language=language or None,
        word_timestamps=True,
        # 不拿上一段文字做提示，能明显减少 Whisper 重复同一句的“幻听”
        condition_on_previous_text=False,
        # 静音超过 2 秒处出现的可疑文字直接丢弃（片尾“感谢观看”这类）
        hallucination_silence_threshold=2.0,
        # 没有人声的片段少重试几次，避免在音乐、提示音上空转
        temperature=(0.0, 0.2, 0.4),
    ).result()
    print(f"识别完成：{len(result.get('segments', []))} 段，用时 {time.time() - started:.1f}s", flush=True)

    segments, words = [], []
    for i, s in enumerate(result.get("segments", [])):
        segments.append(
            {
                "id": i,
                "start": s["start"],
                "end": s["end"],
                "text": s["text"],
                "avg_logprob": s.get("avg_logprob", 0),
                "no_speech_prob": s.get("no_speech_prob", 0),
            }
        )
        for w in s.get("words", []):
            words.append({"word": w["word"], "start": w["start"], "end": w["end"]})
    duration = segments[-1]["end"] if segments else 0
    return {
        "task": "transcribe",
        "language": result.get("language", language or ""),
        "duration": duration,
        "text": result.get("text", ""),
        "segments": segments,
        "words": words,
    }


def transcribe(audio: bytes, model: str, language: str | None) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio)
        path = f.name
    try:
        return transcribe_path(path, model, language)
    finally:
        os.unlink(path)


MAX_BODY = 300 * 1024 * 1024  # 扩展会把长音频切成小段上传，单次请求不会超过这个大小


def allowed_model(model: str, default: str) -> bool:
    # 只加载启动时指定的模型、SenseVoice 或 mlx-community 的官方转换模型，防止被要求下载任意仓库
    return model in (default, SENSEVOICE_MODEL) or model.startswith("mlx-community/")


# ---------- 识别人物（说话人分离） ----------

speaker_worker = ThreadPoolExecutor(max_workers=1)  # 一次只分析一个视频
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
video_worker = ThreadPoolExecutor(max_workers=1)
VIDEO_JOBS: dict[str, dict] = {}
MAX_HOURS = 4


def public_url(url: str) -> bool:
    """只下载公网的 http(s) 地址，不让请求去碰本机和内网。
    只看网址本身，不查 DNS：用代理（Clash 等 fake-ip 模式）时所有域名都会解析成 198.18.x.x，按 IP 判断会误伤"""
    p = urlparse(url)
    host = (p.hostname or "").lower()
    if p.scheme not in ("http", "https") or not host:
        return False
    if host == "localhost" or host.endswith((".localhost", ".local", ".lan", ".internal", ".home.arpa")):
        return False
    try:
        ip = ipaddress.ip_address(host)
        return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified)
    except ValueError:
        return "." in host  # 普通域名


def download_audio(url: str, folder: str) -> str:
    """用 yt-dlp 下载音频（YouTube、B 站等网站和直接的视频地址都行）。
    用服务自己环境里的 yt-dlp（start-whisper.sh 每次启动时更新到最新版，YouTube 改规则后旧版会下载失败）；
    YouTube 需要 JavaScript 运行环境，有 Deno 用 Deno，没有就用 Node.js"""
    r = subprocess.run(
        [sys.executable, "-m", "yt_dlp", "--js-runtimes", "deno", "--js-runtimes", "node", "-f", "bestaudio/best", "--no-playlist", "--no-progress", "--no-warnings", "--max-filesize", "800M",
         "--match-filter", f"!is_live & duration <? {MAX_HOURS * 3600}", "-o", os.path.join(folder, "audio.%(ext)s"), url],
        capture_output=True, text=True, timeout=3600,
    )
    files = glob.glob(os.path.join(folder, "audio.*"))
    if not files:
        msg = (r.stderr.strip().splitlines() or [""])[-1]
        if "No module named yt_dlp" in r.stderr:
            raise RuntimeError("还没有安装 yt-dlp：关掉识别服务，重新运行 bash tools/start-whisper.sh（会自动安装）")
        if r.returncode == 0:
            msg = f"视频超过 {MAX_HOURS} 小时或是直播，不能识别"
        raise RuntimeError(f"下载音频失败：{msg or 'yt-dlp 没有下载到文件'}")
    return files[0]


def elevenlabs_speakers(path: str, pcm: np.ndarray, key: str, num: int | None) -> dict:
    """用 ElevenLabs Scribe 分人：逐词带说话人编号，合并成片段；男女还是用本地音高判断"""
    import requests
    from diarize import RATE, _gender

    data = {"model_id": "scribe_v1", "diarize": "true", "timestamps_granularity": "word", "tag_audio_events": "false"}
    if num:
        data["num_speakers"] = str(num)
    with open(path, "rb") as f:
        r = requests.post("https://api.elevenlabs.io/v1/speech-to-text", headers={"xi-api-key": key}, data=data, files={"file": f}, timeout=3600)
    if r.status_code in (401, 403):
        raise RuntimeError("ElevenLabs 拒绝了请求：key 不对，或者额度用完了")
    if not r.ok:
        raise RuntimeError(f"ElevenLabs 出错（{r.status_code}）：{r.text[:160]}")
    words = [w for w in r.json().get("words", []) if w.get("type") == "word" and w.get("speaker_id") is not None]
    order, segs = [], []
    for w in words:
        sid = w["speaker_id"]
        if sid not in order:
            order.append(sid)
        spk = order.index(sid)
        if segs and segs[-1]["speaker"] == spk and w["start"] - segs[-1]["end"] < 1.0:
            segs[-1]["end"] = w["end"]
        else:
            segs.append({"start": w["start"], "end": w["end"], "speaker": spk})
    speakers = []
    for i in range(len(order)):
        mine = [s for s in segs if s["speaker"] == i]
        clip = np.concatenate([pcm[int(s["start"] * RATE) : int(s["end"] * RATE)] for s in mine])[: RATE * 30]
        speakers.append({"id": i, "gender": _gender(clip), "seconds": round(sum(s["end"] - s["start"] for s in mine), 1)})
    return {"segments": [{"start": round(s["start"], 2), "end": round(s["end"], 2), "speaker": s["speaker"]} for s in segs], "speakers": speakers}


def run_speakers(job: dict, url: str, engine: str, num: int | None, key: str):
    def progress(stage, done=0, total=0):
        job.update(stage=stage, done=done, total=total)

    try:
        with tempfile.TemporaryDirectory() as folder:  # 音频分析完就删
            progress("download")
            path = download_audio(url, folder)
            progress("decode")
            pcm = read_pcm16k(path)
            if engine == "elevenlabs":
                progress("upload")
                result = elevenlabs_speakers(path, pcm, key, num)
            else:
                from diarize import diarize

                result = diarize(pcm, num, progress)
        job.update(stage="done", result=result)
    except FileNotFoundError as e:
        job.update(stage="error", error="需要先安装 ffmpeg：在终端运行 brew install ffmpeg" if "ffmpeg" in str(e) else str(e))
    except ImportError:
        job.update(stage="error", error="本地识别人物需要 FunASR：关掉识别服务，运行一次 bash tools/start-whisper.sh --sensevoice（会自动安装）")
    except Exception as e:
        job.update(stage="error", error=str(e) if isinstance(e, RuntimeError) else f"{type(e).__name__}: {e}")


def start_speakers(body: dict, key: str) -> dict:
    url = str(body.get("url", ""))
    if not public_url(url):
        raise ValueError("只能识别公网上的视频地址")
    engine = "elevenlabs" if body.get("engine") == "elevenlabs" else "local"
    if engine == "elevenlabs" and not key:
        raise ValueError("用 ElevenLabs 识别人物需要先填 ElevenLabs 的 key")
    num = int(body.get("num_speakers") or 0) or None
    if num is not None and not 1 <= num <= 10:
        raise ValueError("人数要在 1 到 10 之间")
    job_id = uuid.uuid4().hex[:12]
    job = {"stage": "queued", "done": 0, "total": 0, "at": time.time()}
    with JOBS_LOCK:
        # 只留最近一小时的任务
        for k in [k for k, v in JOBS.items() if time.time() - v["at"] > 3600]:
            del JOBS[k]
        JOBS[job_id] = job
    speaker_worker.submit(run_speakers, job, url, engine, num, key)
    return {"job": job_id}


def run_video_transcription(job: dict, url: str, model: str, language: str):
    try:
        with tempfile.TemporaryDirectory() as folder:
            job["stage"] = "download"
            path = download_audio(url, folder)
            job["stage"] = "recognize"
            result = transcribe_path(path, model, language or None)
        job.update(stage="done", result=result)
    except FileNotFoundError as e:
        job.update(stage="error", error="需要先安装 ffmpeg：在终端运行 brew install ffmpeg" if "ffmpeg" in str(e) else str(e))
    except Exception as e:
        job.update(stage="error", error=str(e) if isinstance(e, RuntimeError) else f"{type(e).__name__}: {e}")


def start_video_transcription(body: dict, default_model: str) -> dict:
    url = str(body.get("url", ""))
    if not public_url(url):
        raise ValueError("只能识别公网上的视频地址")
    model = str(body.get("model") or default_model)
    if not allowed_model(model, default_model):
        raise ValueError("不支持这个识别模型")
    language = str(body.get("language") or "")
    if language and not re.fullmatch(r"[a-zA-Z-]{2,12}", language):
        raise ValueError("语言代码无效")
    job_id = uuid.uuid4().hex[:12]
    job = {"stage": "queued", "at": time.time()}
    with JOBS_LOCK:
        for k in [k for k, v in VIDEO_JOBS.items() if time.time() - v["at"] > 3600]:
            del VIDEO_JOBS[k]
        VIDEO_JOBS[job_id] = job
    video_worker.submit(run_video_transcription, job, url, model, language)
    return {"job": job_id}


class Handler(BaseHTTPRequestHandler):
    server_version = "WDubWhisper/0.1"

    def send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # 只服务本机的 W 声幕扩展：网页（http/https 来源）一律拒绝；Host 必须是本机，防 DNS 重绑定攻击。
    # 扩展有访问本机地址的权限，不需要 CORS 头；这里也不发 CORS 头，普通网页拿不到任何响应。
    def forbidden(self) -> bool:
        origin = self.headers.get("Origin", "")
        host = self.headers.get("Host", "").rsplit(":", 1)[0].strip("[]")
        if origin.startswith(("http://", "https://")) or host not in ("127.0.0.1", "localhost", "::1"):
            self.send_json(403, {"error": {"message": "forbidden"}})
            return True
        # 连接口令：只靠 Origin 判断挡不住本机其他程序和任意扩展（文档 D）
        token = getattr(self.server, "token", "")
        if token and not secrets.compare_digest(self.headers.get("X-WDub-Token", ""), token):
            self.send_json(401, {"error": {"message": "缺少或错误的连接口令，请在扩展设置里填写「语音识别 → 连接口令」"}})
            return True
        return False

    def do_OPTIONS(self):
        self.send_json(403, {"error": {"message": "forbidden"}})

    def do_GET(self):
        if self.forbidden():
            return
        if self.path.rstrip("/") in ("/health", "/v1/health"):
            return self.send_json(200, {"ok": True, "model": self.server.model})
        m = re.fullmatch(r"/v1/speakers/([0-9a-f]{12})", self.path.rstrip("/"))
        if m:
            job = JOBS.get(m.group(1))
            return self.send_json(200, job) if job else self.send_json(404, {"error": {"message": "任务不存在或已过期"}})
        m = re.fullmatch(r"/v1/video/transcriptions/([0-9a-f]{12})", self.path.rstrip("/"))
        if m:
            job = VIDEO_JOBS.get(m.group(1))
            return self.send_json(200, job) if job else self.send_json(404, {"error": {"message": "任务不存在或已过期"}})
        if self.path.rstrip("/") == "/v1/models":
            ids = [self.server.model, SENSEVOICE_MODEL]
            return self.send_json(200, {"object": "list", "data": [{"id": i, "object": "model"} for i in ids]})
        self.send_json(404, {"error": {"message": "not found"}})

    def do_POST(self):
        if self.forbidden():
            return
        if self.path.rstrip("/") == "/v1/video/transcriptions":
            try:
                length = int(self.headers.get("Content-Length", 0))
                if not 0 < length <= 64 * 1024:
                    return self.send_json(413, {"error": {"message": "请求太大"}})
                body = json.loads(self.rfile.read(length))
                return self.send_json(200, start_video_transcription(body, self.server.model))
            except (ValueError, json.JSONDecodeError) as e:
                return self.send_json(400, {"error": {"message": str(e)}})
        if self.path.rstrip("/") == "/v1/speakers":
            try:
                length = int(self.headers.get("Content-Length", 0))
                if not 0 < length <= 64 * 1024:
                    return self.send_json(413, {"error": {"message": "请求太大"}})
                body = json.loads(self.rfile.read(length))
                # ElevenLabs 的 key 只放在请求头里转给 ElevenLabs，不保存、不写日志
                return self.send_json(200, start_speakers(body, self.headers.get("X-ElevenLabs-Key", "")))
            except (ValueError, json.JSONDecodeError) as e:
                return self.send_json(400, {"error": {"message": str(e)}})
        if self.path.rstrip("/") != "/v1/audio/transcriptions":
            return self.send_json(404, {"error": {"message": "not found"}})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0 or length > MAX_BODY:
                return self.send_json(413, {"error": {"message": "音频为空或太大（单段上限 300MB）"}})
            fields = parse_multipart(self.headers.get("Content-Type", ""), self.rfile.read(length))
            audio = fields.get("file")
            if not audio:
                return self.send_json(400, {"error": {"message": "缺少 file 字段"}})
            # 扩展里填的模型名如果不是 mlx 模型（例如 whisper-1），就用服务启动时的默认模型
            model = text_field(fields, "model") or self.server.model
            if not allowed_model(model, self.server.model):
                model = self.server.model
            self.send_json(200, transcribe(audio, model, text_field(fields, "language")))
        except Exception as e:  # 把错误原样告诉扩展，方便排查
            self.send_json(500, {"error": {"message": f"{type(e).__name__}: {e}"}})

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="W 声幕本地语音识别服务（mlx-whisper）")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8199)
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Hugging Face 上的 mlx 模型，例如 mlx-community/whisper-large-v3-turbo")
    parser.add_argument("--sensevoice", action="store_true", help="启动时预加载 SenseVoice（中文识别）")
    parser.add_argument("--token", default=os.environ.get("WDUB_ASR_TOKEN", ""), help="连接口令；不填则每次启动随机生成并打印")
    args = parser.parse_args()
    token = args.token or secrets.token_hex(16)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.model = args.model
    server.token = token
    print(f"W 声幕识别服务已启动：http://{args.host}:{args.port}/v1  模型：{args.model}", flush=True)
    print("连接口令：" + token, flush=True)
    print("把上面这串口令填到扩展的 设置 →「语音识别」→「连接口令」。没有口令的请求会被拒绝。", flush=True)
    if args.sensevoice:
        # 后台预加载，首次会从 ModelScope 下载约 1GB 模型
        gpu_worker.submit(load_sensevoice).add_done_callback(
            lambda f: print("SenseVoice 已就绪：模型 iic/SenseVoiceSmall" if not f.exception() else f"SenseVoice 加载失败：{f.exception()}", flush=True)
        )
    print("首次识别会自动下载模型（large-v3-turbo 约 1.6GB），之后离线可用。按 Ctrl+C 停止。", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
