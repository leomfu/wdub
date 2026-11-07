import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../extension/shared/study.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const { Study } = context.WDub;

test('纪要自动选择可用模型，手动模型不会改字幕翻译设置', () => {
  const settings = {
    llm: { provider: 'deepseek', model: 'deepseek-chat', custom: {} },
    keys: { deepseek: 'test-key', gemini: '', openai: '' },
    local: { ollama: 'http://localhost:11434/v1' },
    study: { provider: 'auto', models: { deepseek: 'deepseek-v4-flash', gemini: 'gemini-3.8-flash', codex: '' },
      custom: {}, codex: { baseUrl: 'http://127.0.0.1:8198/v1', token: '' } }
  };
  const auto = Study.resolve(settings);
  assert.equal(auto.provider, 'deepseek');
  assert.equal(auto.model, 'deepseek-v4-flash');
  settings.study.provider = 'gemini';
  assert.match(Study.resolve(settings).error, /API key/);
  settings.keys.gemini = 'gemini-key';
  assert.equal(Study.resolve(settings).model, 'gemini-3.8-flash');
  assert.equal(settings.llm.model, 'deepseek-chat');
});

test('长视频分段整理时保留每一句字幕和原来的时间顺序', () => {
  const cues = Array.from({ length: 120 }, (_, i) => ({ start: i * 8, end: i * 8 + 7, text: `第 ${i + 1} 句 ${'学习内容'.repeat(18)}` }));
  const chunks = Study.chunks(cues, 750);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join('\n').split('\n').length, cues.length);
  assert.match(chunks[0], /^\[0:00\] 第 1 句/);
  assert.match(chunks.at(-1), /第 120 句/);
});

test('学习纪要仅保留视频范围内的时间跳转', () => {
  const data = Study.normalize({
    kind: 'learning', oneLine: '一段完整的课程',
    chapters: [{ title: '开场', at: '1:25' }, { title: '不存在的片段', at: '99:00' }],
    keyPoints: [{ text: '结论', at: -4 }, { text: '定义', at: 120 }],
    questions: [{ q: '为什么？', a: '因为示例。', at: '2:00' }]
  }, 180);
  assert.equal(data.chapters[0].at, 85);
  assert.equal(data.chapters[1].at, null);
  assert.equal(data.keyPoints[0].at, null);
  assert.equal(data.keyPoints[1].at, 120);
  assert.equal(data.questions[0].at, 120);
});
