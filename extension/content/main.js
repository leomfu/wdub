// 内容脚本总调度：找视频、拿字幕、连后台、响应快捷键和悬浮球。
(function () {
  const WDub = globalThis.WDub;
  if (WDub.app) return;

  // ---------- 与后台的长连接 ----------
  let port = null;
  let seq = 0;
  const waiting = new Map();
  const listeners = new Set();

  function connect() {
    port = chrome.runtime.connect({ name: 'wdub' });
    port.onMessage.addListener((msg) => {
      if (msg.event) return listeners.forEach((fn) => fn(msg));
      const w = waiting.get(msg.id);
      if (!w) return;
      waiting.delete(msg.id);
      if (msg.error) return w.reject(new Error(msg.error));
      Promise.resolve(msg.result?.mobileAudio ? WDub.MobileAudio.handle(msg.result.mobileAudio) : msg.result)
        .then(w.resolve, w.reject);
    });
    port.onDisconnect.addListener(() => {
      port = null;
      for (const w of waiting.values()) w.reject(new Error('后台已重启，请重试'));
      waiting.clear();
    });
  }

  function rpc(type, payload) {
    if (!port) connect();
    const id = ++seq;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      port.postMessage({ id, type, payload });
    });
  }

  // ---------- 页面主环境（hook.js）通信 ----------
  const captured = []; // { url, cues, lang, asr, at }
  let askSeq = 0;
  const asks = new Map();

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d?.__wdub) return;
    if (d.__wdub === 'answer') {
      asks.get(d.id)?.(d.result);
      asks.delete(d.id);
    }
    if (d.__wdub === 'subs') onCaptured(d.url, d.body);
  });

  function askPage(what, extra = {}) {
    const id = ++askSeq;
    return new Promise((resolve) => {
      asks.set(id, resolve);
      window.postMessage({ __wdub: 'ask', id, what, ...extra }, '*');
      setTimeout(() => asks.has(id) && (asks.delete(id), resolve(null)), 1500);
    });
  }

  function onCaptured(url, body) {
    let cues;
    try {
      cues = WDub.Subs.parseAny(body, url);
    } catch {
      return;
    }
    if (!cues || cues.length < 3) return;
    let params;
    try {
      params = new URL(url, location.href).searchParams;
    } catch {
      params = new URLSearchParams();
    }
    if (params.get('tlang')) return; // YouTube 机翻字幕，跳过，用原文自己翻
    const item = { url, cues, lang: params.get('lang') || '', asr: params.get('kind') === 'asr', vid: params.get('v'), at: Date.now() };
    const dup = captured.findIndex((c) => c.url === url);
    if (dup >= 0) captured.splice(dup, 1);
    captured.push(item);
    if (captured.length > 12) captured.shift();
    if (!app.engine && app.lastState?.phase !== 'preparing') {
      app.ui?.setState({ phase: 'idle', message: `已获取字幕：${cues.length} 句${item.lang ? ` · ${item.lang}` : ''}` });
    }
  }

  // ---------- 视频与字幕 ----------
  const isYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
  const ytVideoId = () => new URL(location.href).searchParams.get('v') || (location.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{6,})/) || [])[1];

  function findVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const a = r.width * r.height;
      if (r.width >= 200 && r.height >= 110 && a > area && getComputedStyle(v).visibility !== 'hidden') (best = v), (area = a);
    }
    return best;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function youtubeSubtitles() {
    const vid = ytVideoId();
    const pick = () => {
      const list = captured.filter((c) => !c.vid || c.vid === vid);
      // 人工字幕优先于自动生成；同类取最新
      return list.filter((c) => !c.asr).at(-1) || list.at(-1);
    };
    let got = pick();
    if (got) return got;
    const info = await askPage('ytInfo');
    if (info?.isLive) throw new Error('直播暂不支持配音');
    const tracks = info?.tracks || [];
    if (!tracks.length) throw new Error('这个视频没有字幕。可以点「导入字幕」用自己的 SRT 文件。');
    const target = WDub.langBase(app.settings.targetLang);
    const src = app.settings.sourceLang !== 'auto' ? WDub.langBase(app.settings.sourceLang) : null;
    const score = (t) => (src && WDub.langBase(t.lang) === src ? 8 : 0) + (t.asr ? 0 : 4) + (WDub.langBase(t.lang) === target ? -6 : 0) + (WDub.langBase(t.lang) === 'en' ? 1 : 0);
    const track = [...tracks].sort((a, b) => score(b) - score(a))[0];
    await askPage('ytLoadTrack', { lang: track.lang });
    for (let i = 0; i < 30 && !(got = pick()); i++) await sleep(150);
    if (!got) throw new Error('没能读取到 YouTube 字幕，请点一下播放器的 CC 按钮后再试。');
    return got;
  }

  async function findSubtitles(video) {
    if (app.imported && app.imported.page === location.href) return app.imported;
    if (isYouTube) return { ...(await youtubeSubtitles()), title: (await askPage('ytInfo'))?.title };
    const recent = captured.at(-1);
    if (recent) return recent;
    for (const tr of video.textTracks || []) {
      if (!/subtitles|captions/.test(tr.kind)) continue;
      if (tr.mode === 'disabled') {
        tr.mode = 'hidden';
        await sleep(800);
      }
      const cues = WDub.Subs.fromTextTrack(tr);
      if (cues.length >= 3) return { cues, lang: tr.language };
    }
    throw new Error('没有找到字幕。先打开视频自带的字幕（CC），或点「导入字幕」载入 SRT/VTT 文件。');
  }

  // ---------- 应用 ----------
  const app = (WDub.app = {
    settings: null,
    engine: null,
    ui: null,
    imported: null,

    async init() {
      this.settings = await WDub.getSettings();
      WDub.onSettingsChanged((s) => {
        const modeChanged = s.wMode !== this.settings.wMode;
        this.settings = s;
        this.ui?.sync(s);
        this.engine?.updateSettings(s);
        this.refreshUi();
        // 运行中切换了「点 W 时」的模式：立即按新模式重新开始（翻译过的句子有缓存，几乎不用等）
        if (modeChanged && this.engine && this.engine.mode !== s.wMode && !this.starting) {
          this.stop();
          this.start(s.wMode);
        }
      });
      listeners.add((msg) => msg.event === 'audioEnded' && this.engine?.onAudioEnded(msg.key, msg.reason));
      chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
        if (msg?.cmd && this.video) this.command(msg.cmd, msg.payload);
        // 设置页清空缓存后，已打开的页面不能继续用内存里的旧译文（文档 E）
        if (msg?.target === 'content' && msg.type === 'cache.cleared') this.engine?.forgetTranslations();
        // 弹窗打开时来询问当前页面的状态
        if (msg?.ask === 'state') {
          const st = this.lastState || { phase: 'idle' };
          reply({ hasVideo: !!(this.video || findVideo()), ...st, mode: this.engine?.mode || st.mode, ...this.speakerInfo() });
        }
      });
      this.watchTimer = setInterval(() => this.watch(), 1500);
      this.watch();
      // 取回主脚本启动前页面已经请求过的字幕
      askPage('replaySubs');
    },

    siteDisabled() {
      return this.settings.disabledSites.some((d) => location.hostname === d || location.hostname.endsWith('.' + d));
    },

    // 扩展被重新加载或停用后，页面上这份脚本已经和扩展断开：停止配音、移除自己的界面，不再显示过时的字幕
    retire() {
      clearInterval(this.watchTimer);
      this.pendingReview?.();
      try {
        this.engine?.stop();
      } catch {}
      this.engine = null;
      for (const k of ['ui', 'yt', 'bar', 'card', 'study']) this[k]?.destroy();
      this.ui = this.yt = this.bar = this.card = this.study = null;
      this.retired = true;
    },

    watch() {
      if (!chrome.runtime?.id) return this.retire();
      // 单页应用换了视频（例如 YouTube 点下一个），停止旧的配音
      if (this.lastUrl && this.lastUrl !== location.href && isYouTube) {
        this.stop();
        this.imported = null;
        this.study?.destroy();
        this.study = null;
      }
      this.lastUrl = location.href;
      const v = findVideo();
      if (this.engine && this.video && !this.video.isConnected) this.stop();
      if (v && !this.engine) this.video = v;
      this.refreshUi();
    },

    refreshUi() {
      if (this.retired) return;
      // 扩展自己的页面（本地播放器）有专门的面板
      if (location.protocol.startsWith('chrome-extension')) return;
      // 以播放器元素判断，嵌入式播放器（youtube-nocookie 等）也适用
      const onYouTube = !!document.querySelector('#movie_player .ytp-right-controls');
      if (!this.video && !onYouTube) return;
      if (!this.ui) {
        this.ui = new WDub.FloatingUI({
          onToggle: () => this.toggleMain(),
          onSetting: (k, v) => WDub.setSetting(k, v),
          onTermPacks: (ids) => WDub.setSettings({ 'rules.packMode': 'manual', 'rules.packs': ids }),
          onAddTerm: async (src, dst) => {
            const rows = [...(this.settings.rules.glossary || [])];
            const index = rows.findIndex((row) => row.src?.toLowerCase() === src.toLowerCase());
            const item = { src: src.slice(0, 120), dst: dst.slice(0, 200), on: true };
            if (index >= 0) rows[index] = item;
            else if (rows.length < 100) rows.push(item);
            await WDub.setSetting('rules.glossary', rows);
          },
          onEditTerm: (index, field, value) => {
            const rows = [...(this.settings.rules.glossary || [])];
            if (!rows[index] || !['src', 'dst'].includes(field)) return;
            rows[index] = { ...rows[index], [field]: value.slice(0, field === 'src' ? 120 : 200) };
            return WDub.setSetting('rules.glossary', rows);
          },
          onImport: (text, name) => this.importSubtitles(text, name),
          onExport: () => this.exportSrt(),
          onSummary: () => this.summary(),
          onOptions: () => rpc('open.options'),
          onVoices: () => rpc('tts.voices'),
          onTryVoice: (voice) => rpc('tts.test', { text: '你好，这是 W 声幕的配音试听。', voice }).catch(() => {}),
          getSpeakers: () => this.speakerInfo(),
          onDetectSpeakers: () => this.detectSpeakers(),
          onCorrectCue: (fix) => this.correctCue(fix),
          onJumpCue: (delta) => this.jumpCue(delta),
          onHideSite: () => WDub.setSetting('disabledSites', [...this.settings.disabledSites, location.hostname.replace(/^www\./, '')])
        });
        this.ui.sync(this.settings);
      }
      // 入口：YouTube 控制栏、其他网站播放栏位置都是「W + 设置」两个按钮；悬浮球可在设置里关闭
      const hidden = this.siteDisabled();
      this.ui.setBallVisible(!!this.video && this.settings.floatingBall && !hidden);
      const handlers = { onToggle: () => this.toggleMain(), onOpenSettings: (el) => this.ui.openAt(el) };
      if (onYouTube && this.settings.youtubeButton) {
        this.yt = this.yt || new WDub.YouTubeUI(handlers);
        this.yt.ensure();
        this.yt.setWMode(this.settings.wMode);
      } else if (this.yt) {
        this.yt.destroy();
        this.yt = null;
      }
      if (!onYouTube && this.video && this.settings.controlBar && !hidden) {
        this.bar = this.bar || new WDub.VideoBar(handlers);
        this.bar.attach(this.video);
        this.bar.setWMode(this.settings.wMode);
      } else if (this.bar) {
        this.bar.destroy();
        this.bar = null;
      }
      // 外观（亮色 / 暗色）应用到视频上的每个界面
      for (const part of [this.ui, this.bar, this.card, this.study]) if (part) WDub.applyTheme(part.host, this.settings.theme);
    },

    // 所有界面（悬浮面板、YouTube 按钮）的状态都从这里分发；mode 说明是配音还是只翻字幕
    state(st) {
      if (this.retired) return;
      st = { mode: this.mode, ...st };
      this.lastState = st;
      this.ui?.setState(st);
      this.yt?.setState(st);
      this.bar?.setState(st);
      // 加载进度卡片：自己的页面（本地播放器）有专门的面板，不需要
      if (!location.protocol.startsWith('chrome-extension')) {
        if (!this.card) {
          this.card = new WDub.LoadingCard();
          WDub.applyTheme(this.card.host, this.settings.theme);
        }
        this.card.update(st, this.video);
      }
    },

    // W 按钮、面板和弹窗的「开始」：没在运行就按「点 W 时」的设置开始，在运行就停止
    toggleMain() {
      if (this.starting) return;
      if (this.engine) return this.stop();
      return this.start(this.settings.wMode);
    },

    // 快捷键用：mode 是 dub（配音）| subtitle（只翻字幕）。再按同一个模式停止，按另一个模式直接切换
    async toggle(mode = 'dub') {
      if (this.starting) return;
      if (this.engine) {
        const same = this.engine.mode === mode;
        this.stop();
        if (same) return;
      }
      return this.start(mode);
    },

    async start(mode = 'dub') {
      if (mode === 'dub') WDub.MobileAudio?.unlock();
      this.mode = mode;
      this.starting = true;
      try {
        await this.startInner(mode);
      } finally {
        this.starting = false;
      }
    },

    async startInner(mode) {
      const video = this.video || findVideo();
      if (!video) return this.state({ phase: 'error', message: '页面上没有找到视频。' });
      const missingVoiceKey = mode === 'dub' && WDub.missingKey(this.settings, 'tts');
      if (missingVoiceKey) {
        return this.state({ phase: 'error', message: `已选择 ${WDub.PROVIDERS[missingVoiceKey]?.name || missingVoiceKey}，请先填写它的 key，才能开始配音。` });
      }
      this.video = video;
      this.state({ phase: 'preparing', message: '正在获取字幕…' });
      let subs;
      let recognized = false;
      try {
        subs = await findSubtitles(video);
      } catch (e) {
        const src = video.currentSrc || '';
        if (this.settings.asr.autoOnMissing) {
          try {
            if (/^https?:/.test(src) && !isYouTube) {
              try {
                subs = await this.recognizeUrl(src);
                recognized = true;
              } catch (directError) {
                if (!globalThis.WDubMobile && !['local', 'sensevoice'].includes(this.settings.asr.engine)) throw directError;
                subs = await this.recognizeStream();
                recognized = true;
              }
            } else {
              subs = await this.recognizeStream();
              recognized = true;
            }
          } catch (e2) {
            return this.state({ phase: 'error', message: `AI 识别失败：${e2.message}` });
          }
        } else {
          return this.state({ phase: 'error', message: e.message + ' 可在「语音识别」中开启无字幕自动识别。' });
        }
      }
      if (recognized) {
        const model = this.settings.asr[this.settings.asr.engine]?.model || '';
        const reviewKey = 'asr:review:' + WDub.hash(`${this.cueFixVideoKey()}|${this.settings.asr.engine}|${model}|${this.settings.asr.language}`);
        const saved = (await chrome.storage.local.get(reviewKey))[reviewKey];
        if (saved?.cues?.length) subs.cues = saved.cues;
        const reviewed = await this.reviewCues(subs.cues);
        if (!reviewed) return this.state({ phase: 'idle', message: '已取消字幕校对，视频保持原样。' });
        subs = { ...subs, cues: reviewed };
        await chrome.storage.local.set({ [reviewKey]: { cues: reviewed, at: Date.now() } });
        this.imported = { ...subs, page: location.href, title: '已校对的 AI 字幕' };
      }
      const engine = new WDub.DubEngine(video, { rpc, settings: this.settings, mode, onState: (st) => this.onEngineState(st, engine) });
      this.engine = engine;
      engine.videoKey = this.videoKey();
      engine.cueFixKey = this.cueFixVideoKey();
      const fixKey = 'cuefix:' + WDub.hash(engine.cueFixKey);
      const overrides = (await chrome.storage.local.get(fixKey))[fixKey] || {};
      if (engine !== this.engine) return;
      engine.start(subs.cues, { lang: subs.lang, title: subs.title || document.title, overrides });
      this.speakerJob = null;
      // 这个视频以前识别过人物：直接用上次的结果
      rpc('speakers.cached', { src: video.currentSrc })
        .then((r) => r && engine === this.engine && engine.applySpeakers(r))
        .catch(() => {});
    },

    // 区分视频的标识：YouTube 用视频号，其他网站用网页地址（不含参数）
    videoKey() {
      const v = isYouTube && new URLSearchParams(location.search).get('v');
      if (v) return `yt:${v}`;
      if (location.protocol === 'chrome-extension:' && this.video?.dataset.wdubFileKey) return `local:${this.video.dataset.wdubFileKey}`;
      return location.origin + location.pathname;
    },

    cueFixVideoKey() {
      const common = this.videoKey();
      return common.startsWith('yt:') || common.startsWith('local:') ? common : location.href.split('#')[0];
    },

    // 给弹窗和面板：视频里认出的说话人、识别人物的进度、当前视频
    speakerInfo() {
      return { speakers: this.engine?.speakers() || [], currentCue: this.engine?.currentCueInfo() || null,
        job: this.speakerJob || null, video: this.videoKey() };
    },

    jumpCue(delta) {
      const info = this.engine?.currentCueInfo();
      if (!info) return;
      const index = Math.max(0, Math.min(info.total - 1, info.index + (delta < 0 ? -1 : 1)));
      this.video.currentTime = this.engine.cues[index].start + 0.05;
      this.ui?.cast.update(this.speakerInfo());
    },

    async correctCue({ key, speaker, gender } = {}) {
      const engine = this.engine;
      if (!engine || typeof key !== 'string') return;
      // 没有说话人标签时，仅选择男声／女声也应生效：为这句建立一个新人物。
      if (!speaker && (gender === 'm' || gender === 'f')) speaker = '__new__';
      if (speaker === '__new__') {
        const ids = engine.speakers().map((sp) => Number(sp.id.match(/^spk:(\d+)$/)?.[1])).filter(Number.isFinite);
        speaker = `spk:${Math.max(-1, ...ids) + 1}`;
      }
      if (!engine.setCueOverride(key, speaker, gender)) return;
      const storageKey = 'cuefix:' + WDub.hash(engine.cueFixKey);
      this.cueSaveQueue = (this.cueSaveQueue || Promise.resolve()).catch(() => {}).then(() =>
        chrome.storage.local.set({ [storageKey]: { ...engine.cueOverrides } }));
      await this.cueSaveQueue;
      this.ui?.cast.update(this.speakerInfo());
    },

    // 一键识别人物：还没开始配音就先开始（要有字幕才能把人对到每一句上），然后交给后台分析
    async detectSpeakers() {
      if (this.speakerJob?.running) return;
      if (!this.engine) await this.start(this.settings.wMode);
      const engine = this.engine;
      if (!engine) return;
      const stages = {
        queued: '排队中…', download: '正在下载音频…', decode: '正在读取音频…', vad: '正在找出说话的片段…',
        cluster: '正在区分说话人…', upload: '正在用 ElevenLabs 识别…'
      };
      this.speakerJob = { running: true, text: '正在准备…' };
      const onProgress = (msg) => {
        if (msg.event !== 'speakersProgress') return;
        this.speakerJob.text = msg.stage === 'embed' && msg.total ? `正在分析声音 ${Math.round((msg.done / msg.total) * 100)}%` : stages[msg.stage] || '识别中…';
      };
      listeners.add(onProgress);
      try {
        const r = await rpc('speakers.detect', { src: this.video?.currentSrc || '' });
        if (engine === this.engine) engine.applySpeakers(r);
        this.speakerJob = { text: r.speakers?.length ? `认出 ${r.speakers.length} 个人，已按男女分好声音` : '没有听出说话的人' };
      } catch (e) {
        this.speakerJob = { error: e.message };
      } finally {
        listeners.delete(onProgress);
      }
    },

    // 视频没有字幕：交给后台下载并做语音识别，期间显示进度
    async recognizeUrl(src) {
      const engine = WDub.ASR_ENGINES.find(([v]) => v === this.settings.asr.engine)?.[1].split(' · ')[0] || 'AI';
      const started = Date.now();
      const onProgress = (msg) => {
        if (msg.event !== 'asrProgress' || msg.stage === 'heartbeat') return;
        const mb = (n) => (n / 1024 / 1024).toFixed(0);
        const text =
          msg.stage === 'download'
            ? `没有字幕，正在下载视频用于识别… ${mb(msg.done || 0)}${msg.total ? `/${mb(msg.total)}` : ''} MB`
            : msg.stage === 'decode'
              ? '正在提取音频…'
              : msg.stage === 'recognize'
                ? `${engine} 识别中${msg.total > 1 ? `（${msg.done + 1}/${msg.total}）` : ''}… 已用 ${Math.round((Date.now() - started) / 1000)} 秒`
                : '整理字幕…';
        this.state({ phase: 'preparing', message: text });
      };
      listeners.add(onProgress);
      this.state({ phase: 'preparing', message: `没有字幕，准备用 ${engine} 识别…` });
      try {
        const r = await rpc('asr.url', { url: src });
        if (!r.cues?.length) throw new Error('没有识别出语音');
        return { cues: r.cues, lang: r.language, title: document.title };
      } finally {
        listeners.delete(onProgress);
      }
    },

    async recognizeStream() {
      const started = Date.now();
      const onProgress = (msg) => {
        if (msg.event !== 'asrProgress' || !msg.stream) return;
        const stage = { queued: '排队中', download: '正在下载音频', recognize: '正在识别语音' }[msg.stage] || '正在整理字幕';
        this.state({ phase: 'preparing', message: `没有字幕，${stage}… 已用 ${Math.round((Date.now() - started) / 1000)} 秒` });
      };
      listeners.add(onProgress);
      this.state({ phase: 'preparing', message: '没有字幕，准备从网页提取音频…' });
      try {
        const r = await rpc('asr.stream', {});
        return { cues: r.cues, lang: r.language, title: document.title };
      } finally {
        listeners.delete(onProgress);
      }
    },

    reviewCues(source) {
      const video = this.video;
      const cues = source.map((cue) => ({ ...cue }));
      const wasPlaying = !video.paused;
      video.pause();
      this.state({ phase: 'preparing', message: `已识别 ${cues.length} 句，请先校对字幕。` });
      return new Promise((resolve) => {
        const host = document.createElement('div');
        host.className = 'wdub-asr-review';
        const root = host.attachShadow({ mode: 'closed' });
        WDub.setHTML(root, `<style>
          :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center;
            background: rgba(10,18,32,.65); font-family: -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif; }
          * { box-sizing: border-box; }
          .panel { width: min(560px,92vw); max-height: 86vh; display: flex; flex-direction: column; overflow: hidden;
            border-radius: 14px; background: #17243c; color: #f2f6ff; box-shadow: 0 18px 60px rgba(0,0,0,.5); }
          .head { padding: 16px 18px 8px; font-size: 16px; font-weight: 600; }
          .hint { padding: 0 18px 10px; color: #b9c9e0; font-size: 12px; line-height: 1.5; }
          .list { overflow: auto; padding: 0 18px; }
          .row { display: flex; align-items: start; gap: 9px; padding: 7px 0; border-top: 1px solid #394760; }
          .time { flex: none; width: 75px; margin-top: 7px; padding: 5px 0; background: none; border: 0;
            color: #a9c3eb; cursor: pointer; text-align: left; font-size: 11px; font-family: inherit; }
          textarea { flex: 1; min-height: 50px; resize: vertical; border: 1px solid #51627d; border-radius: 7px;
            padding: 7px; background: #22334e; color: #fff; font-size: 13px; line-height: 1.4; font-family: inherit; }
          .foot { display: flex; align-items: center; gap: 8px; padding: 12px 18px; border-top: 1px solid #394760; }
          .page { flex: 1; text-align: center; color: #b9c9e0; font-size: 12px; }
          button { border: 0; border-radius: 7px; padding: 8px 11px; background: #31445f; color: #f2f6ff; cursor: pointer; }
          button:disabled { opacity: .4; cursor: default; }
          .confirm { background: #e7f0ff; color: #142139; font-weight: 600; }
        </style>
        <div class="panel"><div class="head">先检查识别出的字幕</div>
          <div class="hint">点击时间可跳到该句；直接改错字，清空一行可删除误识别。确认后再开始翻译和配音。</div>
          <div class="list"></div><div class="foot"><button class="cancel">取消</button>
            <button class="prev">上一页</button><span class="page"></span><button class="next">下一页</button>
            <button class="confirm">确认并开始</button></div></div>`);
        const list = root.querySelector('.list');
        const size = 12;
        let page = 0;
        const render = () => {
          list.replaceChildren();
          for (const cue of cues.slice(page * size, (page + 1) * size)) {
            const row = document.createElement('div'); row.className = 'row';
            const time = document.createElement('button'); time.className = 'time'; time.textContent = WDub.Subs.fmtClock(cue.start);
            time.addEventListener('click', () => { video.currentTime = cue.start + 0.05; });
            const text = document.createElement('textarea'); text.value = cue.text;
            text.addEventListener('input', () => { cue.text = text.value; });
            row.append(time, text); list.append(row);
          }
          root.querySelector('.page').textContent = `${page + 1}/${Math.ceil(cues.length / size)} 页`;
          root.querySelector('.prev').disabled = page === 0;
          root.querySelector('.next').disabled = (page + 1) * size >= cues.length;
          list.scrollTop = 0;
        };
        const move = () => (document.fullscreenElement || document.documentElement).append(host);
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
        const finish = (result) => {
          host.remove();
          document.removeEventListener('fullscreenchange', move);
          window.removeEventListener('keydown', onKey, true);
          this.pendingReview = null;
          if (wasPlaying && video.paused) video.play().catch(() => {});
          resolve(result);
        };
        root.addEventListener('keydown', (e) => e.stopPropagation());
        root.querySelector('.cancel').addEventListener('click', () => finish(null));
        root.querySelector('.confirm').addEventListener('click', () => {
          const cleaned = cues.filter((c) => String(c.text).trim()).map((c) => ({ ...c, text: c.text.trim() }));
          if (cleaned.length) finish(cleaned);
        });
        root.querySelector('.prev').addEventListener('click', () => { page--; render(); });
        root.querySelector('.next').addEventListener('click', () => { page++; render(); });
        window.addEventListener('keydown', onKey, true);
        document.addEventListener('fullscreenchange', move);
        this.pendingReview = () => finish(null);
        move(); render();
      });
    },

    onEngineState(st, engine) {
      // 已经停掉的旧引擎还可能晚一步报告（例如还在路上的翻译请求回来了），不能影响当前的引擎
      if (engine !== this.engine) return;
      if (st.phase === 'stopped') {
        this.engine = null;
        if (this.lastState?.phase !== 'error') this.state({ phase: 'idle' });
        return;
      }
      this.state(st);
    },

    stop() {
      this.pendingReview?.();
      const e = this.engine;
      this.engine = null;
      e?.stop();
      this.state({ phase: 'idle' });
    },

    command(cmd, payload) {
      if (cmd === 'toggle-main') this.toggleMain();
      if (cmd === 'detect-speakers') this.detectSpeakers();
      if (cmd === 'correct-cue') this.correctCue(payload).catch((e) => this.toast(`保存人物修正失败：${e.message}`));
      if (cmd === 'jump-cue') this.jumpCue(payload?.delta);
      if (cmd === 'toggle-dubbing') this.toggle('dub');
      if (cmd === 'translate-subtitles') this.toggle('subtitle');
      if (cmd === 'cycle-subtitle-mode') {
        const order = ['bilingual', 'translated', 'off'];
        const next = order[(order.indexOf(this.settings.subtitle.mode) + 1) % 3];
        WDub.setSetting('subtitle.mode', next);
        this.engine?.setSubtitleMode(next);
        this.toast({ bilingual: '双语字幕', translated: '仅译文', off: '字幕已关闭' }[next]);
      }
      if (cmd === 'swap-volume' && this.engine) this.toast(this.engine.swapVolume() ? '已切到原声' : '已切到配音');
    },

    toast(text) {
      const el = document.createElement('div');
      el.className = 'wdub-toast';
      el.textContent = text;
      (document.fullscreenElement || document.documentElement).appendChild(el);
      setTimeout(() => el.remove(), 1600);
    },

    importSubtitles(text, name) {
      try {
        const cues = WDub.Subs.parseAny(text, name);
        if (!cues.length) throw new Error('文件里没有读到字幕');
        this.importCues(cues, name, '');
      } catch (e) {
        this.state({ phase: 'error', message: `字幕文件读取失败：${e.message}` });
      }
    },

    // 直接载入解析好的字幕（导入文件或语音识别结果）
    importCues(cues, name, lang) {
      this.imported = { cues, lang, page: location.href, title: name };
      this.state({ phase: 'idle', message: `已载入 ${name}：${cues.length} 句，点「开始配音」` });
      if (this.engine) {
        this.stop();
        this.start(this.mode);
      }
    },

    exportSrt() {
      if (!this.engine) return this.state({ phase: 'error', message: '先开始配音，翻译完成后再导出。' });
      const blob = new Blob([this.engine.exportSrt()], { type: 'text/plain;charset=utf-8' });
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `${(document.title || 'subtitle').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.${this.settings.targetLang}.srt`
      });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },

    async summary(force = false) {
      if (!this.video) return;
      if (!this.study) {
        this.study = new WDub.StudyPanel({
          onRetry: () => this.summary(true),
          onTest: () => rpc('study.test'),
          onHistory: () => rpc('open.study'),
          onSeek: (time) => {
            if (!Number.isFinite(time) || !this.video?.isConnected) return;
            try {
              this.video.currentTime = time;
              this.video.scrollIntoView({ block: 'center', behavior: 'smooth' });
            } catch { this.study?.setError('这个播放器暂时不支持跳到指定时间。'); }
          }
        });
        WDub.applyTheme(this.study.host, this.settings.theme);
      }
      this.ui?.togglePanel(false);
      this.study.open();
      const videoId = this.cueFixVideoKey();
      if (this.study.url !== videoId) this.study.setContext(videoId, document.title);
      this.study.setLoading();
      const run = this.studyRun = (this.studyRun || 0) + 1;
      try {
        const cues = this.engine?.cues?.length ? this.engine.cues : (await findSubtitles(this.video)).cues;
        if (!cues?.length) throw new Error('没有可用字幕。请先打开视频字幕，或完成语音识别。');
        const result = await rpc('summarize', {
          cues: cues.map((c) => ({ start: c.start, end: c.end, text: c.text, tr: c.tr, speaker: c.speaker })),
          title: document.title,
          url: videoId,
          sourceUrl: location.href,
          force
        });
        if (run === this.studyRun) this.study?.setData(result);
      } catch (e) {
        if (run === this.studyRun) {
          this.study?.setError(`整理失败：${e.message}`);
          if (/模型|API|key|Codex|Ollama|服务|口令/i.test(e.message)) this.study?.showConfigError(e.message);
        }
      }
    },

    rpc
  });

  app.init();
})();
