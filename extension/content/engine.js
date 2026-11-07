// 实时配音引擎：边播边译、按句配音、配音和画面对齐、原声闪避。
//
// 对齐策略（比“一刀切放慢视频”更自然）：
//   1. 已知配音时长时，先把配音加速到刚好塞进这句的空档（最多 maxSpeed 倍，音调不变）；
//   2. 还塞不下，才临时放慢画面等配音念完，念完立刻恢复原速；
//   3. API 合成未完成及上一位说话人尚未念完时，画面等待配音；
//   4. 配音说话时压低原声，句子之间恢复，背景音乐和环境声不会全丢。
(function () {
  const WDub = globalThis.WDub;
  const MAX_CUES = 8000; // 约 5～6 小时的视频
  const MAX_CUE_CHARS = 600;
  // 等待预算：首屏必须短时间内出结果，后台批次可以慢一点（4.4.3）
  const FIRST_TIMEOUT = 12_000;
  const REST_TIMEOUT = 30_000;

  const CJK = /[぀-ヿ㐀-鿿가-힯]/g;
  // 粗估 1 倍速朗读时长（秒）：中日韩约 4.6 字/秒，其他语言约 2.8 词/秒
  function estimateSeconds(text) {
    const cjk = (text.match(CJK) || []).length;
    const words = text.replace(CJK, ' ').split(/\s+/).filter(Boolean).length;
    return cjk / 4.6 + words / 2.8 + 0.25;
  }

  class DubEngine {
    // mode: dub（边播边译 + 配音）| subtitle（先翻当前位置，再后台翻译其余字幕）
    constructor(video, { rpc, settings, onState, mode = 'dub' }) {
      this.video = video;
      this.rpc = rpc;
      this.s = settings;
      this.mode = mode;
      this.dubbing = mode === 'dub';
      this.phase = 'idle';
      this.onState = onState || (() => {});
      this.overlay = new WDub.SubtitleOverlay(video);
      this.overlay.applyStyle(settings.subtitle);
      this.cues = [];
      this.autoPacks = [];
      this.termSource = '';
      this.running = false;
      this.swapped = false;
      this.speaking = null; // { key, cueIndex }
      this.pending = null; // 配音还没念完时到点的下一句
      this.lastSpoken = -1;
      this.slowed = false;
      this.prepared = new Map(); // key -> Promise<{duration}>
      this.txBusy = new Set(); // 正在翻译的句子下标：拖动进度条和后台补翻叠在一起时，同一句不重复发请求
      this.restClaim = new Set(); // 已被后台 worker 认领的批次起点，避免两个 worker 抢同一批
      this.cueWait = null; // 当前句等译文的退避状态
      this.failedCues = new Set(); // 明确放弃配音的句子下标
      this.txFp = undefined; // 翻译配置指纹：变了就整片重翻
      this.taskVersion = 0; // 每次重翻递增；迟到的旧结果不得回写
      this.retryBase = 1500; // 后台批次失败后的退避起点（毫秒），测试里可以调小
      this.pinned = new Map();
      this.voiceTurn = { male: 0, female: 0 };
      this.ourRateChange = false;
      this.ourVolumeChange = false;
      this.scrubbing = false;
      this.seekShouldResume = false;
      this.seekTimer = null;
      this.onVideoEvent = this.onVideoEvent.bind(this);
      this.tick = this.tick.bind(this);
    }

    get engine() {
      return WDub.ttsEngine(this.s);
    }

    // ---------- 生命周期 ----------

    async start(cues, meta = {}) {
      this.meta = meta;
      this.cueOverrides = { ...(meta.overrides || {}) };
      // 字幕可能来自网页（网页可以伪造），设上限，防止被塞进海量字幕刷掉你的翻译 / 配音额度
      this.cues = cues.slice(0, MAX_CUES).map((c) => ({ ...c, text: String(c.text).slice(0, MAX_CUE_CHARS) }));
      this.txBusy.clear();
      this.restClaim.clear();
      this.cueWait = null;
      this.failedCues.clear();
      WDub.Subs.extractSpeakers(this.cues);
      this.applyCueOverrides();
      this.running = true;
      if (this.dubbing) {
        this.baseRate = this.video.playbackRate || 1;
        this.wasMuted = this.video.muted;
        this.baseVolume = this.video.muted ? 1 : (this.video.volume ?? 1);
      }
      // 用户点配音时若视频正播放，先停在当前画面；避免主题判断和翻译期间先听到原声。
      this.startupPausedVideo = this.dubbing && !this.video.paused;
      if (this.startupPausedVideo) this.video.pause();
      this.setNativeCaptionsHidden(this.s.subtitle.hideNative && this.s.subtitle.mode !== 'off');
      // 主题判断不再挡在首批翻译前面：先本地关键词定词表，AI 判断放后台跑（4.5.2）
      this.primeTermPacks();
      this.termFp = WDub.termFingerprint(this.s, this.autoPacks);
      this.txFp = WDub.translationFingerprint(this.s);
      this.taskVersion++;
      this.refineTermPacks();
      if (!this.running) return;
      if (!this.dubbing) return this.startSubtitleOnly();
      if (globalThis.WDubMobile) {
        const original = this.video.volume;
        const probe = original > 0.5 ? 0.25 : 0.75;
        try {
          this.video.volume = probe;
          this.volumeAdjustable = Math.abs(this.video.volume - probe) < 0.01;
          this.video.volume = original;
        } catch { this.volumeAdjustable = false; }
      }
      if (this.video.muted) this.video.muted = false;
      for (const ev of ['seeking', 'seeked', 'pause', 'play', 'ratechange', 'volumechange', 'ended']) this.video.addEventListener(ev, this.onVideoEvent);
      // 先翻当前位置附近的一批；用户原本正在播放时，首句配音开始后再恢复画面。
      this.emit('preparing', '正在翻译当前片段…');
      try {
        await this.translateAround(this.video.currentTime);
      } catch (e) {
        this.emit('error', e.message);
        this.stop(false);
        this.video.pause();
        return;
      }
      if (!this.running) return;
      this.lastSpoken = this.indexAt(this.video.currentTime) - 1;
      this.loop = setInterval(this.tick, 100);
      this.applyIdleVolume();
      this.emit('playing');
      this.renderAt(this.video.currentTime);
      this.translateRest();
      if (this.startupPausedVideo) {
        this.startupPausedVideo = false;
        const i = this.indexAt(this.video.currentTime);
        const cue = this.cues[i];
        if (cue?.tr && this.video.currentTime < cue.end + 0.3) {
          this.prefetch(i);
          const { key } = this.keyFor(cue);
          this.syncHolding = { key, releasing: false };
          this.speak(i);
        } else {
          this.video.play().catch(() => {});
        }
      }
    }

    // 只翻字幕：视频照常播放，当前位置附近先翻好就显示，其余在后台继续翻（还没翻到的句子先显示原文）
    async startSubtitleOnly() {
      this.emit('preparing', '正在翻译字幕…');
      try {
        await this.translateAround(this.video.currentTime);
      } catch (e) {
        this.emit('error', e.message);
        return this.stop();
      }
      if (!this.running) return;
      this.loop = setInterval(this.tick, 100);
      this.emit('playing');
      this.renderAt(this.video.currentTime);
      this.translateRest(3);
    }

    stop(resumeVideo = true) {
      this.running = false;
      clearInterval(this.loop);
      clearTimeout(this.seekTimer);
      this.scrubbing = false;
      if (this.dubbing) {
        for (const ev of ['seeking', 'seeked', 'pause', 'play', 'ratechange', 'volumechange', 'ended']) this.video.removeEventListener(ev, this.onVideoEvent);
        this.rpc('tts.stop').catch(() => {});
        this.cancelSyncHold(resumeVideo);
        if (this.startupPausedVideo) {
          this.startupPausedVideo = false;
          if (resumeVideo) this.video.play().catch(() => {});
        }
        if (this.boundaryHolding) {
          this.boundaryHolding = false;
          if (resumeVideo) this.video.play().catch(() => {});
        }
        this.restoreRate();
        this.setVolume(this.baseVolume ?? 1);
        if (this.wasMuted != null) this.video.muted = this.wasMuted;
      }
      this.setNativeCaptionsHidden(false);
      this.overlay.destroy();
      this.emit('stopped');
    }

    emit(phase, message) {
      this.phase = phase;
      if (phase === 'playing' && globalThis.WDubMobile && this.volumeAdjustable === false) {
        message ||= '此浏览器不能调低原声；配音说话时会临时静音原声。';
      }
      const translated = this.cues.filter((c) => c.tr != null).length;
      this.onState({ phase, message, translated, total: this.cues.length, engine: this.translatorUsed, mode: this.mode,
        termPacks: WDub.activePackIds?.(this.s, this.autoPacks) || [], termSource: this.s.rules?.packMode === 'manual' ? 'manual' : this.termSource });
    }

    // 先用本地关键词定一版词表，零等待：第一批翻译马上能发出去（4.5.2）
    primeTermPacks() {
      if (!this.s.rules?.enabled || this.s.rules.packMode === 'manual') {
        this.autoPacks = [];
        this.termSource = 'manual';
        return;
      }
      this.autoPacks = WDub.suggestTermPackIds(this.meta.title, this.termSample());
      this.termSource = 'keywords';
    }

    termSample() {
      const step = Math.max(1, Math.ceil(this.cues.length / 80));
      const texts = [];
      for (let i = 0; i < this.cues.length && texts.length < 80; i += step) texts.push(this.cues[i].text);
      return texts;
    }

    // AI 判断挪到后台：只影响还没翻译的句子，已经显示的译文不重翻（4.5.3）
    refineTermPacks() {
      if (!this.s.rules?.enabled || this.s.rules.packMode === 'manual') return Promise.resolve();
      const before = this.autoPacks.join(',');
      const s = this.s;
      return this.rpc('terms.suggest', { title: this.meta.title || '', texts: this.termSample() })
        .then((r) => {
          if (!this.running || this.s !== s || this.s.rules?.packMode === 'manual') return;
          // 后台自己也会在 AI 失败时退回本地关键词，那种情况不用再动
          if (r?.source !== 'ai') return;
          const next = WDub.activePackIds(this.s, r.packs || []);
          if (next.join(',') === before) return;
          this.autoPacks = next;
          this.termSource = 'ai';
          // 换指纹会让在途批次的结果被丢弃，这些句子会重新排队，不会出现新旧词表混用
          this.termFp = WDub.termFingerprint(this.s, this.autoPacks);
          if (this.running) this.emit(this.phase);
        })
        .catch(() => {});
    }

    // 设置页从手动切回自动时用：先本地定词表，再后台问 AI
    async selectTermPacks() {
      this.primeTermPacks();
      await this.refineTermPacks();
    }

    updateSettings(s) {
      const enteringAuto = this.s.rules?.packMode === 'manual' && s.rules?.packMode !== 'manual';
      const engineChanged = WDub.ttsEngine(s) !== this.engine;
      const voiceConfigBefore = this.voiceConfig();
      const subtitleChanged = JSON.stringify(s.subtitle) !== JSON.stringify(this.s.subtitle);
      // 换了主声音或声音池：自动分配的声音重新来过，下一句起生效。
      // 只改了「说话人」列表不用重来：指定的声音本来就优先，其他人保持原来的声音
      const auto = (st) => JSON.stringify({ ...st.cast[this.engine], people: undefined }) + st.multiVoice;
      const castChanged = auto(s) !== auto(this.s);
      const voiceAssignmentChanged = JSON.stringify(s.cast[this.engine]) !== JSON.stringify(this.s.cast[this.engine]) || s.multiVoice !== this.s.multiVoice;
      this.s = s;
      if (enteringAuto) this.primeTermPacks();
      const nextFp = WDub.termFingerprint(s, this.autoPacks);
      const nextTFp = WDub.translationFingerprint(s);
      const previousFp = this.termFp;
      const previousTFp = this.txFp;
      this.termFp = nextFp;
      this.txFp = nextTFp;
      if (enteringAuto) this.refineTermPacks();
      // 翻译配置（语言、引擎、模型、接口、领域提示、术语、替换规则、提示词版本）变了才重翻。
      // 只改字号、颜色、音色不在这张指纹里，不会触发整片重译。
      const translationChanged = (previousTFp !== undefined && nextTFp !== previousTFp)
        || (previousFp !== undefined && nextFp !== previousFp);
      if (translationChanged) this.resetTranslations();
      if (subtitleChanged) this.shownKey = undefined;
      const voiceConfigChanged = voiceConfigBefore !== this.voiceConfig();
      this.overlay.applyStyle(s.subtitle);
      this.setNativeCaptionsHidden(s.subtitle.hideNative && s.subtitle.mode !== 'off');
      if (voiceConfigChanged || voiceAssignmentChanged) {
        this.prepared.clear();
        for (const cue of this.cues) delete cue.dur;
      }
      if (engineChanged || castChanged) this.reassignVoices();
      // 原声模式、音量改动立即生效，包括正在念的这一句
      if (this.dubbing) {
        this.applyVolume();
        if (this.speaking) this.rpc('tts.volume', { volume: this.dubVolume() }).catch(() => {});
      }
      this.renderAt(this.video.currentTime);
      if (this.running && this.dubbing && (engineChanged || voiceConfigChanged || voiceAssignmentChanged))
        this.restartVoiceAfterChange(s);
    }

    async restartVoiceAfterChange(settings) {
      const missing = WDub.missingKey?.(settings, 'tts');
      if (missing) {
        this.emit('error', `已选择 ${WDub.PROVIDERS?.[missing]?.name || missing}，请先填写它的 key；不会改用系统声音。`);
        this.stop(false);
        this.video.pause();
        return;
      }
      const wasPlaying = !this.video.paused || !!this.syncHolding || !!this.boundaryHolding;
      this.syncHolding = { key: 'voice-change', releasing: false };
      this.video.pause();
      this.speaking = null;
      this.pending = null;
      this.boundaryHolding = false;
      try {
        await this.rpc('tts.stop');
      } catch (e) {
        if (this.running && this.s === settings) {
          this.emit('error', `切换配音失败：${e.message}`);
          this.stop(false);
        }
        return;
      }
      if (!this.running || this.s !== settings) return;
      this.restoreRate();
      this.applyIdleVolume();
      const i = this.indexAt(this.video.currentTime);
      this.lastSpoken = i - 1;
      this.replayCueIndex = i;
      const cue = this.cues[i];
      if (wasPlaying && cue?.tr && this.video.currentTime < cue.end + 0.3) {
        const { key } = this.keyFor(cue);
        this.syncHolding = { key, releasing: false };
        this.speak(i);
      } else {
        this.syncHolding = null;
        if (wasPlaying) this.video.play().catch(() => {});
      }
    }

    // ---------- 翻译 ----------

    batchSize() {
      if (this.s.translator !== 'llm' || !this.s.llm.apiKey) return 30;
      // 翻译专用模型逐句翻译，批小一点，第一句出来得快
      return WDub.isMtModel(this.s.llm.model) ? 10 : this.s.llm.batchSize;
    }

    sameLanguage(detected) {
      const src = WDub.langBase(detected || this.meta.lang);
      return this.s.skipSameLanguage && src && src === WDub.langBase(this.s.targetLang);
    }

    async translateRange(from, to, timeout) {
      const fp = this.termFp;
      const ver = this.taskVersion;
      const idx = [];
      for (let i = from; i < to; i++) {
        const cue = this.cues[i];
        if (!cue || cue.tr != null || this.txBusy.has(i)) continue;
        idx.push(i);
      }
      if (!idx.length) return;
      const slice = idx.map((i) => this.cues[i]);
      if (this.sameLanguage()) {
        slice.forEach((c) => (c.tr = c.text));
        return;
      }
      idx.forEach((i) => this.txBusy.add(i));
      let res;
      try {
        res = await this.rpc('translate', {
          texts: slice.map((c) => c.text),
          from: this.s.sourceLang,
          to: this.s.targetLang,
          timeout,
          context: { title: this.meta.title, packs: this.autoPacks }
        });
      } finally {
        idx.forEach((i) => this.txBusy.delete(i));
      }
      if (ver !== this.taskVersion || fp !== this.termFp) return;
      this.translatorUsed = res.engine;
      if (res.detected && this.sameLanguage(res.detected)) {
        this.meta.lang = res.detected;
        this.cues.forEach((c) => c.tr == null && (c.tr = c.text));
      }
      slice.forEach((c, k) => {
        const item = res.items[k] || {};
        c.tr = item.t || c.text;
        if (item.s && !c.speaker) c.speaker = `ai:${item.s}`;
        // 一键识别人物后，男女以声音判断的为准
        if (item.g && !this.diarized) c.gender = item.g;
      });
      this.applyCueOverrides();
      if (this.running) this.emit(this.phase); // 只刷新进度，不改变阶段；停止后不再报告
    }

    async translateAround(t) {
      // 先只翻当前位置附近的几小批：点 W 之后第一屏字幕不用等一整批（大模型 40 句要十来秒）
      const i = Math.max(0, this.indexAt(t));
      const start = Math.max(0, i - 1);
      await this.translateRange(start, start + this.firstBatchSize(), FIRST_TIMEOUT);
    }

    // 清掉当前视频的译文、预合成音频和任务状态（重翻和清缓存共用）
    clearTranslationState() {
      this.taskVersion++;
      for (const cue of this.cues) {
        delete cue.tr;
        delete cue.dur;
      }
      this.prepared.clear();
      this.txBusy.clear();
      for (const key of this.restClaim) if (!key.startsWith(`${this.taskVersion}:`)) this.restClaim.delete(key);
      this.failedCues.clear();
      this.cueWait = null;
      this.shownKey = undefined;
      // 正在念的句子不打断；等它念完再由 tick 接着走
      if (!this.speaking) this.lastSpoken = this.indexAt(this.video.currentTime) - 1;
    }

    // 配置变了：清掉当前视频的译文和预合成音频，从当前位置重翻（4.2.3 / 4.2.6）
    resetTranslations() {
      this.clearTranslationState();
      if (!this.running) return;
      this.emit('preparing', '正在按新设置重新翻译…');
      this.translateAround(this.video.currentTime)
        .then(() => { if (this.running) this.translateRest(); })
        .catch(() => {});
    }

    // 用户在设置页清空缓存后：页面里已有的译文也要失效（文档 E）
    forgetTranslations() {
      this.clearTranslationState();
      this.renderAt(this.video.currentTime);
      if (this.running) this.translateRest();
    }

    firstBatchSize() {
      if (this.s.translator !== 'llm' || !this.s.llm.apiKey) return 12;
      return WDub.isMtModel(this.s.llm.model) ? 4 : 8;
    }

    // 从当前位置往后、再往前分批翻译。失败不再一次性停掉整个后台队列：
    // 每个 worker 各自退避重试，网络恢复后自动继续（4.4.8）
    async translateRest(workers = 3) {
      const size = this.batchSize();
      const gen = this.taskVersion;
      const worker = async () => {
        let strikes = 0;
        while (this.running && gen === this.taskVersion) {
          const pick = this.nextBatch(size, gen);
          if (!pick) return;
          try {
            await this.translateRange(pick.b, pick.b + size, REST_TIMEOUT);
            strikes = 0;
          } catch (e) {
            strikes++;
            this.lastError = `翻译出错：${e.message}`;
            // 连续失败到一定次数就明确告诉用户，而不是一直静默重试（文档 C：显示失败或配置指引）
            if (strikes === 5) this.emit('error', this.lastError);
            // 失败时保持认领，避免三个 worker 同时重试同一批
            const wait = Math.min(60_000, this.retryBase * 2 ** (strikes - 1));
            await new Promise((r) => setTimeout(r, wait));
            if (!this.running || gen !== this.taskVersion) return;
          } finally {
            this.restClaim.delete(pick.key);
          }
        }
      };
      await Promise.all(Array.from({ length: workers }, worker));
    }

    // 离当前播放位置最近的未翻译批次优先：拖到中段后不用等开头那几十批翻完
    nextBatch(size, gen = this.taskVersion) {
      const here = Math.floor(Math.max(0, this.indexAt(this.video.currentTime)) / size) * size;
      for (let d = 0; d < this.cues.length; d += size) {
        for (const b of [here + d, here - d - size]) {
          const key = `${gen}:${b}`;
          if (b < 0 || b >= this.cues.length || this.restClaim.has(key)) continue;
          if (!this.hasUntranslated(b, b + size)) continue;
          this.restClaim.add(key);
          return { b, key };
        }
      }
      return null;
    }

    hasUntranslated(from, to) {
      for (let i = from; i < to && i < this.cues.length; i++) {
        const cue = this.cues[i];
        if (cue && cue.tr == null && !this.txBusy.has(i)) return true;
      }
      return false;
    }

    // ---------- 声音分配 ----------

    readVoice(speakerId) {
      const people = this.s.cast[this.engine]?.people || [];
      const i = WDub.findVoiceBinding(people, speakerId, this.videoKey);
      if (i >= 0 && people[i].voice) return people[i].voice;
      return this.pinned.get(speakerId) || '';
    }

    assignVoice(cue) {
      const cast = this.s.cast[this.engine] || {};
      const narrator = cast.narrator || '';
      if (!this.s.multiVoice || !cue.speaker) return narrator;
      const people = cast.people || [];
      const i = WDub.findVoiceBinding(people, cue.speaker, this.videoKey);
      if (i >= 0 && people[i].voice) return people[i].voice;
      if (this.pinned.has(cue.speaker)) return this.pinned.get(cue.speaker);
      const gender = WDub.knownGender(cue.gender);
      if (!gender) return narrator;
      const poolName = gender === 'm' ? 'male' : 'female';
      const pool = cast[poolName] || [];
      const voice = pool.length ? pool[this.voiceTurn[poolName]++ % pool.length] : narrator;
      this.pinned.set(cue.speaker, voice);
      return voice;
    }

    // 一键识别人物的结果：按时间重叠把每句字幕对到说话人上，男女也用声音判断的结果。
    // 对不上任何片段的句子（比如背景音乐里的字幕）沿用上一句的说话人
    applySpeakers({ segments = [], speakers = [] }) {
      let j = 0, last = null;
      for (const c of this.cues) {
        while (j < segments.length && segments[j].end <= c.start) j++;
        const overlap = new Map();
        for (let k = j; k < segments.length && segments[k].start < c.end; k++) {
          const o = Math.min(c.end, segments[k].end) - Math.max(c.start, segments[k].start);
          if (o > 0) overlap.set(segments[k].speaker, (overlap.get(segments[k].speaker) || 0) + o);
        }
        const best = [...overlap].sort((a, b) => b[1] - a[1])[0]?.[0] ?? last;
        if (best == null) continue;
        last = best;
        c.speaker = `spk:${best}`;
        const g = speakers.find((sp) => sp.id === best)?.gender;
        if (g === 'm' || g === 'f') c.gender = g;
      }
      this.diarized = true;
      this.applyCueOverrides();
      this.reassignVoices();
      if (this.running) this.emit(this.phase);
    }

    cueKey(cue) {
      // 用时间定位同一句；校对错字后文字会变，但人物修正仍要保留。
      return `${Math.round(cue.start * 100)}:${Math.round(cue.end * 100)}`;
    }

    applyCueOverrides() {
      const genderBySpeaker = new Map();
      for (const fix of Object.values(this.cueOverrides || {})) {
        if (fix.speaker && ['m', 'f', 'u'].includes(fix.gender)) genderBySpeaker.set(fix.speaker, fix.gender);
      }
      for (const cue of this.cues) {
        const fix = this.cueOverrides?.[this.cueKey(cue)];
        if (fix) cue.speaker = fix.speaker || undefined;
        if (cue.speaker && genderBySpeaker.has(cue.speaker)) cue.gender = genderBySpeaker.get(cue.speaker);
      }
    }

    currentCueInfo() {
      if (!this.cues.length) return null;
      const t = this.video.currentTime;
      let index = Math.max(0, this.indexAt(t));
      if (t > this.cues[index].end + 0.3 && index + 1 < this.cues.length) index++;
      const cue = this.cues[index];
      return { key: this.cueKey(cue), index, total: this.cues.length, text: cue.text,
        start: cue.start, speaker: cue.speaker || '', gender: cue.gender || 'u' };
    }

    setCueOverride(key, speaker, gender) {
      const cue = this.cues.find((c) => this.cueKey(c) === key);
      if (!cue) return false;
      this.cueOverrides ||= {};
      delete this.cueOverrides[key];
      this.cueOverrides[key] = { speaker: String(speaker || '').slice(0, 80), gender: ['m', 'f'].includes(gender) ? gender : 'u' };
      this.applyCueOverrides();
      this.reassignVoices();
      this.renderAt(this.video.currentTime);
      if (this.running) this.emit(this.phase);
      return true;
    }

    // 自动分配的声音从头再来（轮流计数也归零）
    reassignVoices() {
      this.pinned.clear();
      this.voiceTurn = { male: 0, female: 0 };
    }

    // 视频里认出的说话人，按出场顺序，带句数和现在用的声音（给弹窗用）
    speakers() {
      const map = new Map();
      for (const c of this.cues) {
        if (!c.speaker) continue;
        const sp = map.get(c.speaker) || map.set(c.speaker, { id: c.speaker, label: WDub.speakerLabel(c.speaker), count: 0, gender: null }).get(c.speaker);
        sp.count++;
        const gender = WDub.knownGender(c.gender);
        if (!sp.gender && gender) sp.gender = gender;
      }
      return [...map.values()].map((sp) => ({ ...sp, gender: sp.gender || 'u', voice: this.s.multiVoice ? this.readVoice(sp.id) : '' }));
    }

    voiceConfig() {
      const engine = this.engine;
      return JSON.stringify([engine, this.s.tts[engine], this.s.targetLang, this.s.rules.enabled && this.s.rules.pronunciation]);
    }

    keyFor(cue) {
      if (this.speaking && this.cues[this.speaking.cueIndex] === cue) return { voice: this.speaking.voice, key: this.speaking.key };
      const voice = this.assignVoice(cue);
      return { voice, key: WDub.hash(JSON.stringify([this.voiceConfig(), voice, cue.tr])) };
    }

    // ---------- 预生成配音 ----------

    prefetch(fromIndex) {
      if (this.engine === 'system') return;
      let inFlight = 0;
      for (const p of this.prepared.values()) if (!p.settled) inFlight++;
      for (let i = fromIndex; i < Math.min(this.cues.length, fromIndex + 6) && inFlight < 3; i++) {
        const cue = this.cues[i];
        if (cue.tr == null || !cue.tr.trim()) continue;
        const { key, voice } = this.keyFor(cue);
        if (this.prepared.has(key)) continue;
        const p = this.rpc('tts.prepare', { key, text: cue.tr, voice });
        p.then((r) => {
          if (this.keyFor(cue).key === key) cue.dur = r?.duration;
        }, () => this.prepared.delete(key)).finally(() => (p.settled = true));
        this.prepared.set(key, p);
        inFlight++;
      }
    }

    // ---------- 播放循环 ----------

    indexAt(t) {
      // 最后一个 start <= t 的句子
      let lo = 0, hi = this.cues.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.cues[mid].start <= t + 0.05) (ans = mid), (lo = mid + 1);
        else hi = mid - 1;
      }
      return ans;
    }

    renderAt(t) {
      const i = this.indexAt(t);
      const cue = this.cues[i];
      const active = this.speaking && this.cues[this.speaking.cueIndex];
      const showing = active && t >= active.start - 0.1 ? active : cue && t < cue.end + 0.3 ? cue : null;
      // 配音期间固定显示当前说话人的整句双语，避免两种语言各自分段后显示不同内容。
      // 翻译和配音共用同一句；若中英文各按字数单独截取，结尾会只剩脱离上下文的半句话。
      const view = showing && { text: showing.text, tr: showing.tr };
      const key = view ? `${view.text}\n${view.tr}` : '';
      if (key !== this.shownKey) {
        this.shownKey = key;
        this.overlay.render(view, this.s.subtitle.mode);
      }
    }

    tick() {
      if (!this.running) return;
      const t = this.video.currentTime;
      this.renderAt(t); // 暂停或拖动时也要更新画面上的字幕
      if (!this.dubbing) return;
      if (this.scrubbing || this.video.paused || this.video.seeking) return;
      if (this.speaking && !globalThis.WDubMobile) {
        const current = this.cues[this.speaking.cueIndex];
        const next = this.cues[this.speaking.cueIndex + 1];
        const boundary = next ? Math.min(current.end, next.start) : current.end;
        if (t >= boundary - 0.05) {
          this.boundaryHolding = true;
          this.video.pause();
          return;
        }
      }
      const i = this.indexAt(t);
      this.prefetch(Math.max(0, i));
      if (i <= this.lastSpoken || i < 0) return;
      const cue = this.cues[i];
      // 跳到句子中间（例如刚拖动进度条）且已过一半，就不念这句
      if (this.replayCueIndex !== i && t - cue.start > Math.max(1.2, (cue.end - cue.start) / 2)) {
        this.lastSpoken = i;
        return;
      }
      if (this.speaking) {
        this.pending = i;
        if (this.s.audio.slowVideoWhenLagging && !this.slowed) this.slowDown();
        return;
      }
      this.speak(i);
    }

    async speak(i) {
      const cue = this.cues[i];
      // 译文还没到：只补请求这一句，不写 lastSpoken，等它到了再念（4.6.1 / 4.6.3）
      if (cue.tr == null || !cue.tr.trim()) {
        if (this.failedCues.has(i)) this.lastSpoken = i; // 已明确放弃，推进游标，避免每个 tick 重来
        else this.requestCueTranslation(i);
        return;
      }
      this.replayCueIndex = null;
      this.lastSpoken = i;
      this.pending = null;
      const { key, voice } = this.keyFor(cue);
      const next = this.cues[i + 1];
      // 中文配音占用原句的画面时间；下一句提前开始时，以较早的边界为准。
      const boundary = next ? Math.min(cue.end, next.start) : cue.end;
      const mediaSlot = Math.max(0.1, boundary - Math.max(cue.start, this.video.currentTime));
      const wallSlot = mediaSlot / this.baseRate;
      // 先占住“正在说话”，等待合成期间到点的下一句会进入 pending，而不是并发播放
      this.speaking = { key, voice, cueIndex: i };
      this.holdVideoForVoice(key);
      this.renderAt(this.video.currentTime);
      this.setVolume(this.baseVolume * this.originalRatio(true));
      const prep = this.prepared.get(key);
      if (prep && !prep.settled) await prep.catch(() => {});
      if (this.speaking?.key !== key) return; // 等待期间被拖动进度条或停止了
      const dur = cue.dur ?? estimateSeconds(cue.tr);
      const rate = Math.min(Math.max(dur / wallSlot, 1), this.s.tts.maxSpeed);
      const videoRate = Math.min(this.baseRate, mediaSlot * rate / dur);
      if (videoRate < this.baseRate - 0.01) {
        this.slowed = true;
        this.setRate(Math.max(0.25, videoRate));
      }
      try {
        const result = await this.rpc('tts.play', { key, text: cue.tr, voice, rate, volume: this.dubVolume() });
        if (result?.started === false && this.speaking?.key === key) {
          this.speaking = null;
          this.applyIdleVolume();
        }
        await this.releaseSyncHold(key, result?.paused === true);
      } catch (e) {
        if (!this.running || this.speaking?.key !== key) return;
        this.emit('error', `所选配音未能播放，视频已暂停：${e.message}`);
        this.stop(false);
        this.video.pause();
      }
    }

    // 当前句没译文时单独补请求：退避重试，有上限，失败就明确放弃（4.6.5）
    requestCueTranslation(i) {
      const cue = this.cues[i];
      if (!cue || this.txBusy.has(i)) return;
      const now = Date.now();
      if (this.cueWait?.index !== i) this.cueWait = { index: i, tries: 0, nextAt: 0 };
      if (now < this.cueWait.nextAt) return;
      if (this.cueWait.tries >= 4) {
        this.cueWait = null;
        this.failedCues.add(i);
        this.lastError = `第 ${i + 1} 句翻译没拿到，已跳过配音`;
        return;
      }
      this.cueWait.tries++;
      this.cueWait.nextAt = now + Math.min(4000, 500 * 2 ** (this.cueWait.tries - 1));
      this.translateRange(i, i + 1, FIRST_TIMEOUT).catch(() => {});
    }

    holdVideoForVoice(key) {
      // 手机浏览器可能拒绝异步恢复 video.play()；仅桌面扩展自动等待。
      if (globalThis.WDubMobile || this.video.paused) return;
      this.syncHolding = { key, releasing: false };
      this.video.pause();
    }

    async releaseSyncHold(key, voicePaused = false) {
      const hold = this.syncHolding;
      if (!hold || hold.key !== key) return;
      hold.releasing = true;
      if (!this.running) return this.cancelSyncHold();
      try {
        await this.video.play();
      } catch {
        if (this.syncHolding === hold) this.syncHolding = null;
        this.rpc('tts.pause').catch(() => {});
        return;
      }
      if (this.syncHolding === hold) this.syncHolding = null;
      // 暂停和播放消息可能在后台交错到达；新音频若继承了旧暂停状态，画面恢复后立即继续它。
      if (voicePaused && this.running && this.speaking?.key === key && !this.video.paused) {
        await this.rpc('tts.resume').catch((e) => console.warn('W 声幕：恢复配音失败', e));
      }
    }

    cancelSyncHold(resumeVideo = true) {
      if (!this.syncHolding) return;
      this.syncHolding = null;
      if (resumeVideo) this.video.play().catch(() => {});
    }

    onAudioEnded(key, reason) {
      if (!this.speaking || this.speaking.key !== key) return;
      if (reason === 'error') {
        this.emit('error', '所选配音播放出错，视频已暂停。请检查声音设置后重试。');
        this.stop(false);
        this.video.pause();
        return;
      }
      this.speaking = null;
      this.restoreRate();
      if (this.boundaryHolding) {
        this.boundaryHolding = false;
        if (this.running) this.video.play().catch(() => {});
      }
      this.renderAt(this.video.currentTime);
      if (this.pending != null && this.running && !this.video.paused) {
        const t = this.video.currentTime;
        const cue = this.cues[this.pending];
        // 放慢等待后，只要下一句还在进行就接着念
        if (cue && t < cue.end + 0.5) return this.speak(this.pending);
      }
      this.pending = null;
      this.applyIdleVolume();
    }

    slowDown() {
      this.slowed = true;
      this.setRate(Math.max(this.s.audio.minVideoRate, 0.25) * this.baseRate);
    }

    restoreRate() {
      if (!this.slowed) return;
      this.slowed = false;
      this.setRate(this.baseRate);
    }

    setRate(r) {
      this.ourRateChange = true;
      this.video.playbackRate = r;
      setTimeout(() => (this.ourRateChange = false), 50);
    }

    // ---------- 音量 ----------

    dubVolume() {
      return this.swapped ? 0.25 : this.s.audio.dubVolume;
    }

    setVolume(v) {
      this.ourVolumeChange = true;
      if (globalThis.WDubMobile && this.volumeAdjustable === false) {
        // iPhone Safari may keep video.volume fixed at 1. Mute during dubbing instead of promising ducking.
        this.video.muted = !this.swapped && (this.s.audio.originalMode === 'mute' || !!this.speaking);
        setTimeout(() => (this.ourVolumeChange = false), 50);
        return;
      }
      this.video.volume = Math.min(Math.max(v, 0), 1);
      setTimeout(() => (this.ourVolumeChange = false), 50);
    }

    // 原声音量相对用户原本音量的比例。speaking：配音正在说话
    //   静音原声：始终 0；保留原声：说话时压到 originalVolume，句子之间按智能闪避恢复
    //   Alt+S 切到原声时一律 1
    originalRatio(speaking = !!this.speaking) {
      const a = this.s.audio;
      if (this.swapped) return 1;
      if (a.originalMode === 'mute') return 0;
      return speaking ? a.originalVolume : a.smartDuck ? a.idleVolume : a.originalVolume;
    }

    applyIdleVolume() {
      if (this.speaking) return;
      this.setVolume(this.baseVolume * this.originalRatio(false));
    }

    applyVolume() {
      this.setVolume(this.baseVolume * this.originalRatio());
    }

    swapVolume() {
      this.swapped = !this.swapped;
      this.rpc('tts.volume', { volume: this.dubVolume() });
      this.applyVolume();
      return this.swapped;
    }

    // ---------- 视频事件 ----------

    onVideoEvent(e) {
      switch (e.type) {
        case 'seeking':
          clearTimeout(this.seekTimer);
          this.seekShouldResume ||= !!(this.syncHolding || this.boundaryHolding);
          this.scrubbing = true;
          this.cancelSyncHold(false);
          if (this.boundaryHolding) {
            this.boundaryHolding = false;
          }
          this.rpc('tts.stop').catch(() => {});
          this.speaking = null;
          this.pending = null;
          this.restoreRate();
          this.lastSpoken = this.indexAt(this.video.currentTime) - 1;
          this.applyIdleVolume();
          // 拖动时 seeking 会连续触发几十次，这里不发请求，等松手后的 seeked 再翻，避免重复批次打满接口
          break;
        case 'seeked':
          // 原生进度条拖动会连续触发 seeking/seeked；等最后一次松手后再启动配音。
          clearTimeout(this.seekTimer);
          this.seekTimer = setTimeout(() => {
            if (!this.running || this.video.seeking) return;
            this.scrubbing = false;
            this.lastSpoken = this.indexAt(this.video.currentTime) - 1;
            this.renderAt(this.video.currentTime);
            // 松手后只翻当前位置附近一小批，其余交给 translateRest 补
            this.translateAround(this.video.currentTime).catch(() => {});
            const resume = this.seekShouldResume;
            this.seekShouldResume = false;
            if (resume && this.video.paused) this.video.play().catch(() => {});
          }, 250);
          break;
        case 'pause':
          if (this.scrubbing || this.syncHolding || this.boundaryHolding) break;
          this.rpc('tts.pause').catch(() => {});
          break;
        case 'play':
          if (this.scrubbing) break;
          if (this.boundaryHolding) {
            this.video.pause();
            break;
          }
          if (this.syncHolding) {
            if (!this.syncHolding.releasing) this.video.pause();
            else this.syncHolding = null;
            break;
          }
          this.rpc('tts.resume').catch(() => {});
          break;
        case 'ratechange':
          if (!this.ourRateChange && !this.slowed) this.baseRate = this.video.playbackRate;
          break;
        case 'volumechange':
          // 用户自己拖了音量条：以此为新的基准音量
          if (!this.ourVolumeChange && !this.video.muted) {
            const ratio = this.originalRatio();
            if (ratio > 0) this.baseVolume = Math.min(1, this.video.volume / ratio);
          }
          break;
        case 'ended':
          this.rpc('tts.stop').catch(() => {});
          break;
      }
    }

    setNativeCaptionsHidden(hide) {
      document.documentElement.classList.toggle('wdub-hide-native', !!hide);
      for (const tr of this.video.textTracks || []) {
        if (hide && tr.mode === 'showing') {
          tr.mode = 'hidden';
          tr.__wdubWasShowing = true;
        } else if (!hide && tr.__wdubWasShowing) {
          tr.mode = 'showing';
          delete tr.__wdubWasShowing;
        }
      }
    }

    setSubtitleMode(mode) {
      this.s.subtitle.mode = mode;
      this.shownKey = undefined;
      this.setNativeCaptionsHidden(this.s.subtitle.hideNative && mode !== 'off');
      this.renderAt(this.video.currentTime);
    }

    exportSrt() {
      return WDub.Subs.toSrt(this.cues, 'tr');
    }
  }

  WDub.DubEngine = DubEngine;
})();
