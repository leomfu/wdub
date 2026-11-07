// Cloud audio and recognition shared by the Safari worker, Firefox event page and local player.
(function () {
  const WDub = globalThis.WDub;
  const audioCache = new Map();
  const MAX_AUDIO_CACHE = 60;

  function xml(s) {
    return String(s).replace(/[<>&'\"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
  }

  async function audioData(res, label) {
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`${label}失败（${res.status}）：${detail.slice(0, 120)}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    let base64 = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      base64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { data: btoa(base64), mime: res.headers.get('content-type') || 'audio/mpeg' };
  }

  async function synthesize(engine, text, voice, conf) {
    if (engine === 'azure') {
      if (!conf.key) throw new Error('请先在设置里填写 Azure 语音 key');
      const lang = (voice.match(/^[a-z]{2,3}-[A-Z]{2,4}/) || ['zh-CN'])[0];
      const inner = conf.style ? `<mstts:express-as style="${xml(conf.style)}">${xml(text)}</mstts:express-as>` : xml(text);
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}"><voice name="${xml(voice)}">${inner}</voice></speak>`;
      return audioData(await fetch(`https://${conf.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': conf.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' },
        body: ssml
      }), 'Azure 配音');
    }
    if (engine === 'elevenlabs') {
      if (!conf.apiKey) throw new Error('请先在设置里填写 ElevenLabs API key');
      const body = { text, model_id: conf.model || 'eleven_flash_v2_5' };
      if (/v2_5/.test(body.model_id) && conf.lang) body.language_code = conf.lang.split('-')[0];
      return audioData(await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
        method: 'POST', headers: { 'xi-api-key': conf.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }), 'ElevenLabs 配音');
    }
    throw new Error('手机版请在设置中选择 Azure 或 ElevenLabs 云端配音');
  }

  WDub.MobileCloud = {
    async prepare({ key, engine, text, voice, conf }) {
      const cacheKey = JSON.stringify([key, engine, text, voice, conf]);
      if (!audioCache.has(cacheKey)) {
        const pending = synthesize(engine, text, voice, conf);
        audioCache.set(cacheKey, pending);
        pending.catch(() => audioCache.get(cacheKey) === pending && audioCache.delete(cacheKey));
        while (audioCache.size > MAX_AUDIO_CACHE) audioCache.delete(audioCache.keys().next().value);
      }
      return audioCache.get(cacheKey);
    },

    async transcribe({ url, file, settings }) {
      const conf = settings.asr.elevenlabs;
      if (!conf?.apiKey) throw new Error('无字幕视频需要 ElevenLabs 识别 key，请先在设置中填写');
      const form = new FormData();
      if (file) form.append('file', file, file.name || 'video.mp4');
      else {
        const u = new URL(url);
        if (!['https:', 'http:'].includes(u.protocol) || WDub.isPrivateHost(u.hostname)) throw new Error('只能识别公开的 HTTP(S) 视频链接');
        form.append('source_url', u.href);
      }
      form.append('model_id', conf.model || 'scribe_v2');
      form.append('diarize', 'true');
      form.append('timestamps_granularity', 'word');
      form.append('tag_audio_events', 'false');
      if (settings.asr.language !== 'auto') form.append('language_code', settings.asr.language);
      if (settings.asr.maxSpeakers) form.append('num_speakers', String(settings.asr.maxSpeakers));
      const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST', headers: { 'xi-api-key': conf.apiKey }, body: form
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`云端识别失败（${res.status}）：${detail.slice(0, 160)}`);
      }
      const result = await res.json();
      const words = (result.words || []).filter((w) => w.type === 'word' && /[\p{L}\p{N}]/u.test(w.text || ''))
        .map((w) => ({ w: w.text, start: w.start, end: w.end, speaker: w.speaker_id }));
      const cues = WDub.Subs.wordsToSentences(words).map((c, i) => ({ ...c, id: i, ...(c.speaker != null && { speaker: `asr:${c.speaker}` }) }));
      if (!cues.length) throw new Error('云端识别没有返回可用的逐词字幕');
      return { cues, language: result.language_code || settings.asr.language };
    }
  };
})();
