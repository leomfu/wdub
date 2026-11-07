import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const defaults = readFileSync(new URL('../extension/shared/defaults.js', import.meta.url), 'utf8');
const background = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../extension/content/engine.js', import.meta.url), 'utf8');

test('缺少 Azure 或 ElevenLabs key 时仍保持所选引擎，不会暗中选系统声音', () => {
  const context = vm.createContext({ structuredClone });
  vm.runInContext(defaults, context);
  for (const provider of ['azure', 'elevenlabs']) {
    const settings = context.WDub.fromStored({ tts: { engine: provider } });
    assert.equal(context.WDub.missingKey(settings, 'tts'), provider);
    assert.equal(context.WDub.ttsEngine(settings), provider);
  }
});

test('Azure 和 ElevenLabs 合成失败时不得调用系统朗读', async () => {
  for (const provider of ['azure', 'elevenlabs']) {
    let systemCalls = 0;
    const settings = {
      targetLang: 'zh-CN', rules: { enabled: false },
      tts: { engine: provider, [provider]: { key: 'test', apiKey: 'test', region: 'eastasia', model: 'eleven_flash_v2_5' } }
    };
    const event = { addListener() {} };
    const context = vm.createContext({
      WDub: { getSettings: async () => settings, ttsEngine: (s) => s.tts.engine, onSettingsChanged() {} },
      chrome: { runtime: { onConnect: event, onMessage: event, onInstalled: event,
        sendMessage: async () => { throw new Error('合成服务暂时不可用'); } },
      commands: { onCommand: event }, storage: { sync: null }, offscreen: { hasDocument: async () => true },
      tts: { speak() { systemCalls++; } } },
      setTimeout, clearTimeout, URL
    });
    vm.runInContext(background, context);
    await assert.rejects(vm.runInContext("ttsPlay(null, {key:'first',text:'你好',voice:'chosen',rate:1,volume:1})", context), /配音未能开始/);
    assert.equal(systemCalls, 0, `${provider} 失败后不能发出系统语音`);
  }
});

test('Azure 和 ElevenLabs 首句直接交给各自的音频引擎', async () => {
  for (const provider of ['azure', 'elevenlabs']) {
    const sent = [];
    let systemCalls = 0;
    const settings = { targetLang: 'zh-CN', rules: { enabled: false },
      tts: { engine: provider, [provider]: { key: 'test', apiKey: 'test', region: 'eastasia', model: 'eleven_flash_v2_5' } } };
    const event = { addListener() {} };
    const context = vm.createContext({
      WDub: { getSettings: async () => settings, ttsEngine: (s) => s.tts.engine, onSettingsChanged() {} },
      chrome: { runtime: { onConnect: event, onMessage: event, onInstalled: event,
        sendMessage: async (message) => { sent.push(message); return { started: true }; } },
      commands: { onCommand: event }, storage: { sync: null }, offscreen: { hasDocument: async () => true },
      tts: { speak() { systemCalls++; } } },
      setTimeout, clearTimeout, URL
    });
    vm.runInContext(background, context);
    const result = await vm.runInContext("ttsPlay(null, {key:'first',text:'你好',voice:'chosen',rate:1,volume:1})", context);
    assert.equal(result.started, true);
    assert.equal(sent.find((message) => message.type === 'play')?.engine, provider);
    assert.equal(systemCalls, 0);
  }
});

test('开头并发预合成只创建一次隐藏音频页', async () => {
  let createCalls = 0;
  let finishCreate;
  const event = { addListener() {} };
  const context = vm.createContext({
    WDub: { onSettingsChanged() {}, getSettings: async () => ({ local: { ollama: '' } }) },
    chrome: { runtime: { onConnect: event, onMessage: event, onInstalled: event },
      commands: { onCommand: event }, storage: { sync: null, local: { get: async () => ({}) } },
      offscreen: { hasDocument: async () => false, createDocument: () => {
        createCalls++;
        return new Promise((resolve) => { finishCreate = resolve; });
      } } },
    setTimeout, clearTimeout, URL
  });
  vm.runInContext(background, context);
  const pending = vm.runInContext('Promise.all([ensureOffscreen(), ensureOffscreen(), ensureOffscreen()])', context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(createCalls, 1);
  finishCreate();
  await pending;
});

test('播放中切到 Azure 时停掉系统声音，并用 Azure 重念当前句', async () => {
  const document = { documentElement: { classList: { toggle() {} } } };
  const context = vm.createContext({ structuredClone, document, location: { protocol: 'https:' },
    setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(defaults, context);
  const { WDub } = context;
  WDub.SubtitleOverlay = class { applyStyle() {} render() {} };
  vm.runInContext(engineSource, context);
  const calls = [];
  const video = { currentTime: 1.5, playbackRate: 1, volume: 1, muted: false, paused: false, textTracks: [],
    pause() { this.paused = true; }, async play() { this.paused = false; } };
  const before = WDub.fromStored({ tts: { engine: 'system' } });
  const after = WDub.fromStored({ tts: { engine: 'azure' }, keys: { azure: { key: 'test-key' } } });
  const engine = new WDub.DubEngine(video, { settings: before, rpc: async (type, payload) => {
    calls.push({ type, payload });
    if (type === 'tts.play') return { started: true };
    return {};
  } });
  engine.running = true;
  engine.baseRate = 1;
  engine.baseVolume = 1;
  engine.cues = [{ start: 0, end: 5, text: 'Hello', tr: '你好，这是完整的一句。' }];
  engine.speaking = { key: 'old-system', voice: '', cueIndex: 0 };
  engine.updateSettings(after);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stop = calls.findIndex((call) => call.type === 'tts.stop');
  const play = calls.findIndex((call) => call.type === 'tts.play');
  assert(stop >= 0 && play > stop, '必须先停旧声音再开始新声音');
  assert.equal(calls[play].payload.voice, after.cast.azure.narrator);
  assert.equal(video.paused, false, '新声音就绪后画面应继续');
});

test('所选云端配音失败时停在当前画面并显示错误', async () => {
  const document = { documentElement: { classList: { toggle() {} } } };
  const context = vm.createContext({ structuredClone, document, location: { protocol: 'https:' },
    setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(defaults, context);
  const { WDub } = context;
  WDub.SubtitleOverlay = class { applyStyle() {} render() {} destroy() {} };
  vm.runInContext(engineSource, context);
  const video = { currentTime: 0.1, playbackRate: 1, volume: 1, muted: false, paused: false, textTracks: [],
    removeEventListener() {},
    pause() { this.paused = true; }, async play() { this.paused = false; this.plays = (this.plays || 0) + 1; } };
  const states = [];
  const settings = WDub.fromStored({ tts: { engine: 'azure' }, keys: { azure: { key: 'test-key' } } });
  const engine = new WDub.DubEngine(video, { settings, onState: (state) => states.push(state),
    rpc: async (type) => {
      if (type === 'tts.play') throw new Error('Azure 语音失败（429）');
      return {};
    } });
  engine.running = true;
  engine.baseRate = 1;
  engine.baseVolume = 1;
  engine.cues = [{ start: 0, end: 4, text: 'Hello', tr: '你好。' }];
  await engine.speak(0);
  assert.equal(video.paused, true);
  assert.equal(video.plays || 0, 0, '失败时不能恢复原声画面继续跑');
  assert(states.some((state) => state.phase === 'error' && state.message.includes('429')));
});

test('视频开播时先等待翻译和首句 Azure 音频，音频开始后才恢复画面', async () => {
  const document = { documentElement: { classList: { toggle() {} } } };
  const context = vm.createContext({ structuredClone, document, location: { protocol: 'https:' },
    setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(defaults, context);
  const { WDub } = context;
  WDub.Subs = { extractSpeakers() {} };
  WDub.SubtitleOverlay = class { applyStyle() {} render() {} destroy() {} };
  vm.runInContext(engineSource, context);
  let finishTerms, finishTranslation, finishVoice;
  const terms = new Promise((resolve) => { finishTerms = resolve; });
  const translation = new Promise((resolve) => { finishTranslation = resolve; });
  const voice = new Promise((resolve) => { finishVoice = resolve; });
  const calls = [];
  const video = { currentTime: 0.1, playbackRate: 1, volume: 1, muted: false, paused: false, textTracks: [],
    addEventListener() {}, removeEventListener() {},
    pause() { this.paused = true; }, async play() { this.paused = false; this.plays = (this.plays || 0) + 1; } };
  const settings = WDub.fromStored({ tts: { engine: 'azure' }, keys: { azure: { key: 'test-key' } } });
  const engine = new WDub.DubEngine(video, { settings, rpc: async (type) => {
    calls.push(type);
    if (type === 'tts.play') { await voice; return { started: true }; }
    return {};
  } });
  engine.selectTermPacks = () => terms;
  engine.translateAround = async () => { await translation; engine.cues[0].tr = '你好。'; };
  engine.translateRest = () => {};
  engine.prefetch = () => {};
  const starting = engine.start([{ start: 0, end: 4, text: 'Hello' }]);
  assert.equal(video.paused, true, '获取字幕后的主题判断期间不能继续播放原声');
  finishTerms();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(video.paused, true, '翻译期间仍须等待');
  finishTranslation();
  await starting;
  assert(calls.includes('tts.play'));
  assert.equal(video.paused, true, '云端音频尚未开始时不能恢复画面');
  finishVoice();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(video.paused, false);
  assert.equal(video.plays, 1);
  engine.stop(false);
});
