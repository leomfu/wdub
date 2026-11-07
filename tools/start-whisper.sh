#!/usr/bin/env bash
# 启动 W 声幕本地语音识别服务。第一次运行会创建虚拟环境并安装依赖。
# 用法：
#   bash tools/start-whisper.sh                 # 英文等外语：mlx-whisper
#   bash tools/start-whisper.sh --sensevoice    # 另外启用中文识别 SenseVoice（首次会多装约 1GB）
#   bash tools/start-whisper.sh --check         # 只检查环境，不启动服务
#   bash tools/start-whisper.sh --no-update     # 本次不更新 yt-dlp
#   其他参数：--model mlx-community/whisper-small-mlx  --port 8199
# 「识别人物」和无字幕流媒体识别用 yt-dlp 下载音频：每次启动时自动更新到最新版
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$DIR/.venv"
REQ="$DIR/requirements.txt"
REQ_SV="$DIR/requirements-sensevoice.txt"

# --check / --no-update 由本脚本处理，其余原样传给服务
CHECK=0
UPDATE=1
PASS=()
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --no-update) UPDATE=0 ;;
    *) PASS+=("$arg") ;;
  esac
done

# mlx-whisper 只支持 macOS + Apple 芯片；别让 Linux / Windows 误入这条安装路径
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "本地识别服务需要 macOS（mlx-whisper 只用 Apple 芯片的 GPU）。"
  echo "其他系统请在 设置 →「语音识别」改用 Groq / OpenAI / ElevenLabs / 豆包。"
  exit 1
fi
if [[ "$(uname -m)" != "arm64" ]]; then
  echo "mlx-whisper 需要 Apple 芯片（M 系列）的 Mac。Intel Mac 请在设置里改用 Groq / OpenAI / ElevenLabs / 豆包。"
  exit 1
fi
if ! command -v ffmpeg >/dev/null; then
  echo "需要 ffmpeg：brew install ffmpeg"
  exit 1
fi
if ! command -v python3 >/dev/null; then
  echo "需要 Python 3：brew install python"
  exit 1
fi

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "首次运行：创建虚拟环境并安装 mlx-whisper…"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -r "$REQ"
elif ! "$VENV/bin/pip" show -q mlx-whisper >/dev/null 2>&1; then
  # 上次安装中断会留下半个虚拟环境；补装，而不是当成已完成
  echo "检测到依赖不完整，正在补装…"
  "$VENV/bin/pip" install --quiet -r "$REQ"
fi

if [[ "$CHECK" == "1" ]]; then
  ok=1
  "$VENV/bin/python" -c "import mlx_whisper" >/dev/null 2>&1 || { echo "✗ mlx-whisper 不可用，运行：\"$VENV/bin/pip\" install -r \"$REQ\""; ok=0; }
  "$VENV/bin/python" -c "import yt_dlp" >/dev/null 2>&1 || { echo "✗ yt-dlp 不可用，运行：\"$VENV/bin/pip\" install -r \"$REQ\""; ok=0; }
  command -v ffmpeg >/dev/null || { echo "✗ 缺少 ffmpeg：brew install ffmpeg"; ok=0; }
  if [[ "$ok" == "1" ]]; then echo "✓ 本地识别环境正常"; else echo "有项目未通过，按上面的提示处理后重新运行。"; fi
  exit $((1 - ok))
fi

if [[ "$UPDATE" == "1" ]]; then
  # 更新 yt-dlp（没联网就跳过，用已经装好的版本）
  "$VENV/bin/pip" install --quiet --upgrade "yt-dlp[default]" 2>/dev/null || echo "yt-dlp 更新失败（可能没联网），继续用现有版本"
fi

if [[ " $* " == *" --sensevoice "* ]] && ! "$VENV/bin/python" -c "import funasr, kaldi_native_fbank" 2>/dev/null; then
  echo "首次启用 SenseVoice：安装 FunASR…"
  # kaldi-native-fbank 是 FunASR 提取音频特征需要的，默认不会自动装
  "$VENV/bin/pip" install --quiet -r "$REQ_SV"
fi

exec "$VENV/bin/python" "$DIR/whisper_server.py" ${PASS[@]+"${PASS[@]}"}
