import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const offscreenSource = readFileSync(new URL('../extension/offscreen/offscreen.js', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../extension/content/engine.js', import.meta.url), 'utf8');
const defaultsSource = readFileSync(new URL('../extension/shared/defaults.js', import.meta.url), 'utf8');
const subtitlesSource = readFileSync(new URL('../extension/shared/subtitles.js', import.meta.url), 'utf8');

test('旧字幕设置补齐边缘颜色，预设和自定义颜色能正确区分', () => {
  const context = vm.createContext({ structuredClone });
  vm.runInContext(defaultsSource, context);
  const { WDub } = context;
  const old = WDub.fromStored({ subtitle: { fontSize: 32, translatedColor: '#FFFFFF' } });
  assert.equal(old.subtitle.fontSize, 32);
  assert.equal(old.subtitle.edgeColor, '#000000');
  assert.equal(WDub.subtitlePresetId(old.subtitle), 'clear');
  old.subtitle.translatedColor = '#22AA66';
  assert.equal(WDub.subtitlePresetId(old.subtitle), '');
  Object.assign(old.subtitle, WDub.SUBTITLE_PRESETS.find((item) => item.id === 'ink').style);
  assert.equal(WDub.subtitlePresetId(old.subtitle), 'ink');
});

test('识别字幕在一句话未完时保留后半句，供翻译和配音一起使用', () => {
  const context = vm.createContext({});
  vm.runInContext(subtitlesSource, context);
  const words = [
    { w: 'If', start: 0, end: 1 }, { w: 'you', start: 1, end: 2 },
    { w: 'look', start: 2, end: 3 }, { w: 'at', start: 3, end: 4 },
    { w: 'the', start: 4, end: 5 }, { w: 'result,', start: 5, end: 6 },
    { w: 'you', start: 6, end: 7 }, { w: 'will', start: 7, end: 8 },
    { w: 'understand', start: 8, end: 9 }, { w: 'why.', start: 9, end: 10 }
  ];
  const cues = context.WDub.Subs.wordsToSentences(words);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'If you look at the result, you will understand why.');
  const fragments = context.WDub.Subs.mergeFragments([
    { start: 0, end: 5, text: 'If you look at the result,' },
    { start: 5.4, end: 11, text: 'you will understand why.' }
  ]);
  assert.equal(fragments.length, 1, '人工字幕的未完句也要合并');
});

test('画面显示的中文整句与配音使用的文字一致', () => {
  const rendered = [];
  const WDub = { Subs: { pieceAt: () => '被截断的半句' },
    SubtitleOverlay: class { applyStyle() {} render(view) { rendered.push(view); } } };
  const context = vm.createContext({ WDub, setInterval, clearInterval, setTimeout, clearTimeout });
  vm.runInContext(engineSource, context);
  const text = 'If you look at the result, you will understand why.';
  const tr = '如果你看一下结果，就会明白原因。';
  const engine = new WDub.DubEngine({ currentTime: 9 }, { rpc: async () => {}, settings: { subtitle: { mode: 'bilingual' } } });
  engine.cues = [{ start: 0, end: 10, text, tr }];
  engine.renderAt(9);
  assert.equal(rendered.at(-1)?.text, text);
  assert.equal(rendered.at(-1)?.tr, tr);
});

test('隐藏音频页只有 runtime API 时，共用配置脚本不应访问缺失的 storage API', () => {
  const context = vm.createContext({
    chrome: { runtime: {} },
    document: { documentElement: {} },
    location: { protocol: 'chrome-extension:' }
  });
  assert.doesNotThrow(() => vm.runInContext(defaultsSource, context));
});

test('视频在 API 合成期间暂停，合成结束不能擅自播放；恢复后才继续', async () => {
  let finishFetch;
  const played = [];
  let receive;
  class FakeAudio {
    constructor(src) { this.src = src; }
    set src(value) { this._src = value; queueMicrotask(() => this.onloadedmetadata?.()); }
    get src() { return this._src; }
    get duration() { return 4; }
    async play() { this.paused = false; played.push(this); }
    pause() { this.paused = true; }
  }
  class FakeURL extends URL {
    static createObjectURL() { return 'blob:api-voice'; }
    static revokeObjectURL() {}
  }
  const context = vm.createContext({
    Audio: FakeAudio, Blob, Uint8Array, URL: FakeURL,
    fetch: () => new Promise((resolve) => { finishFetch = resolve; }),
    queueMicrotask, setInterval, clearInterval,
    WDub: { ASR: {}, isPrivateHost: () => false },
    chrome: { runtime: { sendMessage: async () => {}, onMessage: { addListener(fn) { receive = fn; } } } }
  });
  vm.runInContext(offscreenSource, context);
  const msg = { key: 'cue-1', engine: 'custom', text: '你好', voice: 'test', rate: 1, volume: 1,
    conf: { baseUrl: 'http://localhost/v1', model: 'test', apiKey: '' } };
  context.msg = msg;
  const pending = vm.runInContext('play(msg)', context);
  await new Promise((resolve) => receive({ target: 'offscreen', type: 'pause' }, null, resolve));
  finishFetch({ ok: true, blob: async () => new Blob([new Uint8Array([1])]) });
  await pending;
  assert.equal(played.length, 0, '视频暂停期间，API 返回后语音不应开始播放');
  await new Promise((resolve) => receive({ target: 'offscreen', type: 'resume' }, null, resolve));
  assert.equal(played.length, 1, '视频恢复后，配音应接着播放');
});

test('API 音频已开始后暂停和恢复时保留同一音频的播放进度', async () => {
  const audios = [];
  let receive;
  class FakeAudio {
    constructor(src) { this.src = src; this.currentTime = 0; audios.push(this); }
    set src(value) { this._src = value; queueMicrotask(() => this.onloadedmetadata?.()); }
    get src() { return this._src; }
    get duration() { return 6; }
    async play() { this.paused = false; this.plays = (this.plays || 0) + 1; }
    pause() { this.paused = true; }
  }
  class FakeURL extends URL {
    static createObjectURL() { return 'blob:api-voice'; }
    static revokeObjectURL() {}
  }
  const context = vm.createContext({ Audio: FakeAudio, Blob, Uint8Array, URL: FakeURL,
    fetch: async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1])]) }),
    queueMicrotask, setInterval, clearInterval,
    WDub: { ASR: {}, isPrivateHost: () => false },
    chrome: { runtime: { sendMessage: async () => {}, onMessage: { addListener(fn) { receive = fn; } } } }
  });
  vm.runInContext(offscreenSource, context);
  context.msg = { key: 'cue-2', engine: 'custom', text: '继续', voice: 'test', rate: 1, volume: 1,
    conf: { baseUrl: 'http://localhost/v1', model: 'test', apiKey: '' } };
  await vm.runInContext('play(msg)', context);
  const speaking = audios.at(-1);
  speaking.currentTime = 2.3;
  await new Promise((resolve) => receive({ target: 'offscreen', type: 'pause' }, null, resolve));
  assert.equal(speaking.paused, true);
  await new Promise((resolve) => receive({ target: 'offscreen', type: 'resume' }, null, resolve));
  assert.equal(speaking.paused, false);
  assert.equal(speaking.currentTime, 2.3, '恢复后必须从原进度继续，不能重新念句首');
  assert.equal(speaking.plays, 2);
  assert.equal(audios.filter((a) => a.plays).length, 1, '不能新建第二个正在播放的音频');
});

test('中文配音长于英文句段时，画面时长应覆盖实际中文朗读时长', async () => {
  const calls = [];
  const WDub = {
    ttsEngine: () => 'custom',
    Subs: { pieceAt: (text) => text },
    SubtitleOverlay: class { applyStyle() {} render() {} }
  };
  const context = vm.createContext({ WDub, setInterval, clearInterval, setTimeout, clearTimeout });
  vm.runInContext(engineSource, context);
  const video = { currentTime: 0.05, paused: false, seeking: false, playbackRate: 1, volume: 1, textTracks: [],
    pause() { this.paused = true; }, async play() { this.paused = false; } };
  const settings = { subtitle: { mode: 'bilingual' }, audio: { dubVolume: 1, originalMode: 'duck', originalVolume: 0.1,
    idleVolume: 1, smartDuck: true, slowVideoWhenLagging: true, minVideoRate: 0.5 }, tts: { maxSpeed: 1.3 } };
  const engine = new WDub.DubEngine(video, { rpc: async (type, payload) => { calls.push({ type, payload }); return { started: true }; }, settings });
  engine.running = true;
  engine.baseRate = 1;
  engine.baseVolume = 1;
  engine.keyFor = () => ({ key: 'cue-1', voice: 'test' });
  engine.prefetch = () => {};
  engine.cues = [
    { start: 0, end: 2, text: 'Hello there', tr: '你好，这是一段明显更长的中文配音', dur: 4 },
    { start: 2, end: 4, text: 'Next', tr: '下一句' }
  ];
  engine.tick();
  await Promise.resolve();
  const play = calls.find((c) => c.type === 'tts.play');
  assert.ok(play, '应该调用实际配音接口');
  const originalSlot = 2 - video.currentTime;
  const voiceSeconds = engine.cues[0].dur / play.payload.rate;
  const pictureSeconds = originalSlot / video.playbackRate;
  assert.ok(pictureSeconds >= voiceSeconds - 0.1,
    `中文需要 ${voiceSeconds.toFixed(2)} 秒，画面只留了 ${pictureSeconds.toFixed(2)} 秒`);
});

test('API 预合成未完成时画面等待，配音就绪后画面与人声一起恢复', async () => {
  let finishPrepare;
  const calls = [];
  const WDub = {
    ttsEngine: () => 'custom',
    Subs: { pieceAt: (text) => text },
    SubtitleOverlay: class { applyStyle() {} render() {} }
  };
  const context = vm.createContext({ WDub, setInterval, clearInterval, setTimeout, clearTimeout });
  vm.runInContext(engineSource, context);
  const video = {
    currentTime: 0.1, paused: false, seeking: false, playbackRate: 1, volume: 1, textTracks: [],
    pause() { this.paused = true; },
    async play() { this.paused = false; }
  };
  const settings = { subtitle: { mode: 'bilingual' }, audio: { dubVolume: 1, originalMode: 'duck', originalVolume: 0.1,
    idleVolume: 1, smartDuck: true, slowVideoWhenLagging: true, minVideoRate: 0.5 }, tts: { maxSpeed: 1.3 } };
  const engine = new WDub.DubEngine(video, { rpc: async (type, payload) => { calls.push({ type, payload }); return { started: true, paused: type === 'tts.play' }; }, settings });
  engine.running = true;
  engine.baseRate = 1;
  engine.baseVolume = 1;
  engine.keyFor = () => ({ key: 'cue-1', voice: 'test' });
  engine.cues = [{ start: 0, end: 2, text: 'Hello', tr: '你好', dur: 3 }];
  const prep = new Promise((resolve) => { finishPrepare = resolve; });
  engine.prepared.set('cue-1', prep);
  const speaking = engine.speak(0);
  assert.equal(video.paused, true, 'API 尚未准备好时画面不能继续跑在配音前面');
  finishPrepare({ duration: 3 });
  await speaking;
  assert.equal(video.paused, false, 'API 开始配音后应自动恢复画面');
  assert.ok(calls.some((c) => c.type === 'tts.play'));
  assert.ok(calls.some((c) => c.type === 'tts.resume'), '若新配音继承了暂停状态，画面恢复后必须让它继续');
});

test('人声尚未结束时不进入下一说话人的画面和字幕', async () => {
  const calls = [];
  const rendered = [];
  const WDub = {
    ttsEngine: () => 'custom',
    Subs: { pieceAt: (text) => text },
    SubtitleOverlay: class { applyStyle() {} render(view) { rendered.push(view); } }
  };
  const context = vm.createContext({ WDub, setInterval, clearInterval, setTimeout, clearTimeout });
  vm.runInContext(engineSource, context);
  const video = {
    currentTime: 1.95, paused: false, seeking: false, playbackRate: 0.25, volume: 1, textTracks: [],
    pause() { this.paused = true; }, async play() { this.paused = false; }
  };
  const settings = { subtitle: { mode: 'bilingual' }, audio: { dubVolume: 1, originalMode: 'duck', originalVolume: 0.1,
    idleVolume: 1, smartDuck: true, slowVideoWhenLagging: true, minVideoRate: 0.5 }, tts: { maxSpeed: 1.3 } };
  const engine = new WDub.DubEngine(video, { rpc: async (type) => { calls.push(type); }, settings });
  engine.running = true;
  engine.baseRate = 1;
  engine.speaking = { key: 'first', cueIndex: 0 };
  engine.cues = [
    { start: 0, end: 2, text: 'First speaker', tr: '第一位说话人' },
    { start: 2, end: 4, text: 'Second speaker', tr: '第二位说话人' }
  ];
  engine.tick();
  assert.equal(video.paused, true, '旧句未说完时应在下一句边界暂停画面');
  engine.onVideoEvent({ type: 'pause' });
  assert.ok(!calls.includes('tts.pause'), '画面为等待人声而暂停时，配音应继续');
  video.currentTime = 2;
  engine.renderAt(2);
  assert.equal(rendered.at(-1).tr, '第一位说话人', '旧人声期间不能显示下一位说话人的字幕');
  engine.onAudioEnded('first');
  await Promise.resolve();
  assert.equal(video.paused, false, '旧句说完后画面应恢复');
  engine.renderAt(2);
  assert.equal(rendered.at(-1).tr, '第二位说话人', '新句开始时字幕应切换');
});

test('手动暂停和恢复时配音执行对应操作', async () => {
  const calls = [];
  const WDub = { ttsEngine: () => 'custom', Subs: { pieceAt: (text) => text },
    SubtitleOverlay: class { applyStyle() {} render() {} } };
  const context = vm.createContext({ WDub, setInterval, clearInterval, setTimeout, clearTimeout });
  vm.runInContext(engineSource, context);
  const engine = new WDub.DubEngine({ currentTime: 1, paused: true, volume: 1, textTracks: [] }, {
    rpc: async (type) => { calls.push(type); }, settings: { subtitle: {} }
  });
  engine.onVideoEvent({ type: 'pause' });
  engine.onVideoEvent({ type: 'play' });
  assert.deepEqual(calls, ['tts.pause', 'tts.resume']);
});

test('等待 API 配音时拖动进度条不会把视频留在暂停状态', async () => {
  const calls = [];
  const WDub = { ttsEngine: () => 'custom', Subs: { pieceAt: (text) => text },
    SubtitleOverlay: class { applyStyle() {} render() {} } };
  const context = vm.createContext({ WDub, setInterval, clearInterval, setTimeout, clearTimeout });
  vm.runInContext(engineSource, context);
  const video = { currentTime: 3, paused: false, playbackRate: 1, volume: 1, textTracks: [],
    pause() { this.paused = true; }, async play() { this.paused = false; } };
  const engine = new WDub.DubEngine(video, {
    rpc: async (type) => { calls.push(type); },
    settings: { subtitle: {}, audio: { originalMode: 'duck', originalVolume: 0.1, smartDuck: false } }
  });
  engine.baseRate = 1;
  engine.baseVolume = 1;
  engine.running = true;
  engine.cues = [{ start: 0, end: 5, text: 'Hello', tr: '你好' }];
  engine.translateAround = async () => {};
  engine.prefetch = () => {};
  engine.speak = () => { calls.push('speak'); };
  engine.holdVideoForVoice('first');
  assert.equal(video.paused, true);
  engine.onVideoEvent({ type: 'seeking' });
  engine.tick();
  assert.equal(video.paused, true, '进度条仍在拖动时不能自动恢复画面');
  assert.ok(!calls.includes('speak'), '拖动期间不能重新启动配音');
  video.currentTime = 0.2;
  engine.onVideoEvent({ type: 'seeked' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await Promise.resolve();
  assert.equal(video.paused, false, '拖动后画面应该恢复播放');
  assert.ok(calls.includes('tts.stop'), '旧位置的配音应该停止');
  engine.tick();
  assert.ok(calls.includes('speak'), '回拖后应重新播放目标句');
});
