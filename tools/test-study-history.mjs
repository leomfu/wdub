import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const background = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const study = readFileSync(new URL('../extension/shared/study.js', import.meta.url), 'utf8');

test('纪要生成后进入历史；重开读缓存，重新整理保留两个版本', async () => {
  const data = new Map();
  let calls = 0;
  let sequence = 0;
  const settings = {
    targetLang: 'zh-CN',
    llm: { provider: 'deepseek', model: 'deepseek-chat', custom: {} },
    study: { provider: 'deepseek', models: { deepseek: 'deepseek-v4-flash' }, custom: {}, codex: {} },
    keys: { deepseek: 'test-key' }, local: { ollama: 'http://localhost:11434/v1' }
  };
  const event = { addListener() {} };
  const context = vm.createContext({
    WDub: { getSettings: async () => settings, onSettingsChanged() {}, hash: (text) => String(text.length), isMtModel: () => false },
    AbortController, URL,
    chrome: { runtime: { onConnect: event, onMessage: event, onInstalled: event }, commands: { onCommand: event },
      storage: { sync: null, local: {
        get: async (key) => Object.fromEntries((Array.isArray(key) ? key : [key]).map((k) => [k, data.get(k)])),
        set: async (values) => { for (const [key, value] of Object.entries(values)) data.set(key, value); }
      } } },
    fetch: async () => {
      calls++;
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        kind: 'learning', oneLine: '模型解释了产品验证。', keyPoints: [{ text: '先验证需求', at: 5 }],
        chapters: [], concepts: [], questions: [], decisions: [], actions: []
      }) } }] }) };
    },
    crypto: { randomUUID: () => `id-${++sequence}` }, URL, setTimeout, clearTimeout
  });
  vm.runInContext(study, context);
  vm.runInContext(background, context);
  const payload = { cues: [{ start: 0, end: 20, text: 'First, validate demand.' }],
    title: '学习视频', url: 'yt:example', sourceUrl: 'https://www.youtube.com/watch?v=example' };
  context.payload = payload;
  const first = await vm.runInContext('summarize(payload)', context);
  const again = await vm.runInContext('summarize(payload)', context);
  const renewed = await vm.runInContext('summarize({ ...payload, force: true })', context);
  assert.equal(calls, 2);
  assert.equal(again.cached, true);
  assert.notEqual(first.id, renewed.id);
  assert.equal(data.get('study:history').length, 2);
  assert.equal(data.get(`study:record:${first.id}`).data.oneLine, '模型解释了产品验证。');
});
