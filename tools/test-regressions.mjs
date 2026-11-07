import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const offscreenSource = readFileSync(new URL('../extension/offscreen/offscreen.js', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../extension/content/engine.js', import.meta.url), 'utf8');

function offscreen(fetch) {
  const played = [];
  class FakeAudio {
    constructor(src) { this.src = src; }
    set src(value) {
      this._src = value;
      queueMicrotask(() => this.onloadedmetadata?.());
    }
    get src() { return this._src; }
    get duration() { return 1; }
    async play() { played.push(this); }
    pause() { this.paused = true; }
  }
  let nextUrl = 0;
  class FakeURL extends URL {
    static createObjectURL() { return `blob:test-${++nextUrl}`; }
    static revokeObjectURL() {}
  }
  const context = vm.createContext({
    Audio: FakeAudio, Blob, Uint8Array, URL: FakeURL,
    fetch, queueMicrotask, setInterval, clearInterval,
    WDub: { ASR: { transcribe: async () => ({ cues: [] }) }, isPrivateHost: () => false },
    chrome: { runtime: { sendMessage: async () => {}, onMessage: { addListener() {} } } }
  });
  vm.runInContext(offscreenSource, context);
  return { context, played, run: (code) => vm.runInContext(code, context) };
}

const message = (key, model = 'first') => ({
  key, engine: 'custom', text: 'hello', voice: 'test', rate: 1, volume: 1,
  conf: { baseUrl: 'http://localhost/v1', model, apiKey: '' }
});
const audioResponse = () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])]) });

test('停止时尚未合成的语音不会在请求返回后播放', async () => {
  let finishFetch;
  const page = offscreen(() => new Promise((resolve) => { finishFetch = resolve; }));
  page.context.msg = message('delayed');
  const pending = page.run('play(msg)');
  page.run('stop()');
  finishFetch(audioResponse());
  const result = await pending;
  assert.equal(result.started, false);
  assert.equal(page.played.length, 0);
});

test('同一句话更改合成参数会重新请求语音，相同参数仍复用缓存', async () => {
  let requests = 0;
  const page = offscreen(async () => { requests++; return audioResponse(); });
  page.context.first = message('same', 'first');
  page.context.second = message('same', 'second');
  await page.run('load(first)');
  await page.run('load(first)');
  await page.run('load(second)');
  assert.equal(requests, 2);
});

test('网页视频超过安全上限时不会进入音频解码', async () => {
  let decoded = false;
  const page = offscreen(async () => ({
    ok: true, url: 'https://example.com/video.mp4',
    headers: { get: () => String(257 * 1024 ** 2) }
  }));
  page.context.WDub.ASR.transcribe = async () => { decoded = true; };
  page.context.job = { jobId: 'large', url: 'https://example.com/video.mp4', withCookies: false, allowPrivate: false, settings: {} };
  await assert.rejects(page.run('recognizeUrl(job)'), /256MB/);
  assert.equal(decoded, false);
});

test('更改语音风格后字幕缓存键变化并清除旧时长', () => {
  const WDub = {
    ttsEngine: (s) => s.tts.engine,
    hash: (s) => s,
    termFingerprint: () => 'off',
    translationFingerprint: () => 'tx',
    SubtitleOverlay: class { applyStyle() {} render() {} }
  };
  const context = vm.createContext({
    WDub, document: { documentElement: { classList: { toggle() {} } } },
    setTimeout, clearTimeout, setInterval, clearInterval
  });
  vm.runInContext(engineSource, context);
  const settings = (style) => ({
    tts: { engine: 'azure', azure: { style } },
    targetLang: 'zh-CN', rules: { enabled: false, pronunciation: [] },
    cast: { azure: { narrator: 'voice' } }, multiVoice: false,
    subtitle: { hideNative: false, mode: 'bilingual' },
    audio: { originalMode: 'keep', originalVolume: 0.5, idleVolume: 1, smartDuck: false }
  });
  const video = { currentTime: 0, textTracks: [], volume: 1 };
  const engine = new WDub.DubEngine(video, { rpc: async () => {}, settings: settings('plain') });
  const cue = { tr: '你好', dur: 1.5 };
  engine.cues = [cue];
  const before = engine.keyFor(cue).key;
  engine.updateSettings(settings('cheerful'));
  assert.notEqual(engine.keyFor(cue).key, before);
  assert.equal(cue.dur, undefined);
});

test('逐句修正的人物和男女声不会被自动分人结果覆盖', () => {
  const WDub = {
    hash: (s) => s,
    termFingerprint: () => 'off',
    translationFingerprint: () => 'tx',
    ttsEngine: () => 'system',
    SubtitleOverlay: class { applyStyle() {} },
    Subs: { extractSpeakers() {} }
  };
  const context = vm.createContext({ WDub, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(engineSource, context);
  const video = { currentTime: 0, textTracks: [], volume: 1 };
  const engine = new WDub.DubEngine(video, { rpc: async () => {}, settings: {
    tts: { engine: 'system' }, subtitle: {}, cast: { system: { narrator: '', male: [], female: [] } },
    multiVoice: true, audio: {}
  } });
  engine.cues = [{ start: 0, end: 2, text: 'Hello' }, { start: 2, end: 4, text: 'Again' }];
  engine.cueOverrides = {};
  engine.renderAt = () => {};
  const key = engine.cueKey(engine.cues[0]);
  assert.equal(engine.setCueOverride(key, 'spk:1', 'f'), true);
  engine.applySpeakers({ segments: [{ start: 0, end: 2, speaker: 0 }, { start: 2, end: 4, speaker: 1 }],
    speakers: [{ id: 0, gender: 'm' }, { id: 1, gender: 'm' }] });
  assert.equal(engine.cues[0].speaker, 'spk:1');
  assert.equal(engine.cues[0].gender, 'f');
  assert.equal(engine.cues[1].speaker, 'spk:1');
  assert.equal(engine.cues[1].gender, 'f');
  engine.cues[0].text = 'Corrected subtitle';
  engine.applyCueOverrides();
  assert.equal(engine.cues[0].speaker, 'spk:1');
});

test('配音模式在视频暂停时也立即显示当前字幕', async () => {
  const WDub = {
    ttsEngine: () => 'system',
    termFingerprint: () => 'off',
    translationFingerprint: () => 'tx',
    Subs: { extractSpeakers() {}, pieceAt: (text) => text },
    SubtitleOverlay: class {
      applyStyle() {}
      render(cue, mode) { this.last = { cue, mode }; }
      destroy() {}
    }
  };
  const context = vm.createContext({ WDub, setInterval, clearInterval, setTimeout, clearTimeout });
  vm.runInContext(engineSource, context);
  const video = { paused: true, currentTime: 1, playbackRate: 1, volume: 1, textTracks: [], addEventListener() {} };
  const engine = new WDub.DubEngine(video, { rpc: async () => {}, settings: {
    subtitle: { mode: 'bilingual', hideNative: false }, audio: {}, tts: { engine: 'system' }
  } });
  engine.setNativeCaptionsHidden = () => {};
  engine.translateAround = async () => {};
  engine.translateRest = async () => {};
  engine.applyIdleVolume = () => {};
  await engine.start([
    { start: 0, end: 2, text: 'Hello', tr: '你好' },
    { start: 2, end: 4, text: 'Again', tr: '再见' }
  ]);
  clearInterval(engine.loop);
  assert.equal(engine.overlay.last.cue.tr, '你好');
  assert.equal(engine.overlay.last.mode, 'bilingual');
  video.currentTime = 3;
  engine.tick();
  assert.equal(engine.overlay.last.cue.tr, '再见');
});

test('在设置中切换字幕模式时当前句立即重绘', () => {
  const renders = [];
  const WDub = {
    ttsEngine: () => 'system',
    termFingerprint: () => 'off',
    translationFingerprint: () => 'tx',
    Subs: { pieceAt: (text) => text },
    SubtitleOverlay: class {
      applyStyle() {}
      render(cue, mode) { renders.push({ cue, mode }); }
    }
  };
  const context = vm.createContext({ WDub, setInterval, clearInterval, setTimeout, clearTimeout });
  vm.runInContext(engineSource, context);
  const settings = (mode) => ({
    subtitle: { mode, hideNative: false }, tts: { engine: 'system' },
    cast: { system: {} }, multiVoice: false, audio: {}
  });
  const video = { currentTime: 1, textTracks: [], volume: 1 };
  const engine = new WDub.DubEngine(video, { rpc: async () => {}, settings: settings('off'), mode: 'subtitle' });
  engine.setNativeCaptionsHidden = () => {};
  engine.voiceConfig = () => '';
  engine.cues = [{ start: 0, end: 2, text: 'Hello', tr: '你好' }];
  engine.renderAt(video.currentTime);
  engine.updateSettings(settings('bilingual'));
  assert.deepEqual(renders.map((r) => r.mode), ['off', 'bilingual']);
  assert.equal(renders[1].cue.tr, '你好');
});

test('术语匹配按词边界，用户词盖过词库，说话人编号互不相认', () => {
  const defaults = readFileSync(new URL('../extension/shared/defaults.js', import.meta.url), 'utf8');
  const matcher = readFileSync(new URL('../extension/shared/term-match.js', import.meta.url), 'utf8');
  assert.throws(() => vm.runInContext(matcher, vm.createContext({ console })), /importScripts/);
  const context = { console, importScripts() {} };
  vm.createContext(context);
  vm.runInContext(defaults, context);
  vm.runInContext(matcher, context);
  const { WDub } = context;
  const packs = [[{ src: 'in', dst: '在' }, { src: 'cache', dst: '缓存' }, { src: '模型', dst: '模型' }]];
  assert.equal(WDub.matchTerms('investing', packs, []).some((hit) => hit.src === 'in'), false);
  assert.equal(WDub.matchTerms('in the fund', packs, []).some((hit) => hit.src === 'in' && hit.dst === '在'), true);
  assert.equal(WDub.matchTerms('cache', packs, [{ src: 'cache', dst: '高速缓存', on: true }]).find((hit) => hit.src.toLowerCase() === 'cache').dst, '高速缓存');
  assert.equal(WDub.matchTerms('cache', packs, [{ src: 'cache', dst: '高速缓存', on: true }]).find((hit) => hit.src.toLowerCase() === 'cache').kind, 'fixed');
  assert.equal(WDub.matchTerms('cache', packs, []).find((hit) => hit.src.toLowerCase() === 'cache').kind, 'reference');
  assert.equal(WDub.matchTerms('cache', packs, [{ src: 'cache', dst: '不用', on: false }]).find((hit) => hit.src.toLowerCase() === 'cache').dst, '缓存');
  assert.equal(WDub.matchTerms('cache', packs, [{ src: 'cache', dst: '', on: true }]).find((hit) => hit.src.toLowerCase() === 'cache').dst, '缓存');
  assert.equal(WDub.matchTerms('大模型', packs, []).some((hit) => hit.src === '模型'), true);
  assert.equal(WDub.findVoiceBinding([{ id: 'asr:0', voice: 'a', video: 'v' }], 'spk:0', 'v'), -1);
  assert.equal(WDub.findVoiceBinding([{ name: '说话人1', voice: 'a', video: 'v' }], 'spk:0', 'v'), -1);
  assert.ok(WDub.findVoiceBinding([{ id: 'spk:0', voice: 'a', video: 'v' }], 'spk:0', 'v') >= 0);
  assert.equal(WDub.knownGender('u'), null);
  assert.equal(WDub.knownGender('m'), 'm');
  const base = { rules: { enabled: true, packs: [], glossary: [] } };
  const next = { rules: { enabled: true, packs: ['learning'], glossary: [] } };
  const edited = { rules: { enabled: true, packs: [], glossary: [{ src: 'cache', dst: '缓存', on: true }] } };
  assert.notEqual(WDub.termFingerprint(base), WDub.termFingerprint(next));
  assert.notEqual(WDub.termFingerprint(base), WDub.termFingerprint(edited));
  assert.equal(WDub.voicePerson('Alice', 'nova', 'video').video, undefined);
  assert.equal(WDub.voicePerson('spk:1', 'nova', 'video').video, 'video');
  context.WDub.SubtitleOverlay = class { applyStyle() {} render() {} };
  context.WDub.ttsEngine = () => 'system';
  context.setTimeout = setTimeout;
  context.clearTimeout = clearTimeout;
  vm.runInContext(readFileSync(new URL('../extension/content/engine.js', import.meta.url), 'utf8'), context);
  const engine = new context.WDub.DubEngine({ currentTime: 0, textTracks: [], volume: 1 }, {
    rpc: async () => {},
    settings: {
      tts: { engine: 'system' },
      cast: { system: { narrator: 'narr', male: ['m1'], female: ['f1'] } },
      multiVoice: true,
      subtitle: {},
      audio: {},
      rules: { enabled: true, packs: [], glossary: [] }
    }
  });
  engine.videoKey = 'v';
  engine.assignVoice({ speaker: 'spk:9', gender: 'u' });
  assert.equal(engine.readVoice('spk:9'), '');
  assert.equal(engine.assignVoice({ speaker: 'spk:8', gender: 'm' }), 'm1');
  engine.cues = [
    { speaker: 'spk:0', gender: 'u' },
    { speaker: 'spk:0', gender: 'f' },
    { speaker: 'asr:0', gender: 'm' },
    { speaker: 'asr:0', gender: 'u' }
  ];
  const people = engine.speakers();
  assert.equal(people.find((person) => person.id === 'spk:0').gender, 'f');
  assert.equal(people.find((person) => person.id === 'asr:0').gender, 'm');
  assert.equal(people.find((person) => person.id === 'spk:0').voice, '');
});

test('没有术语命中时沿用原来的翻译缓存键', async () => {
  const defaults = readFileSync(new URL('../extension/shared/defaults.js', import.meta.url), 'utf8');
  const matcher = readFileSync(new URL('../extension/shared/term-match.js', import.meta.url), 'utf8');
  const context = { console, importScripts() {} };
  vm.createContext(context);
  vm.runInContext(defaults, context);
  vm.runInContext(matcher, context);
  const { WDub } = context;
  const spec = { engine: 'llm', model: 'deepseek-chat', detectSpeakers: true, to: 'zh-CN' };
  const empty = await WDub.translationPlan({ rules: { enabled: true, packs: [], glossary: [] } }, ['Hello'], spec);
  assert.equal(empty.hits.length, 1);
  assert.equal(empty.hits[0].length, 0);
  assert.equal(empty.keys[0], WDub.translationKeys(spec, ['Hello'])[0], '没有术语命中时与不带术语的键一致');
  const hit = await WDub.translationPlan({
    rules: { enabled: true, packs: [], glossary: [{ src: 'Hello', dst: '你好', on: true }] }
  }, ['Hello'], spec);
  assert.equal(hit.hits[0][0].dst, '你好');
  assert.notEqual(hit.keys[0], empty.keys[0]);
});

test('视频主题自动选择精选词表，旧版大词典不会自动启用', async () => {
  const defaults = readFileSync(new URL('../extension/shared/defaults.js', import.meta.url), 'utf8');
  const matcher = readFileSync(new URL('../extension/shared/term-match.js', import.meta.url), 'utf8');
  const context = {
    console, importScripts() {},
    chrome: { runtime: { getURL: (path) => path } },
    fetch: async (path) => ({ ok: true, json: async () => JSON.parse(readFileSync(new URL(`../extension/${path}`, import.meta.url), 'utf8')) })
  };
  vm.createContext(context);
  vm.runInContext(defaults, context);
  vm.runInContext(matcher, context);
  const { WDub } = context;
  const selected = WDub.suggestTermPackIds('AI agents and language models', [
    'We use a large language model for this AI agent.', 'The neural network learns from training data.'
  ]);
  assert.deepEqual([...selected], ['ai-modern']);
  assert.ok(!selected.includes('programming'));
  const s = { rules: { enabled: true, packMode: 'auto', packs: ['business'], glossary: [] } };
  assert.deepEqual([...WDub.activePackIds(s, selected)], ['ai-modern'], '旧版手选词典不应混入自动结果');
  const plan = await WDub.translationPlan({ rules: { ...s.rules, packs: selected } },
    ['This large language model helps.'], { engine: 'llm', model: 'test', to: 'zh-CN' });
  assert.equal(plan.hits[0].find((hit) => hit.src === 'large language model')?.dst, '大语言模型');
  assert.deepEqual([...WDub.suggestTermPackIds('Daily conversation', ['Hello, how are you?'])], []);
  for (const [title, subtitles, expected] of [
    ['Python programming tutorial', ['We use source code and debugging in this repository.'], 'programming-modern'],
    ['English pronunciation lesson', ['Practice your vocabulary and speaking practice.'], 'english-modern'],
    ['Algebra and calculus', ['Solve this equation and find its derivative.'], 'math-modern'],
    ['Physics: quantum mechanics', ['Velocity, momentum and kinetic energy are important.'], 'physics-modern']
  ]) {
    const ids = WDub.suggestTermPackIds(title, subtitles);
    assert.ok(ids.includes(expected), `${title} 应选择 ${expected}`);
    assert.ok(ids.length <= 2);
  }
});

test('旧用户手选词表保持手动，新用户默认按视频自动选择', () => {
  const defaults = readFileSync(new URL('../extension/shared/defaults.js', import.meta.url), 'utf8');
  const context = vm.createContext({ structuredClone });
  vm.runInContext(defaults, context);
  assert.equal(context.WDub.fromStored({ rules: { packs: ['business'] } }).rules.packMode, 'manual');
  assert.equal(context.WDub.fromStored(null).rules.packMode, 'auto');
});

test('自动选出的词表会传入当前视频的第一批翻译', async () => {
  const defaults = readFileSync(new URL('../extension/shared/defaults.js', import.meta.url), 'utf8');
  const context = vm.createContext({ setInterval, clearInterval, setTimeout, clearTimeout });
  vm.runInContext(defaults, context);
  context.WDub.Subs = { extractSpeakers() {}, pieceAt: (text) => text };
  context.WDub.SubtitleOverlay = class { applyStyle() {} render() {} };
  vm.runInContext(engineSource, context);
  const calls = [];
  const settings = structuredClone(context.WDub.DEFAULTS);
  settings.translator = 'llm';
  settings.llm.apiKey = 'test';
  const engine = new context.WDub.DubEngine({ currentTime: 0, textTracks: [] }, {
    settings, mode: 'subtitle', rpc: async (type, payload) => {
      calls.push({ type, payload });
      if (type === 'terms.suggest') return { packs: ['ai-modern'], source: 'ai' };
      if (type === 'translate') return { engine: 'llm', items: [{ t: '大语言模型会提供帮助。' }] };
      throw new Error(type);
    }
  });
  engine.setNativeCaptionsHidden = () => {};
  await engine.start([{ start: 0, end: 5, text: 'The large language model helps.' }], { title: 'AI tutorial' });
  clearInterval(engine.loop);
  const translated = calls.find((call) => call.type === 'translate');
  assert.ok(translated);
  assert.deepEqual([...translated.payload.context.packs], ['ai-modern']);
  assert.equal(engine.cues[0].tr, '大语言模型会提供帮助。');
});
