import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const defaultsSource = readFileSync(new URL('../extension/shared/defaults.js', import.meta.url), 'utf8');
const matcherSource = readFileSync(new URL('../extension/shared/term-match.js', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../extension/content/engine.js', import.meta.url), 'utf8');
const backgroundSource = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

function plainContext(extra = {}) {
  const context = vm.createContext({ structuredClone, Date, Math, JSON, console, importScripts() {}, ...extra });
  vm.runInContext(defaultsSource, context);
  vm.runInContext(matcherSource, context);
  return context;
}

const SPEC = { engine: 'llm', from: 'en', to: 'zh-CN', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', domainHint: '', detectSpeakers: false };

test('缓存键区分源语言、目标语言、模型、服务商和接口地址', () => {
  const { WDub } = plainContext();
  const key = (spec) => WDub.translationKeys(spec, ['Hello'])[0];
  const base = key(SPEC);
  assert.equal(key({ ...SPEC }), base, '同样的配置必须命中同一个键');
  assert.notEqual(key({ ...SPEC, from: 'ja' }), base, '换源语言不能复用旧译文');
  assert.notEqual(key({ ...SPEC, to: 'de' }), base, '换目标语言不能复用旧译文');
  assert.notEqual(key({ ...SPEC, model: 'deepseek-pro' }), base, '换模型不能复用旧译文');
  assert.notEqual(key({ ...SPEC, provider: 'openai' }), base, '换服务商不能复用旧译文');
  assert.notEqual(key({ ...SPEC, baseUrl: 'http://127.0.0.1:11434/v1' }), base, '换接口地址不能复用旧译文');
  assert.notEqual(key({ ...SPEC, domainHint: '医学' }), base, '换领域提示不能复用旧译文');
  assert.notEqual(key({ ...SPEC, detectSpeakers: true }), base, '换说话人选项不能复用旧译文');
});

test('Google 与 AI 的结果存在不同键下，不会互相命中', () => {
  const { WDub } = plainContext();
  const ai = WDub.translationKeys(SPEC, ['Hello'])[0];
  const google = WDub.translationKeys({ ...SPEC, engine: 'google' }, ['Hello'])[0];
  assert.notEqual(ai, google);
  assert.equal(WDub.translationKeys({ ...SPEC, engine: 'google' }, ['Hello'])[0], google);
});

test('翻译配置指纹只对影响译文的设置敏感', () => {
  const { WDub } = plainContext();
  const base = WDub.fromStored({});
  const fp = WDub.translationFingerprint;

  const otherLang = { ...base, targetLang: 'ja-JP' };
  assert.notEqual(fp(otherLang), fp(base), '换目标语言要重翻');

  const otherModel = { ...base, llm: { ...base.llm, model: 'another-model' } };
  assert.notEqual(fp(otherModel), fp(base), '换模型要重翻');

  const glossary = { ...base, rules: { ...base.rules, glossary: [{ src: 'bank', dst: '银行', on: true }] } };
  assert.notEqual(fp(glossary), fp(base), '改术语要重翻');

  const styled = { ...base, subtitle: { ...base.subtitle, fontSize: 40, translatedColor: '#FF0000' } };
  assert.equal(fp(styled), fp(base), '只改字幕样式不能触发重翻');

  const voiced = { ...base, tts: { ...base.tts, engine: 'azure' } };
  assert.equal(fp(voiced), fp(base), '只改声音不能触发重翻');
});

function engineHarness({ rpc, settings } = {}) {
  const context = vm.createContext({ structuredClone, Date, Math, JSON, console, setTimeout, clearTimeout });
  vm.runInContext(defaultsSource, context);
  const WDub = context.WDub;
  WDub.SubtitleOverlay = class { applyStyle() {} render() {} destroy() {} };
  const video = {
    paused: true, muted: false, volume: 1, playbackRate: 1, currentTime: 0,
    addEventListener() {}, removeEventListener() {}, pause() {}, play: async () => {}
  };
  const base = WDub.fromStored({});
  const merged = { ...base, ...(settings || {}) };
  merged.rules = { ...base.rules, ...((settings || {}).rules || {}) };
  merged.tts = { ...base.tts, ...((settings || {}).tts || {}) };
  context.video = video;
  context.WDub = WDub;
  vm.runInContext(engineSource, context);
  const engine = new WDub.DubEngine(video, { rpc: rpc || (async () => ({})), settings: merged, onState: () => {} });
  engine.meta = { title: '' };
  return { engine, WDub, video };
}

test('重翻会清掉译文和预合成时长，并推进任务版本', () => {
  const { engine } = engineHarness();
  engine.cues = [{ start: 0, end: 2, text: 'a', tr: '甲', dur: 1.2 }, { start: 2, end: 4, text: 'b', tr: '乙' }];
  engine.running = false;
  const before = engine.taskVersion;
  engine.resetTranslations();
  assert.equal(engine.taskVersion, before + 1);
  assert.equal(engine.cues.every((c) => c.tr === undefined), true, '旧译文必须清掉');
  assert.equal(engine.cues[0].dur, undefined, '依赖旧译文的音频时长必须清掉');
});

test('迟到的旧结果不得回写（换语言后不能覆盖新译文）', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { engine } = engineHarness({
    rpc: async (type) => {
      if (type !== 'translate') return {};
      await gate;
      return { items: [{ t: '旧译文' }], engine: 'llm' };
    }
  });
  engine.cues = [{ start: 0, end: 2, text: 'hello', tr: null }];
  engine.termFp = 'fp';
  const inflight = engine.translateRange(0, 1);
  engine.taskVersion++; // 模拟期间用户换了语言
  release();
  await inflight;
  assert.equal(engine.cues[0].tr, null, '配置已经变了，旧结果不能写回');
});

function backgroundHarness({ settings, fetchImpl }) {
  const writes = [];
  const store = { settings };
  const event = { addListener() {}, removeListener() {} };
  const chrome = {
    runtime: { onConnect: event, onMessage: event, onInstalled: event, getURL: (p) => p, sendMessage: async () => ({}) },
    commands: { onCommand: event },
    offscreen: { hasDocument: async () => true },
    storage: {
      onChanged: event,
      local: {
        async get(key) {
          if (key === null || key === undefined) return { ...store };
          if (key === 'settings') return { settings: store.settings };
          const keys = Array.isArray(key) ? key : [key];
          const out = {};
          for (const k of keys) if (k in store) out[k] = store[k];
          return out;
        },
        async set(obj) { writes.push(obj); Object.assign(store, obj); },
        async remove(key) {
          for (const k of Array.isArray(key) ? key : [key]) delete store[k];
        }
      },
      sync: { async get() { return {}; }, async set() {}, async remove() {} }
    },
    tabs: { query: async () => [], sendMessage: async () => {} }
  };
  const context = vm.createContext({
    structuredClone, Date, Math, JSON, console, importScripts() {},
    chrome, fetch: fetchImpl, URLSearchParams, encodeURIComponent, AbortController, setTimeout, clearTimeout, URL
  });
  vm.runInContext(defaultsSource, context);
  vm.runInContext(matcherSource, context);
  vm.runInContext(backgroundSource, context);
  return { context, writes, store };
}

test('模型漏句时用 Google 补齐，但补译不写进 AI 的缓存键', async () => {
  const settings = {
    sourceLang: 'auto', targetLang: 'zh-CN', translator: 'llm',
    llm: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'k', domainHint: '', detectSpeakers: false },
    rules: { enabled: false, packs: [], packMode: 'auto' }
  };
  const { context, writes } = backgroundHarness({
    settings,
    fetchImpl: async (url) => {
      if (String(url).includes('/chat/completions')) {
        // 两句话只回一句，第二句走补译
        return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '{"items":[{"i":0,"t":"你好"}]}' } }] }) };
      }
      return { ok: true, text: async () => JSON.stringify([[['补译']], null, 'en']) };
    }
  });
  const { WDub } = context;
  const result = await vm.runInContext("translate({ texts: ['Hello', 'World'], from: 'en', to: 'zh-CN', context: {} })", context);
  assert.equal(result.items.length, 2);

  const llmKeys = WDub.translationKeys({ ...settings, engine: 'llm', from: 'en', to: 'zh-CN', provider: settings.llm.provider, baseUrl: settings.llm.baseUrl, model: settings.llm.model, domainHint: '', detectSpeakers: false }, ['Hello', 'World']);
  const googleKey = WDub.translationKeys({ engine: 'google', from: 'en', to: 'zh-CN' }, ['World'])[0];
  const stored = Object.assign({}, ...writes);
  const ns = WDub.CACHE_NAMESPACE;
  assert.ok(stored[ns + llmKeys[0]], '第 1 句应当存在 AI 键下');
  assert.equal(stored[ns + llmKeys[1]], undefined, '补译的句子不能写进 AI 键');
  assert.ok(stored[ns + googleKey], '补译的句子应当存在 Google 键下');
  assert.equal(stored[ns + googleKey].tmp, true, '补译要标记 tmp');
});

test('模型请求卡住时按预算放弃，改走 Google，不会永久占住翻译', async () => {
  const settings = {
    sourceLang: 'auto', targetLang: 'zh-CN', translator: 'llm',
    llm: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'k', domainHint: '', detectSpeakers: false },
    rules: { enabled: false, packs: [], packMode: 'auto' }
  };
  let hung = 0;
  const { context } = backgroundHarness({
    settings,
    fetchImpl: (url, init) => {
      if (String(url).includes('/chat/completions')) {
        hung++;
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }
      return Promise.resolve({ ok: true, text: async () => JSON.stringify([[['备用']], null, 'en']) });
    }
  });
  const started = Date.now();
  const result = await vm.runInContext("translate({ texts: ['Hello'], from: 'en', to: 'zh-CN', context: {}, timeout: 60 })", context);
  const spent = Date.now() - started;
  assert.equal(hung, 1, '只发一次就应当放弃');
  assert.equal(result.engine, 'google', '超时后要退到备用引擎');
  assert.equal(result.items[0].t, '备用');
  assert.ok(spent < 2000, `超时预算没生效，等了 ${spent}ms`);
});

test('本地模型失败时绝不把字幕发到云端', async () => {
  const settings = {
    sourceLang: 'auto', targetLang: 'zh-CN', translator: 'llm',
    llm: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen', apiKey: 'ollama', domainHint: '', detectSpeakers: false },
    rules: { enabled: false, packs: [], packMode: 'auto' }
  };
  const urls = [];
  const { context } = backgroundHarness({
    settings,
    fetchImpl: async (url) => {
      urls.push(String(url));
      throw new TypeError('fetch failed');
    }
  });
  await assert.rejects(
    vm.runInContext("translate({ texts: ['Hello'], from: 'en', to: 'zh-CN', context: {} })", context),
    /不会发送到云端|本地翻译模型/
  );
  assert.equal(urls.every((u) => u.includes('127.0.0.1')), true, `出现了外部请求：${urls.join(', ')}`);
});

test('本地模型漏句时不用 Google 补齐', async () => {
  const settings = {
    sourceLang: 'auto', targetLang: 'zh-CN', translator: 'llm',
    llm: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen', apiKey: 'ollama', domainHint: '', detectSpeakers: false },
    rules: { enabled: false, packs: [], packMode: 'auto' }
  };
  const urls = [];
  const { context } = backgroundHarness({
    settings,
    fetchImpl: async (url) => {
      urls.push(String(url));
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: '{"items":[{"i":0,"t":"你好"}]}' } }] }) };
    }
  });
  const result = await vm.runInContext("translate({ texts: ['Hello', 'World'], from: 'en', to: 'zh-CN', context: {} })", context);
  assert.equal(urls.length, 1, '只应当请求本地模型');
  assert.equal(result.items[0].t, '你好');
  assert.equal(result.items[1].t, '', '漏掉的句子留空，交给界面显示原文');
});

test('用户明确开启云端备用后，本地模型失败才允许改发 Google', async () => {
  const settings = {
    sourceLang: 'auto', targetLang: 'zh-CN', translator: 'llm',
    llm: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen', apiKey: 'ollama', domainHint: '', detectSpeakers: false, allowCloudFallback: true },
    rules: { enabled: false, packs: [], packMode: 'auto' }
  };
  const urls = [];
  const { context } = backgroundHarness({
    settings,
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes('127.0.0.1')) throw new TypeError('fetch failed');
      return { ok: true, text: async () => JSON.stringify([[['云端']], null, 'en']) };
    }
  });
  const result = await vm.runInContext("translate({ texts: ['Hello'], from: 'en', to: 'zh-CN', context: {} })", context);
  assert.equal(result.engine, 'google');
  assert.equal(result.items[0].t, '云端');
  assert.equal(urls.some((u) => u.includes('translate.googleapis.com')), true);
});

test('分类清理只删对应前缀，其余数据保留', async () => {
  const settings = { sourceLang: 'auto', targetLang: 'zh-CN', translator: 'google', llm: {}, rules: { enabled: false } };
  const { context, store } = backgroundHarness({ settings, fetchImpl: async () => ({ ok: true, text: async () => '[]' }) });
  Object.assign(store, {
    'tr:v3:aaa': { t: '旧译文' },
    'asr:bbb': { cues: [] },
    'cuefix:ccc': { s: 1 },
    'spk:ddd': { speakers: [] },
    'study:history': [{ id: 1 }]
  });
  const onlyCache = await vm.runInContext('handlers["cache.clear"]({ prefixes: ["tr:"] })', context);
  assert.equal(onlyCache.removed, 1);
  assert.equal(store['tr:v3:aaa'], undefined, '翻译缓存应当删除');
  assert.ok(store['asr:bbb'] && store['cuefix:ccc'] && store['spk:ddd'] && store['study:history'], '其它类别不能误删');

  const people = await vm.runInContext('handlers["cache.clear"]({ prefixes: ["cuefix:", "spk:"] })', context);
  assert.equal(people.removed, 2);
  assert.equal(store['cuefix:ccc'], undefined);
  assert.equal(store['spk:ddd'], undefined);
  assert.ok(store['study:history'], '纪要不能被人物清理带走');

  const everything = await vm.runInContext('handlers["cache.clear"]({ all: true })', context);
  assert.ok(everything.removed >= 1);
  assert.equal(store['study:history'], undefined);
});

test('后台批次失败后持续退避重试，不会一次失败就永久停摆', async () => {
  let attempts = 0;
  const { engine } = engineHarness({
    rpc: async (type) => {
      if (type !== 'translate') return {};
      attempts++;
      if (attempts <= 5) throw new Error('网络抖动');
      return { items: [{ t: '终于好了' }], engine: 'llm' };
    }
  });
  engine.retryBase = 1; // 测试里把退避压到毫秒级
  engine.cues = [{ start: 0, end: 2, text: 'hello', tr: null }];
  engine.running = true;
  engine.termFp = 'fp';
  await engine.translateRest(1);
  assert.ok(attempts >= 6, `应当重试到成功，实际 ${attempts} 次`);
  assert.equal(engine.cues[0].tr, '终于好了', '重试成功后必须真的写回译文');
});
