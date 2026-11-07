import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const defaults = readFileSync(new URL('../extension/shared/defaults.js', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../extension/content/engine.js', import.meta.url), 'utf8');

// 最小可用的引擎环境：只要不碰 DOM 的方法都能直接测
function makeEngine({ cues, settings = {}, rpc = async () => ({}) } = {}) {
  const context = vm.createContext({ structuredClone, Date, Math, JSON, console, setTimeout, clearTimeout });
  vm.runInContext(defaults, context);
  const WDub = context.WDub;
  WDub.SubtitleOverlay = class {
    constructor() {}
    applyStyle() {}
    render() {}
    destroy() {}
  };
  WDub.Subs = WDub.Subs || { extractSpeakers() {} };
  const video = {
    paused: true, muted: false, volume: 1, playbackRate: 1, currentTime: 0,
    addEventListener() {}, removeEventListener() {}, pause() {}, play: async () => {}
  };
  const base = WDub.fromStored({});
  const merged = { ...base, ...settings };
  merged.subtitle = base.subtitle;
  merged.cast = base.cast;
  merged.audio = base.audio;
  merged.rules = { ...base.rules, ...(settings.rules || {}) };
  merged.tts = { ...base.tts, ...(settings.tts || {}) };
  context.video = video;
  context.rpc = rpc;
  context.WDub = WDub;
  vm.runInContext(engineSource, context);
  const engine = new WDub.DubEngine(video, {
    rpc, settings: merged, onState: () => {}
  });
  engine.cues = cues;
  engine.meta = { title: '' };
  engine.running = true;
  return { engine, context };
}

test('译文还没到时不写 lastSpoken，只补请求这一句', async () => {
  const calls = [];
  const cues = [{ start: 0, end: 4, text: 'hello', tr: null }, { start: 4, end: 8, text: 'world', tr: null }];
  const { engine } = makeEngine({
    cues,
    rpc: async (type, payload) => { calls.push({ type, payload }); return { items: [{ t: '译文' }], engine: 'llm' }; }
  });
  await engine.speak(0);
  assert.equal(engine.lastSpoken, -1, '没有译文时不能标记已播放');
  assert.equal(calls.filter((c) => c.type === 'translate').length, 1, '应当为当前句单独补请求');
  assert.equal(calls.find((c) => c.type === 'translate').payload.texts.join('|'), 'hello');
});

test('同一句等待期间的重复 tick 不会每 100ms 打一次接口', async () => {
  const calls = [];
  const cues = [{ start: 0, end: 4, text: 'hello', tr: null }];
  const { engine } = makeEngine({
    cues,
    rpc: async (type) => { calls.push(type); return { items: [{ t: '译文' }], engine: 'llm' }; }
  });
  engine.txBusy.add(0); // 模拟上一次请求还在飞
  for (let i = 0; i < 10; i++) await engine.speak(0);
  assert.equal(calls.filter((t) => t === 'translate').length, 0, '请求未返回时不能重复发');
});

test('反复拿不到译文时有限放弃，不无限重试也不谎报已播放', async () => {
  const calls = [];
  const cues = [{ start: 0, end: 4, text: 'hello', tr: null }];
  const { engine } = makeEngine({
    cues,
    rpc: async (type) => {
      calls.push(type);
      if (type === 'translate') throw new Error('服务不可用');
      return {};
    }
  });
  for (let i = 0; i < 12; i++) {
    engine.cueWait = engine.cueWait && { ...engine.cueWait, nextAt: 0 };
    await engine.speak(0);
  }
  assert.ok(calls.filter((t) => t === 'translate').length <= 4, `补请求次数应有上限，实际 ${calls.length}`);
  assert.equal(engine.failedCues.has(0), true, '放弃后要记录下来');
  await engine.speak(0);
  assert.equal(engine.lastSpoken, 0, '放弃后推进游标，避免每个 tick 重来');
});

test('有译文时正常进入配音流程', async () => {
  const calls = [];
  const cues = [{ start: 0, end: 4, text: 'hello', tr: '你好' }];
  const { engine } = makeEngine({
    cues,
    rpc: async (type) => { calls.push(type); return { started: true }; }
  });
  await engine.speak(0);
  assert.equal(engine.lastSpoken, 0);
  assert.ok(calls.includes('tts.play'), '有译文时必须真的去播');
});

test('主题词表先用本地关键词定版，不等 AI 判断', async () => {
  let resolveSuggest;
  const pending = new Promise((r) => (resolveSuggest = r));
  const { engine } = makeEngine({
    cues: [{ start: 0, end: 1, text: 'neural network', tr: null }],
    rpc: async (type) => (type === 'terms.suggest' ? pending : {})
  });
  engine.meta = { title: '神经网络入门' };
  engine.s = { ...engine.s, rules: { enabled: true, packMode: 'auto' } };
  engine.primeTermPacks();
  assert.equal(engine.termSource, 'keywords', '本地关键词应当立刻可用');
  const req = engine.refineTermPacks();
  assert.equal(engine.termSource, 'keywords', 'AI 还没回来时不能阻塞');
  resolveSuggest({ packs: [], source: 'ai' });
  await req;
  assert.equal(engine.termSource, 'keywords', 'AI 结果与本地一致时不改状态');
});
