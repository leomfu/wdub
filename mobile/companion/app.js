(function () {
  const WDub = globalThis.WDub;
  const $ = (selector) => document.querySelector(selector);
  const video = $('#video');
  let file = null;
  let fileUrl = null;
  let cues = null;
  let language = 'en';
  let engine = null;
  let audioSequence = 0;
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('wdub-settings') || '{}'); } catch {}
  let settings = WDub.fromStored(stored);

  const say = (message, error = false) => {
    $('#status').textContent = message;
    $('#status').classList.toggle('error', error);
  };
  const status = (state) => {
    if (state.message) return say(state.message, state.phase === 'error');
    if (state.phase === 'playing') say(`字幕与配音已开启 · 已翻译 ${state.translated}/${state.total} 句。按视频播放键开始观看。`);
    if (state.phase === 'stopped') say('已停止字幕与配音。');
  };

  async function translate(texts, from, to) {
    const call = async (input) => {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${encodeURIComponent(from || 'auto')}&tl=${encodeURIComponent(to)}`;
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ q: input }) });
      if (!res.ok) throw new Error(`翻译失败（${res.status}）`);
      const data = await res.json();
      return { text: (data[0] || []).map((part) => part[0]).join(''), detected: data[2] };
    };
    const result = await call(texts.map((text) => text.replace(/\n/g, ' ')).join('\n'));
    let lines = result.text.split('\n');
    if (lines.length !== texts.length) lines = await Promise.all(texts.map(async (text) => (await call(text)).text));
    return { items: lines.map((t) => ({ t: t.trim() })), detected: result.detected, engine: 'google' };
  }

  async function rpc(type, payload = {}) {
    if (type === 'translate') return translate(payload.texts, payload.from, payload.to);
    if (type === 'tts.stop') return WDub.MobileAudio.handle({ action: 'stop', sequence: ++audioSequence });
    if (type === 'tts.pause' || type === 'tts.resume') return WDub.MobileAudio.handle({ action: type.slice(4), sequence: audioSequence });
    if (type === 'tts.volume') return WDub.MobileAudio.handle({ action: 'volume', sequence: audioSequence, volume: payload.volume });
    if (type === 'tts.prepare' || type === 'tts.play') {
      const selected = WDub.ttsEngine(settings);
      const conf = { ...settings.tts[selected], lang: settings.targetLang };
      const before = audioSequence;
      const audio = await WDub.MobileCloud.prepare({ ...payload, engine: selected, conf });
      if (type === 'tts.prepare') return { duration: null };
      if (before !== audioSequence) return { started: false, cancelled: true };
      return WDub.MobileAudio.handle({ action: 'play', sequence: ++audioSequence, key: payload.key, rate: payload.rate, volume: payload.volume, ...audio });
    }
    throw new Error(`未知操作：${type}`);
  }
  WDub.MobileAudio.onEnded = (key) => engine?.onAudioEnded(key);

  function save() {
    const selected = $('#voiceEngine').value;
    const voice = $('#voiceId').value.trim();
    stored = {
      ...stored,
      keys: {
        azure: { key: $('#azureKey').value.trim(), region: $('#azureRegion').value.trim() || 'eastasia' },
        elevenlabs: $('#elevenKey').value.trim()
      },
      tts: { engine: selected },
      asr: { engine: 'elevenlabs', elevenlabs: { model: 'scribe_v2' } },
      audio: { originalMode: $('#originalMode').value, dubVolume: Number($('#dubVolume').value) },
      cast: { ...stored.cast, [selected]: { ...(stored.cast?.[selected] || {}), narrator: voice || WDub.DEFAULTS.cast[selected].narrator } }
    };
    localStorage.setItem('wdub-settings', JSON.stringify(stored));
    settings = WDub.fromStored(stored);
    engine?.updateSettings(settings);
  }

  function updateVoiceField() {
    $('#voiceId').value = settings.cast[$('#voiceEngine').value]?.narrator || '';
  }
  $('#voiceEngine').value = settings.tts.engine;
  $('#azureKey').value = settings.keys.azure.key;
  $('#azureRegion').value = settings.keys.azure.region;
  $('#elevenKey').value = settings.keys.elevenlabs;
  $('#originalMode').value = settings.audio.originalMode;
  $('#dubVolume').value = settings.audio.dubVolume;
  updateVoiceField();
  document.querySelectorAll('.settings input, .settings select').forEach((input) => input.addEventListener('change', () => {
    if (input.id === 'voiceEngine') updateVoiceField();
    save();
  }));

  function loadVideo(next) {
    if (!next || !(next.type?.startsWith('video/') || /\.(mp4|mov|mkv|webm|m4v)$/i.test(next.name || ''))) return say('请选择视频文件。', true);
    engine?.stop();
    engine = null;
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    file = next;
    cues = null;
    fileUrl = URL.createObjectURL(file);
    video.src = fileUrl;
    $('#fileName').textContent = file.name || '分享的视频';
    say('视频已载入。导入字幕，或点“识别字幕”。');
  }

  async function loadSubtitles(next) {
    try {
      const parsed = WDub.Subs.parseAny(await next.text(), next.name);
      if (!parsed.length) throw new Error('文件中没有读到有效字幕');
      cues = parsed;
      say(`已导入 ${parsed.length} 句字幕，可以开始字幕＋配音。`);
    } catch (e) { say(`导入字幕失败：${e.message}`, true); }
  }

  function review(source) {
    const dialog = $('#review');
    const draft = source.map((cue) => ({ ...cue }));
    const size = 12;
    let page = 0;
    const pages = Math.ceil(draft.length / size);
    const render = () => {
      $('#reviewRows').replaceChildren();
      for (const cue of draft.slice(page * size, (page + 1) * size)) {
        const row = document.createElement('div'); row.className = 'review-row';
        const time = document.createElement('button'); time.textContent = WDub.Subs.fmtClock(cue.start);
        time.addEventListener('click', () => { video.currentTime = cue.start; });
        const input = document.createElement('textarea'); input.value = cue.text;
        input.addEventListener('input', () => { cue.text = input.value; });
        row.append(time, input); $('#reviewRows').append(row);
      }
      $('#reviewPage').textContent = `${page + 1}/${pages} 页`;
      $('#reviewPrev').disabled = page === 0;
      $('#reviewNext').disabled = page + 1 >= pages;
    };
    video.pause();
    dialog.showModal(); render();
    return new Promise((resolve) => {
      const finish = (value) => { dialog.close(); resolve(value); };
      $('#reviewPrev').onclick = () => { page--; render(); };
      $('#reviewNext').onclick = () => { page++; render(); };
      $('#reviewCancel').onclick = () => finish(null);
      $('#reviewConfirm').onclick = () => {
        const cleaned = draft.filter((cue) => cue.text.trim()).map((cue) => ({ ...cue, text: cue.text.trim() }));
        if (cleaned.length) finish(cleaned);
      };
      dialog.oncancel = (event) => { event.preventDefault(); finish(null); };
    });
  }

  async function recognize() {
    if (!file) return say('先选择视频。', true);
    if (!settings.keys.elevenlabs) return say('识别字幕需要 ElevenLabs Key，请先在下方填写。', true);
    $('#recognize').disabled = true;
    say('正在把视频发送给 ElevenLabs 识别，请稍候…');
    try {
      const result = await WDub.MobileCloud.transcribe({ file, settings });
      const reviewed = await review(result.cues);
      if (!reviewed) return say('已取消字幕校对。');
      cues = reviewed;
      language = result.language || language;
      say(`已校对 ${cues.length} 句，可以开始字幕＋配音。`);
    } catch (e) { say(`识别失败：${e.message}`, true); }
    finally { $('#recognize').disabled = false; }
  }

  async function start() {
    WDub.MobileAudio.unlock();
    if (!file) return say('先选择视频。', true);
    if (!cues) {
      await recognize();
      if (!cues) return;
      WDub.MobileAudio.unlock();
    }
    if (WDub.missingKey(settings, 'tts')) return say('配音需要 Azure 或 ElevenLabs Key，请先在下方填写。', true);
    engine?.stop();
    const active = new WDub.DubEngine(video, { rpc, settings, mode: 'dub', onState: status });
    engine = active;
    await active.start(cues, { lang: language, title: file.name });
  }

  $('#videoFile').addEventListener('change', (event) => event.target.files[0] && loadVideo(event.target.files[0]));
  $('#subtitleFile').addEventListener('change', (event) => event.target.files[0] && loadSubtitles(event.target.files[0]));
  $('#recognize').addEventListener('click', recognize);
  $('#start').addEventListener('click', start);
  $('#stop').addEventListener('click', () => { engine?.stop(); engine = null; });

  function openLink() {
    let u;
    try { u = new URL($('#sharedUrl').value.trim()); } catch { return $('#linkHint').textContent = '请填写完整的 http(s) 网页地址。'; }
    if (!['http:', 'https:'].includes(u.protocol)) return;
    const android = /Android/i.test(navigator.userAgent);
    if (android) {
      location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.slice(0, -1)};package=org.mozilla.firefox;end`;
      $('#linkHint').hidden = false;
      $('#linkHint').textContent = '请用已安装 W 声幕扩展的 Firefox 打开；如果没有跳转，请复制链接到 Firefox。';
    } else {
      window.open(u.href, '_blank', 'noopener');
      $('#linkHint').hidden = false;
      $('#linkHint').textContent = '请确认链接在已启用 W 声幕扩展的 Safari 中打开。';
    }
  }
  $('#openUrl').addEventListener('click', openLink);

  async function consumeShare() {
    if (!location.search.includes('shared=1')) return;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('wdub-mobile-share', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('inbox');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('inbox', 'readwrite');
    const req = tx.objectStore('inbox').get('pending');
    const shared = await new Promise((resolve) => { req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(null); });
    tx.objectStore('inbox').delete('pending');
    db.close();
    if (shared?.file instanceof Blob) {
      loadVideo(shared.file);
      if (settings.keys.elevenlabs) recognize();
    } else if (shared?.url) {
      const match = String(shared.url).match(/https?:\/\/[^\s]+/);
      $('#sharedUrl').value = match?.[0] || shared.url;
      $('#linkHint').hidden = false;
      $('#linkHint').textContent = '链接已接收。点“在浏览器中打开”继续观看。';
    }
    history.replaceState(null, '', location.pathname);
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  consumeShare().catch((e) => say(`读取分享内容失败：${e.message}`, true));
})();
