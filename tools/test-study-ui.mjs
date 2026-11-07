// Run against a separate headless Chrome with --remote-debugging-port=9229.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const targets = await fetch('http://127.0.0.1:9229/json/list').then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
assert(page, 'Chrome page not found');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((yes, no) => { ws.addEventListener('open', yes, { once: true }); ws.addEventListener('error', no, { once: true }); });
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (!pending.has(msg.id)) return;
  const { yes, no } = pending.get(msg.id);
  pending.delete(msg.id);
  msg.error ? no(new Error(msg.error.message)) : yes(msg.result);
});
const call = (method, params = {}) => new Promise((yes, no) => {
  const id = ++seq;
  pending.set(id, { yes, no });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const sleep = (ms) => new Promise((yes) => setTimeout(yes, ms));
await call('Page.enable');
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1180, height: 800, deviceScaleFactor: 1, mobile: false });

const sample = {
  id: 'example', title: 'AI 商业案例：如何验证一个想法', at: Date.now(), provider: 'codex', model: 'gpt-6.1-sol',
  videoId: 'example-video', sourceUrl: 'https://example.org/video',
  data: { oneLine: '先找到用户的问题，再用小规模实验验证产品想法。',
    keyPoints: [{ text: '和真实用户交流，记录反复出现的问题。', at: 12 }],
    chapters: [{ title: '验证需求', summary: '从具体使用场景开始。', at: 12 }],
    concepts: [{ term: '最小可行产品', explain: '用于验证核心假设的最小版本。', at: 35 }],
    questions: [{ q: '验证想法时先做什么？', a: '先了解用户的问题。', at: 12 }],
    decisions: [], actions: [] }
};
await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.chrome = { storage: { local: { get: async (key) => {
  const all = { 'study:history': [${JSON.stringify(sample)}], 'study:record:example': ${JSON.stringify(sample)} };
  return typeof key === 'string' ? { [key]: all[key] } : all;
}, set: async () => {} } } };` });
await call('Page.navigate', { url: pathToFileURL(resolve(root, 'extension/study/history.html')).href });
await sleep(700);
const history = await evaluate('({count: document.querySelector("#count")?.textContent, title: document.querySelector("#reader h2")?.textContent, points: document.querySelectorAll("#reader li").length})');
assert.equal(history.count, '共 1 条纪要');
assert.equal(history.title, sample.title);
assert(history.points >= 3);
const historyPng = await call('Page.captureScreenshot', { format: 'png' });
await writeFile('/tmp/wdub-study-history-20261105.png', Buffer.from(historyPng.data, 'base64'));

await call('Page.navigate', { url: 'about:blank' });
await sleep(200);
await evaluate(`window.chrome = { storage: { local: {
  get: async () => ({settings: window.savedSettings}),
  set: async (change) => { window.savedSettings = change.settings || window.savedSettings; }
}}};`);
for (const path of ['extension/shared/defaults.js', 'extension/shared/study.js', 'extension/content/study-panel.js'])
  await evaluate(await readFile(resolve(root, path), 'utf8'));
const panel = await evaluate(`(async () => {
  window.panel = new WDub.StudyPanel({onSeek: () => {}, onRetry: () => {}, onTest: async () => ({model:'test'}), onHistory: () => {}});
  panel.open();
  await panel.toggleConfig(true);
  const select = panel.root.querySelector('#study-provider');
  select.value = 'codex'; select.dispatchEvent(new Event('change'));
  await new Promise((yes) => setTimeout(yes, 150));
  return { visible: !panel.drawer.hidden, configuring: panel.drawer.classList.contains('configuring'),
    provider: select.value, model: panel.root.querySelector('#study-model').value,
    url: panel.root.querySelector('#study-url').value,
    label: panel.root.querySelector('.key-field label').textContent,
    saved: (await WDub.getSettings()).study.provider };
})()`);
assert.equal(panel.visible, true);
assert.equal(panel.configuring, true);
assert.equal(panel.provider, 'codex');
assert.equal(panel.saved, 'codex');
assert.equal(panel.url, 'http://127.0.0.1:8198/v1');
assert.equal(panel.label, '本机连接口令');
const panelPng = await call('Page.captureScreenshot', { format: 'png' });
await writeFile('/tmp/wdub-study-panel-20261105.png', Buffer.from(panelPng.data, 'base64'));
console.log(JSON.stringify({ history, panel, screenshots: ['/tmp/wdub-study-history-20261105.png', '/tmp/wdub-study-panel-20261105.png'] }));
ws.close();
