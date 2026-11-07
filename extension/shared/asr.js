// 语音识别（ASR）：从视频里取音频 → 按引擎要求分段 → 调识别接口 → 统一成 cue。
// 在扩展自己的页面里运行（本地播放器、offscreen），这样请求不受网页 CORS 限制。
(function () {
  const WDub = (globalThis.WDub = globalThis.WDub || {});
  const A = (WDub.ASR = {});
  const RATE = 16000; // 识别模型都用 16kHz 单声道，再高没有收益

  // ---------- 音频 ----------

  // 解码任意音视频文件为 16kHz 单声道 PCM
  A.decode = async function (arrayBuffer) {
    const ctx = new OfflineAudioContext(1, RATE, RATE);
    let buf;
    try {
      buf = await ctx.decodeAudioData(arrayBuffer);
    } catch {
      throw new Error('无法解码这个文件的音频（浏览器不支持该编码，可先转成 MP4/H.264 + AAC）');
    }
    const pcm = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) pcm[i] += ch[i] / buf.numberOfChannels;
    }
    return pcm;
  };

  A.wav = function (pcm) {
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const str = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
    str(0, 'RIFF');
    out.setUint32(4, 36 + pcm.length * 2, true);
    str(8, 'WAVEfmt ');
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true);
    out.setUint16(22, 1, true);
    out.setUint32(24, RATE, true);
    out.setUint32(28, RATE * 2, true);
    out.setUint16(32, 2, true);
    out.setUint16(34, 16, true);
    str(36, 'data');
    out.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    return new Blob([out], { type: 'audio/wav' });
  };

  // 按最大秒数切段，切点挑在目标位置前 15 秒内最安静的地方，避免把一个词切成两半
  A.split = function (pcm, maxSeconds) {
    const max = Math.floor(maxSeconds * RATE);
    if (pcm.length <= max) return [{ pcm, offset: 0 }];
    const win = RATE / 10; // 100ms 能量窗
    const parts = [];
    let start = 0;
    while (start < pcm.length) {
      let end = Math.min(start + max, pcm.length);
      if (end < pcm.length) {
        let best = end, bestEnergy = Infinity;
        for (let p = end - win; p > end - 15 * RATE && p > start + win; p -= win) {
          let e = 0;
          for (let i = p; i < p + win; i++) e += pcm[i] * pcm[i];
          if (e < bestEnergy) (bestEnergy = e), (best = p + win / 2);
        }
        end = best;
      }
      parts.push({ pcm: pcm.subarray(start, end), offset: start / RATE });
      start = end;
    }
    return parts;
  };

  // ---------- 引擎 ----------

  const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.local)(:\d+)?\//.test(url + '/');
  const trim = (u) => String(u || '').replace(/\/+$/, '');

  async function readError(res, what) {
    const text = await res.text().catch(() => '');
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.error?.message || j.detail?.message || j.detail || j.message || text;
    } catch {}
    const hint = res.status === 401 || res.status === 403 ? '（key 不对或没有权限）' : res.status === 413 ? '（文件太大）' : res.status === 429 ? '（请求太频繁或额度用完）' : '';
    return new Error(`${what}失败 ${res.status}${hint}：${String(msg).slice(0, 200)}`);
  }

  // Whisper 常见“幻听”：静音段编出“谢谢观看”之类、或同一句反复出现
  function dropHallucinations(segs) {
    const out = [];
    for (const s of segs) {
      if (s.no_speech_prob > 0.6 && s.avg_logprob < -1) continue;
      const prev = out.at(-1);
      if (prev && prev.text.trim() === s.text.trim() && s.text.trim().length < 40) continue;
      out.push(s);
    }
    return out;
  }

  A.engines = {
    // OpenAI 兼容 /audio/transcriptions：OpenAI whisper-1、Groq、本地 mlx-whisper 服务等
    openai: {
      // 云端接口单文件上限 25MB，16kHz WAV 约 13 分钟；本地服务不限
      maxSeconds: (c) => (isLocal(c.baseUrl) ? Infinity : 12 * 60),
      async run(blob, c, lang) {
        const form = new FormData();
        form.append('file', blob, 'audio.wav');
        form.append('model', c.model);
        form.append('response_format', 'verbose_json');
        form.append('timestamp_granularities[]', 'segment');
        form.append('timestamp_granularities[]', 'word');
        if (lang) form.append('language', lang);
        const headers = c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {};
        // 本地识别服务要口令，防止本机其他程序直接调用（文档 D）
        if (isLocal(c.baseUrl) && c.token) headers['X-WDub-Token'] = c.token;
        const res = await fetch(`${trim(c.baseUrl)}/audio/transcriptions`, { method: 'POST', headers, body: form });
        if (!res.ok) throw await readError(res, '识别');
        const j = await res.json();
        if (!j.segments && !j.words) throw new Error(`模型 ${c.model} 不返回时间戳，无法用于配音。请换 whisper-1、whisper-large-v3-turbo 或本地 mlx-whisper。`);
        // 有逐词时间戳就按词重新断句（更准）；否则用段落
        if (j.words?.length) return { words: j.words.map((w) => ({ w: w.word, start: w.start, end: w.end })), language: j.language };
        return { segments: dropHallucinations(j.segments).map((s) => ({ start: s.start, end: s.end, text: s.text })), language: j.language };
      }
    },

    // ElevenLabs Scribe：逐词时间戳 + 说话人分离。整段上传，保证同一个人在全片保持同一个编号
    elevenlabs: {
      maxSeconds: () => Infinity,
      async run(blob, c, lang) {
        if (!c.apiKey) throw new Error('请先在设置里填写 ElevenLabs API key');
        const form = new FormData();
        form.append('file', blob, 'audio.wav');
        form.append('model_id', c.model || 'scribe_v1');
        form.append('diarize', 'true');
        form.append('timestamps_granularity', 'word');
        form.append('tag_audio_events', 'false');
        if (lang) form.append('language_code', lang);
        if (c.maxSpeakers) form.append('num_speakers', String(c.maxSpeakers));
        const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': c.apiKey }, body: form });
        if (!res.ok) throw await readError(res, 'ElevenLabs 识别');
        const j = await res.json();
        const words = (j.words || []).filter((w) => w.type === 'word').map((w) => ({ w: w.text, start: w.start, end: w.end, speaker: w.speaker_id }));
        return { words, language: j.language_code };
      }
    },

    // 本地 SenseVoice：走同一个本地服务的 OpenAI 兼容接口，中文、粤语识别最好
    sensevoice: {
      maxSeconds: () => Infinity,
      run: (blob, c, lang) => A.engines.openai.run(blob, c, lang || 'zh')
    },

    // 豆包（火山引擎）大模型录音文件识别·极速版：音频直接放在请求里，同步返回带标点的分句和说话人
    doubao: {
      // 单次上限 100MB；音频转 base64 后会变大 1/3，按 30 分钟一段切
      maxSeconds: () => 30 * 60,
      async run(blob, c) {
        if (!c.appKey || !c.accessKey) throw new Error('请先在设置里填写豆包的 APP ID 和 Access Token');
        const data = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result).split(',')[1]);
          fr.onerror = () => reject(new Error('读取音频失败'));
          fr.readAsDataURL(blob);
        });
        const res = await fetch('https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-App-Key': c.appKey,
            'X-Api-Access-Key': c.accessKey,
            'X-Api-Resource-Id': c.resourceId || 'volc.bigasr.auc_turbo',
            'X-Api-Request-Id': crypto.randomUUID(),
            'X-Api-Sequence': '-1'
          },
          body: JSON.stringify({
            user: { uid: 'wdub' },
            audio: { data },
            request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, show_utterances: true, enable_speaker_info: true }
          })
        });
        // 业务状态在响应头里：20000000 成功，20000003 表示整段都是静音
        const code = res.headers.get('X-Api-Status-Code');
        if (code === '20000003') return { segments: [] };
        if (!res.ok || (code && code !== '20000000')) {
          const msg = res.headers.get('X-Api-Message') || (await res.text().catch(() => ''));
          const hint = code === '45000001' || res.status === 401 || res.status === 403 ? '（APP ID / Access Token 不对，或没开通极速版）' : '';
          throw new Error(`豆包识别失败 ${code || res.status}${hint}：${String(msg).slice(0, 200)}`);
        }
        const j = await res.json();
        const segments = (j.result?.utterances || []).map((u) => ({
          start: u.start_time / 1000,
          end: u.end_time / 1000,
          text: u.text,
          speaker: u.additions?.speaker
        }));
        return { segments, language: 'zh' };
      }
    },

    // Azure 快速转录：带说话人分离。单次上限约 2 小时，超出时分段
    azure: {
      maxSeconds: () => 100 * 60,
      async run(blob, c, lang) {
        if (!c.key || !c.region) throw new Error('请先在设置里填写 Azure 语音 key 和区域');
        const locale = { en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[lang] || 'en-US';
        const form = new FormData();
        form.append('audio', blob, 'audio.wav');
        form.append(
          'definition',
          JSON.stringify({ locales: [locale], diarization: { enabled: true, maxSpeakers: c.maxSpeakers || 4 }, profanityFilterMode: 'None' })
        );
        const url = `https://${c.region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
        const res = await fetch(url, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': c.key }, body: form });
        if (!res.ok) throw await readError(res, 'Azure 识别');
        const j = await res.json();
        const words = [];
        for (const p of j.phrases || []) {
          for (const w of p.words || []) {
            words.push({ w: w.text, start: w.offsetMilliseconds / 1000, end: (w.offsetMilliseconds + w.durationMilliseconds) / 1000, speaker: p.speaker });
          }
        }
        // Azure 的 words 不带标点，标点在 phrase.text 里；按句子用 phrase 更自然
        const phrases = (j.phrases || []).map((p) => ({
          start: p.offsetMilliseconds / 1000,
          end: (p.offsetMilliseconds + p.durationMilliseconds) / 1000,
          text: p.text,
          speaker: p.speaker
        }));
        return { segments: phrases, words: phrases.length ? null : words, language: lang };
      }
    }
  };

  // 本地 Whisper、Groq、自定义接口都是 OpenAI 兼容格式
  A.engines.local = A.engines.groq = A.engines.custom = A.engines.openai;

  // 根据设置拿到引擎配置（地址和 key 已由 WDub.resolve 从「账号与 Key」里填好）
  A.config = function (s) {
    const engine = s.asr.engine;
    const c = { ...s.asr[engine], maxSpeakers: s.asr.maxSpeakers };
    return { engine, conf: c, lang: s.asr.language === 'auto' ? '' : s.asr.language };
  };

  // 把各引擎结果统一成 cue（单位秒，带 speaker）
  A.toCues = function (results) {
    const words = [], segs = [];
    for (const { r, offset } of results) {
      if (r.words) {
        for (const w of r.words) if (/[\p{L}\p{N}]/u.test(w.w)) words.push({ ...w, start: w.start + offset, end: w.end + offset });
      }
      else if (r.segments) for (const s of r.segments) segs.push({ ...s, start: s.start + offset, end: s.end + offset });
    }
    const cues = words.length ? WDub.Subs.wordsToSentences(words) : WDub.Subs.mergeFragments(segs.map((s) => ({ ...s, text: s.text.trim() })));
    // 去掉只有标点的“句子”（Whisper 在音乐、提示音上会吐出 "."）；
    // 识别出的说话人统一加前缀，和字幕里写的 [人名] 区分开
    return cues
      .filter((c) => /[\p{L}\p{N}]/u.test(c.text))
      .map((c, i) => ({ ...c, id: i, ...(c.speaker != null && { speaker: `asr:${c.speaker}` }) }));
  };

  // 主流程。input: ArrayBuffer（整个文件）。onProgress({stage, done, total})
  A.transcribe = async function (input, s, onProgress = () => {}) {
    const { engine, conf, lang } = A.config(s);
    const impl = A.engines[engine];
    if (!impl) throw new Error(`不支持的识别引擎：${engine}`);
    onProgress({ stage: 'decode' });
    const pcm = await A.decode(input);
    if (pcm.length < RATE) throw new Error('没有检测到音频');
    const parts = A.split(pcm, impl.maxSeconds(conf));
    const results = [];
    let language;
    for (let i = 0; i < parts.length; i++) {
      onProgress({ stage: 'recognize', done: i, total: parts.length });
      const r = await impl.run(A.wav(parts[i].pcm), conf, lang);
      language = language || r.language;
      results.push({ r, offset: parts[i].offset });
    }
    onProgress({ stage: 'done', done: parts.length, total: parts.length });
    // Whisper 返回 "english" 这类全名，统一成语言代码
    const names = { english: 'en', chinese: 'zh', japanese: 'ja', korean: 'ko', french: 'fr', german: 'de', spanish: 'es', russian: 'ru', portuguese: 'pt', italian: 'it' };
    language = names[String(language || '').toLowerCase()] || language || lang;
    return { cues: A.toCues(results), language, duration: pcm.length / RATE, engine };
  };
})();
