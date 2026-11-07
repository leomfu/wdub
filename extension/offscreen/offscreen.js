// 隐藏的音频页：调用 Azure / ElevenLabs / OpenAI 兼容（含 Kokoro）TTS 合成语音，缓存并播放。
// 运行在扩展自己的源里，不受网页 CSP 限制；playbackRate 加速时保持音调不变。

const cache = new Map(); // 合成参数 -> { url, duration, pending }
const MAX_CACHE = 200;
let current = null; // { key, cacheKey, audio }
let playEpoch = 0;
let playbackPaused = false;

// 同一句字幕换了风格、模型、发音规则或账号后，必须重新合成。
const cacheKeyFor = ({ key, engine, text, voice, conf }) => JSON.stringify([key, engine, text, voice, conf]);

const escapeXml = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

async function synthesize(engine, text, voice, conf) {
  if (engine === 'azure') {
    if (!conf.key) throw new Error('请先在设置里填写 Azure 语音 key');
    const lang = (voice.match(/^[a-z]{2,3}-[A-Z]{2,4}/) || ['zh-CN'])[0];
    const inner = conf.style ? `<mstts:express-as style="${escapeXml(conf.style)}">${escapeXml(text)}</mstts:express-as>` : escapeXml(text);
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}"><voice name="${escapeXml(voice)}">${inner}</voice></speak>`;
    const res = await fetch(`https://${conf.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': conf.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3'
      },
      body: ssml
    });
    if (!res.ok) throw new Error(`Azure 语音失败（${res.status}）${res.status === 401 ? '：key 或区域不对' : ''}`);
    return res.blob();
  }
  if (engine === 'elevenlabs') {
    if (!conf.apiKey) throw new Error('请先在设置里填写 ElevenLabs API key');
    const body = { text, model_id: conf.model };
    // 只有 v2.5 系列支持指定语言；不指定时短句里的汉字偶尔会被读成日语
    if (/v2_5/.test(conf.model) && conf.lang) body.language_code = conf.lang.split('-')[0];
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': conf.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      const why = detail?.detail?.status === 'quota_exceeded' ? '：本月额度用完了' : res.status === 401 ? '：key 不对' : detail?.detail?.message ? `：${String(detail.detail.message).slice(0, 120)}` : '';
      throw new Error(`ElevenLabs 语音失败（${res.status}）${why}`);
    }
    return res.blob();
  }
  // OpenAI、本地 Kokoro、自定义接口都是 OpenAI 格式的 /audio/speech
  if (engine === 'openai' || engine === 'kokoro' || engine === 'custom') {
    const body = { model: conf.model, voice, input: text, response_format: 'mp3' };
    if (conf.instructions) body.instructions = conf.instructions;
    const res = await fetch(`${String(conf.baseUrl).replace(/\/+$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conf.apiKey}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`TTS 接口失败（${res.status}）：${(await res.text()).slice(0, 160)}`);
    return res.blob();
  }
  throw new Error(`不支持的语音引擎：${engine}`);
}

function measure(url) {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => resolve(isFinite(a.duration) ? a.duration : null);
    a.onerror = () => resolve(null);
    a.src = url;
  });
}

function evict() {
  while (cache.size > MAX_CACHE) {
    const [k, v] = cache.entries().next().value;
    if (current?.cacheKey === k) break;
    if (v.url) URL.revokeObjectURL(v.url);
    cache.delete(k);
  }
}

function load(msg) {
  const { engine, text, voice, conf } = msg;
  const cacheKey = cacheKeyFor(msg);
  const hit = cache.get(cacheKey);
  if (hit) return hit.pending;
  const entry = {};
  entry.pending = (async () => {
    const blob = await synthesize(engine, text, voice, conf);
    entry.url = URL.createObjectURL(blob);
    entry.duration = await measure(entry.url);
    return { duration: entry.duration };
  })();
  entry.pending.catch(() => {
    if (cache.get(cacheKey) === entry) cache.delete(cacheKey);
  });
  cache.set(cacheKey, entry);
  evict();
  return entry.pending;
}

function stop(resetPause = true) {
  playEpoch++;
  if (resetPause) playbackPaused = false;
  if (!current) return;
  current.audio.onended = null;
  current.audio.pause();
  current = null;
}

async function play(msg) {
  // 新句替换旧句时保留视频的暂停状态；暂停可能先于这句 API 合成完成。
  stop(false);
  const epoch = playEpoch;
  await load(msg);
  if (epoch !== playEpoch) return { started: false, cancelled: true };
  const cacheKey = cacheKeyFor(msg);
  const entry = cache.get(cacheKey);
  const audio = new Audio(entry.url);
  audio.preservesPitch = true;
  audio.playbackRate = Math.min(Math.max(msg.rate || 1, 0.5), 4);
  audio.volume = Math.min(Math.max(msg.volume ?? 1, 0), 1);
  current = { key: msg.key, cacheKey, audio };
  const done = (reason) => {
    if (current?.audio !== audio) return;
    current = null;
    chrome.runtime.sendMessage({ target: 'bg', type: 'ended', key: msg.key, reason });
  };
  audio.onended = () => done('end');
  audio.onerror = () => done('error');
  if (playbackPaused) return { started: true, paused: true, duration: entry.duration };
  try {
    await audio.play();
  } catch (e) {
    if (playbackPaused && current?.audio === audio) return { started: true, paused: true, duration: entry.duration };
    if (current?.audio === audio) current = null;
    throw e;
  }
  if (epoch !== playEpoch) {
    audio.pause();
    return { started: false, cancelled: true };
  }
  if (playbackPaused) audio.pause();
  return { started: true, duration: entry.duration };
}

function pause() {
  playbackPaused = true;
  current?.audio.pause();
}

function resume() {
  playbackPaused = false;
  return current?.audio.play();
}

// 网页视频的语音识别：下载视频 → 识别。进度发回后台，后台转给发起的标签页
// 解码还需要额外内存；网页直链识别只接收适合在浏览器内处理的文件。
const MAX_DOWNLOAD = 256 * 1024 ** 2;

async function recognizeUrl({ jobId, url, withCookies, allowPrivate, settings }) {
  const progress = (p) => chrome.runtime.sendMessage({ target: 'bg', type: 'asrProgress', jobId, ...p }).catch(() => {});
  // 云端识别一段可能要几分钟，定时发心跳，避免后台 Service Worker 因空闲被回收
  const beat = setInterval(() => progress({ stage: 'heartbeat' }), 10000);
  try {
    progress({ stage: 'download', done: 0 });
    // 只有和网页同源的视频才带登录状态（后台已判断好）
    const res = await fetch(url, { credentials: withCookies ? 'include' : 'omit' });
    // 跳转后落到了内网 / 本机地址：公网网页不允许
    if (!allowPrivate && WDub.isPrivateHost(new URL(res.url).hostname)) throw new Error('出于安全考虑，不会从公网网页下载内网或本机地址的视频');
    if (!res.ok) throw new Error(`下载视频失败（${res.status}），这个网站可能不允许直接下载`);
    const total = +res.headers.get('content-length') || 0;
    const tooBig = () => new Error('视频超过 256MB，浏览器内识别可能耗尽内存；请先压缩视频后再识别');
    if (total > MAX_DOWNLOAD) throw tooBig();
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0, last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      // 服务器没给大小或者给了假大小时，边下边检查，避免把内存撑爆
      if (got > MAX_DOWNLOAD) {
        reader.cancel().catch(() => {});
        throw tooBig();
      }
      chunks.push(value);
      if (Date.now() - last > 500) {
        last = Date.now();
        progress({ stage: 'download', done: got, total });
      }
    }
    const blob = new Blob(chunks);
    chunks.length = 0;
    const r = await WDub.ASR.transcribe(await blob.arrayBuffer(), settings, progress);
    return { cues: r.cues, language: r.language };
  } finally {
    clearInterval(beat);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== 'offscreen') return;
  const run = {
    asr: () => recognizeUrl(msg),
    load: () => load(msg),
    play: () => play(msg),
    stop: () => stop(),
    pause: () => pause(),
    resume: () => resume(),
    volume: () => current && (current.audio.volume = Math.min(Math.max(msg.volume, 0), 1))
  }[msg.type];
  Promise.resolve(run?.())
    .then((r) => reply(r ?? {}))
    .catch((e) => reply({ error: e.message || String(e) }));
  return true;
});
