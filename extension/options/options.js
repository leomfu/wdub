const { WDub } = globalThis;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
// 设置 data-* 属性（dataset 不能整体赋值）
const withData = (n, data) => (Object.assign(n.dataset, data), n);

let S = null;
let systemVoices = [];

// ---------- 保存 ----------

let savedTimer;
function flashSaved() {
  $('#saved').classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $('#saved').classList.remove('show'), 1200);
}

async function save(path, value) {
  await WDub.setSetting(path, value);
  flashSaved();
}

// ---------- 通用绑定 ----------

function fmt(v, f) {
  if (f === 'pct') return `${Math.round(v * 100)}%`;
  if (f === 'x') return `${Number(v).toFixed(2).replace(/0$/, '')}x`;
  if (f === '%') return `${v}%`;
  if (f === 'px') return `${v}px`;
  return v;
}

function fillLangs() {
  $$('select.langs').forEach((s) => {
    const list = s.classList.contains('no-auto') ? WDub.LANGS.filter(([c]) => c !== 'auto') : WDub.LANGS;
    s.append(...list.map(([c, n]) => el('option', { value: c, textContent: n })));
  });
}

// data-fill="TTS_ENGINES"：用 WDub 里的列表生成下拉选项或分段按钮
function fillLists() {
  $$('[data-fill]').forEach((n) => {
    const list = WDub[n.dataset.fill];
    if (n.tagName === 'SELECT') n.append(...list.map(([v, t]) => el('option', { value: v, textContent: t })));
    else n.append(...list.map(([v, t]) => withData(el('button', { textContent: t }), { v })));
  });
}

function render() {
  $$('[data-k]').forEach((n) => {
    const v = get(S, n.dataset.k);
    if (n.classList.contains('seg')) n.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    else if (n.type === 'checkbox') n.checked = !!v;
    else if (document.activeElement !== n) n.value = v ?? '';
  });
  $$('.val[data-for]').forEach((n) => (n.textContent = fmt(get(S, n.dataset.for), n.dataset.fmt)));
  // data-show="tts.engine=openai,custom"：只在设置等于其中之一时显示
  $$('[data-show]').forEach((n) => {
    const [path, vals] = n.dataset.show.split('=');
    n.hidden = !vals.split(',').includes(String(get(S, path)));
  });
  renderModels();
  renderOllama();
  renderNeeds();
  renderCards();
  renderPlans();
  renderCast();
  renderPreview();
  renderSubtitlePresets();
  syncSubtitleHex();
  renderPacks();
  renderRules();
  renderSites();
}

function bindInputs() {
  $$('[data-k]').forEach((n) => {
    const k = n.dataset.k;
    if (n.classList.contains('seg')) {
      n.addEventListener('click', (e) => {
        if (!e.target.dataset.v) return;
        if (k.startsWith('subtitle.')) previewSubtitleSetting(k, e.target.dataset.v);
        save(k, e.target.dataset.v);
      });
    } else if (n.type === 'checkbox') {
      n.addEventListener('change', () => save(k, n.checked));
    } else if (k.startsWith('subtitle.') && (n.type === 'range' || n.type === 'color')) {
      n.addEventListener('input', () => previewSubtitleSetting(k, n.type === 'range' ? Number(n.value) : n.value));
      n.addEventListener('change', () => save(k, n.type === 'range' ? Number(n.value) : n.value));
    } else if (n.type === 'range' || n.type === 'number') {
      n.addEventListener('input', () => save(k, Number(n.value)));
    } else if (n.tagName === 'SELECT' || n.type === 'color') {
      n.addEventListener('input', () => save(k, n.value));
    } else {
      let t;
      n.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => save(k, n.value.trim()), 400);
      });
    }
  });
  $$('[data-hex-for]').forEach((n) => {
    const path = n.dataset.hexFor;
    n.addEventListener('focus', () => (n.dataset.before = get(S, path)));
    n.addEventListener('input', () => {
      const valid = /^#[0-9a-f]{6}$/i.test(n.value.trim());
      n.setAttribute('aria-invalid', String(!valid));
      if (valid) previewSubtitleSetting(path, n.value.trim().toUpperCase());
    });
    n.addEventListener('change', () => {
      const value = n.value.trim().toUpperCase();
      if (/^#[0-9A-F]{6}$/.test(value)) save(path, value);
      else {
        previewSubtitleSetting(path, n.dataset.before || get(S, path));
        n.value = get(S, path);
        n.setAttribute('aria-invalid', 'false');
      }
    });
  });
  $('#previewTone').addEventListener('click', () => {
    const button = $('#previewTone');
    const box = $('.pv-video');
    const light = box.dataset.tone !== 'light';
    box.dataset.tone = light ? 'light' : 'dark';
    button.textContent = light ? '换成深色画面' : '换成浅色画面';
    button.setAttribute('aria-pressed', String(light));
  });
}

// ---------- 模型下拉：推荐列表 + 「自定义…」 ----------

const CUSTOM = '__custom';

// 模型存在哪：翻译是 llm.model；配音 / 识别按引擎分开存，例如 tts.elevenlabs.model、asr.groq.model
const modelPath = (box) => box.dataset.path || `${box.dataset.models}.${get(S, box.dataset.by)}.model`;

function renderModels() {
  $$('.model').forEach((box) => {
    if (!box.firstChild) {
      const sel = el('select');
      const input = el('input', { type: 'text', placeholder: '输入模型名' });
      sel.addEventListener('change', () => {
        if (sel.value === CUSTOM) {
          input.hidden = false;
          input.focus();
        } else save(modelPath(box), sel.value);
      });
      let t;
      input.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => input.value.trim() && save(modelPath(box), input.value.trim()), 400);
      });
      box.append(sel, input);
    }
    const [sel, input] = box.children;
    const list = WDub.MODELS[box.dataset.models][get(S, box.dataset.by)] || [];
    const sig = list.map(([v]) => v).join('|');
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.replaceChildren(...list.map(([v, t]) => el('option', { value: v, textContent: t })), el('option', { value: CUSTOM, textContent: '自定义…' }));
    }
    const value = get(S, modelPath(box)) || '';
    const known = list.some(([v]) => v === value);
    // 只有一个可选的模型就不显示这一行
    box.closest('.row').classList.toggle('single', list.length === 1 && known);
    if (document.activeElement !== sel) sel.value = known ? value : CUSTOM;
    if (document.activeElement !== input) {
      input.hidden = known;
      if (!known) input.value = value;
    }
  });
}

// 换了翻译服务商：模型不在新服务商的列表里时，换成它的推荐模型
$('[data-k="llm.provider"]').addEventListener('change', async (e) => {
  if (e.target.value === 'ollama') await loadOllamaModels();
  if (e.target.value === 'gemini') (geminiKeyLoaded = null), await loadGeminiModels();
  const list = WDub.MODELS.llm[e.target.value];
  if (list?.length && !list.some(([m]) => m === S.llm.model)) save('llm.model', list[0][0]);
});

// Gemini 的模型：填好 key 后向 Google 查询现在能用的，只挑版本号最新的正式版 Flash 和 Flash Lite。
// 用原生接口（OpenAI 兼容接口的列表不稳定），key 放在请求头里，不进网址
const GEMINI_FALLBACK = WDub.MODELS.llm.gemini;
let geminiKeyLoaded = null;
async function loadGeminiModels() {
  const key = S.keys.gemini;
  if (key === geminiKeyLoaded) return;
  geminiKeyLoaded = key;
  WDub.MODELS.llm.gemini = GEMINI_FALLBACK;
  if (key) {
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key } });
      const { models = [] } = res.ok ? await res.json() : {};
      const ids = models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
      const ver = (id) => parseFloat(id.match(/^gemini-([\d.]+)/)?.[1] || 0);
      const newest = (re) => ids.filter((id) => re.test(id)).sort((a, b) => ver(b) - ver(a))[0];
      const pretty = (id) => id.replace(/^gemini-([\d.]+)-flash(-lite)?$/, (_, v, lite) => `Gemini ${v} Flash${lite ? ' Lite' : ''}`);
      const flash = newest(/^gemini-[\d.]+-flash$/), lite = newest(/^gemini-[\d.]+-flash-lite$/);
      const list = [flash && [flash, `${pretty(flash)} · 快`], lite && [lite, `${pretty(lite)} · 最便宜`]].filter(Boolean);
      if (list.length) WDub.MODELS.llm.gemini = list;
    } catch {}
  }
  render();
  // 原来选的是内置的旧型号、现在查不到了：换成最新的 Flash（自己手填的模型不动）
  const list = WDub.MODELS.llm.gemini;
  const stale = /^gemini-[\d.]+-flash(-lite)?$|^gemini-flash(-lite)?-latest$/.test(S.llm.model) && !list.some(([m]) => m === S.llm.model);
  if (S.llm.provider === 'gemini' && stale) save('llm.model', list[0][0]);
}

// Ollama 的模型从本机读取：只列出已经下载的，翻译专用模型排在前面
const OLLAMA_MT = 'Dreagonmon/hy-mt1.5:1.8b';
let ollamaState = ''; // '' 还没读 | ok | down
async function loadOllamaModels() {
  ollamaState = 'loading';
  try {
    const res = await fetch(`${S.local.ollama.replace(/\/v1\/?$/, '')}/api/tags`);
    if (!res.ok) throw new Error(res.status);
    const { models = [] } = await res.json();
    WDub.MODELS.llm.ollama = models
      .map((m) => [m.name, `${m.name} · ${(m.size / 1e9).toFixed(1)}GB${WDub.isMtModel(m.name) ? ' · 翻译专用' : ''}`])
      .sort((a, b) => WDub.isMtModel(b[0]) - WDub.isMtModel(a[0]));
    ollamaState = 'ok';
  } catch {
    WDub.MODELS.llm.ollama = [];
    ollamaState = 'down';
  }
  render();
}

function renderOllama() {
  if (S.keys.gemini !== geminiKeyLoaded) loadGeminiModels();
  const on = S.translator === 'llm' && S.llm.provider === 'ollama';
  if (on && !ollamaState) loadOllamaModels();
  const hint = $('#ollamaHint');
  const empty = ollamaState === 'ok' && !WDub.MODELS.llm.ollama.length;
  hint.hidden = !on || !(ollamaState === 'down' || empty);
  if (!hint.hidden) {
    hint.replaceChildren(
      ollamaState === 'down' ? '连不上 Ollama，请确认 Ollama 应用在运行。' : `Ollama 里还没有模型，在终端运行：ollama pull ${OLLAMA_MT}`,
      el('a', { href: '#accounts', textContent: '查看步骤 →', onclick: (e) => (e.preventDefault(), gotoCard('ollama')) })
    );
  }
  $('#mtHint').hidden = !(S.translator === 'llm' && WDub.isMtModel(S.llm.model));
}

// ---------- 缺 key 提示 ----------

function renderNeeds() {
  const fallback = { llm: '暂时用 Google 免费翻译', tts: '所选配音无法启动', asr: '识别会失败' };
  $$('.need[data-need]').forEach((n) => {
    const p = WDub.missingKey(S, n.dataset.need);
    n.hidden = !p;
    if (!p) return;
    n.replaceChildren(`还没填 ${WDub.PROVIDERS[p].name} 的 key，${fallback[n.dataset.need]}。`, el('a', { href: '#accounts', textContent: '去填写 →', onclick: (e) => (e.preventDefault(), gotoCard(p)) }));
  });
}

$$('a[data-goto]').forEach((a) => a.addEventListener('click', (e) => (e.preventDefault(), gotoCard(a.dataset.goto))));

// ---------- 账号与 Key ----------

// 设置页里能选到的服务商（其余服务商的代码还在，见 WDub.PROVIDERS）
const VISIBLE = ['deepseek', 'gemini', 'azure', 'elevenlabs'];

const INFO = {
  deepseek: { url: 'https://platform.deepseek.com/api_keys', steps: '登录 → 创建 API key → 复制粘贴到上面。需要先充值，几块钱能用很久。' },
  gemini: { url: 'https://aistudio.google.com/apikey', steps: '用 Google 账号登录 → Create API key → 复制粘贴到上面。有免费额度。' },
  elevenlabs: { url: 'https://elevenlabs.io/app/settings/api-keys', steps: '登录 → Create API Key → 复制粘贴到上面。免费版每月约 1 万额度。' },
  azure: {
    url: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices',
    steps: '创建「语音服务」，定价层选 Free F0 → 创建好后打开「密钥和终结点」，复制「密钥 1」，区域选和那里一样的。每月 50 万字免费。'
  }
};

const AZURE_REGIONS = [
  ['eastasia', '东亚（香港）'], ['southeastasia', '东南亚（新加坡）'], ['japaneast', '日本东部'], ['koreacentral', '韩国中部'],
  ['eastus', '美国东部'], ['westus2', '美国西部 2'], ['westeurope', '西欧'], ['centralindia', '印度中部']
];

// 每家用在哪些功能上
const USES = { deepseek: '翻译', gemini: '翻译', azure: '配音', elevenlabs: '配音 · 识别' };

const LOCAL = {
  asr: {
    name: '本地识别（Whisper / SenseVoice）', path: 'local.asr', uses: '识别 · 识别人物',
    steps: '需要 M 系列芯片的 Mac。在终端里进入 W 声幕的项目文件夹，运行下面的命令；终端窗口别关，关了服务就停了。第一次会自动安装，需要几分钟。',
    cmds: [['bash tools/start-whisper.sh', '外语识别'], ['bash tools/start-whisper.sh --sensevoice', '外语 + 中文识别']]
  },
  ollama: {
    name: 'Ollama 本地翻译', path: 'local.ollama', uses: '翻译',
    url: 'https://ollama.com/download', link: '下载 Ollama ↗',
    steps: '安装 Ollama 应用（装好后会自己在后台运行），再在终端下载翻译模型。推荐腾讯混元的翻译专用模型，约 1.1GB，又快又准：',
    cmds: [[`ollama pull ${OLLAMA_MT}`, '下载模型']]
  }
};

const resultSpan = (card) => card.querySelector('.result');
function say(card, text, cls = '') {
  const r = resultSpan(card);
  r.textContent = text;
  r.className = 'result ' + cls;
}

function keyRow(label, path, type = 'password', placeholder = '') {
  return el('div', { className: 'row' }, el('label', { textContent: label }), withData(el('input', { type, placeholder }), { k: path }));
}

function buildCards() {
  for (const p of VISIBLE) {
    const info = INFO[p];
    const fields =
      p === 'azure'
        ? [keyRow('Key', 'keys.azure.key', 'password', '密钥 1 或密钥 2'),
           el('div', { className: 'row' }, el('label', { textContent: '区域' }),
             withData(el('select', {}, ...AZURE_REGIONS.map(([v, t]) => el('option', { value: v, textContent: `${t} · ${v}` }))), { k: 'keys.azure.region' }))]
        : [keyRow('API Key', `keys.${p}`)];
    const test = el('button', { className: 'btn small', textContent: '测试' });
    test.onclick = () => testProvider(p, card);
    const card = el('div', { className: 'card' },
      el('div', { className: 'card-head' }, el('b', { textContent: WDub.PROVIDERS[p].name }), el('span', { className: 'uses', textContent: USES[p] }), el('span', { className: 'badge' })),
      ...fields,
      el('div', { className: 'card-foot' },
        el('a', { className: 'btn small', href: info.url, target: '_blank', rel: 'noopener', textContent: '去获取 key ↗' }), test, el('span', { className: 'result' })),
      el('p', { className: 'hint', textContent: info.steps }));
    card.dataset.card = p;
    $('#cardsMore').append(card);
  }

  for (const [id, info] of Object.entries(LOCAL)) {
    const test = el('button', { className: 'btn small', textContent: '测试' });
    const cmds = info.cmds.map(([cmd, label]) => {
      const copy = el('button', { className: 'btn small', textContent: '复制' });
      copy.onclick = async () => {
        await navigator.clipboard.writeText(cmd).catch(() => {});
        copy.textContent = '已复制 ✓';
        setTimeout(() => (copy.textContent = '复制'), 1500);
      };
      return el('div', { className: 'cmd' }, el('span', { className: 'hint', textContent: label }), el('code', { textContent: cmd }), copy);
    });
    const links = [...(info.url ? [[info.url, info.link]] : []), ...(info.extra || [])].map(([href, t]) => el('a', { className: 'btn small', href, target: '_blank', rel: 'noopener', textContent: t }));
    const card = el('div', { className: 'card' },
      el('div', { className: 'card-head' }, el('b', { textContent: info.name }), el('span', { className: 'uses', textContent: info.uses }), el('span', { className: 'badge' })),
      keyRow('地址', info.path, 'url'),
      el('div', { className: 'card-foot' }, ...links, test, el('span', { className: 'result' })),
      el('p', { className: 'hint', textContent: info.steps }),
      ...cmds);
    card.dataset.card = id;
    test.onclick = () => testLocal(id, card);
    $('#cardsLocal').append(card);
  }
}

// 现在的设置用到了哪些服务商 / 本地服务
function usedSet() {
  const used = new Set();
  if (S.translator === 'llm') used.add(S.llm.provider);
  used.add(S.tts.engine);
  used.add(S.asr.engine === 'sensevoice' ? 'local' : S.asr.engine);
  if (used.has('local')) used.add('asr');
  return used;
}

let placed = '';
function renderCards() {
  const used = usedSet();
  const filled = (p) => (p === 'azure' ? !!S.keys.azure.key : !!S.keys[p]);
  $$('[data-card]').forEach((card) => {
    const p = card.dataset.card;
    const badge = card.querySelector('.badge');
    if (LOCAL[p]) {
      badge.textContent = used.has(p) ? '正在使用' : '';
      badge.className = 'badge' + (used.has(p) ? ' on' : '');
    } else {
      badge.textContent = filled(p) ? '已填' : '未填';
      badge.className = 'badge' + (filled(p) ? ' ok' : '');
    }
  });
  // 只在「正在使用」的服务商变化时才挪动卡片，不打断正在输入的框
  const sig = VISIBLE.filter((p) => used.has(p)).join('|');
  if (sig === placed) return;
  placed = sig;
  for (const p of VISIBLE) (used.has(p) ? $('#cardsUsed') : $('#cardsMore')).append($(`[data-card="${p}"]`));
  const none = !$('#cardsUsed .card');
  $('#cardsUsed').classList.toggle('empty', none);
  $('#cardsUsed').dataset.empty = '现在用的都是免费或本地服务，不需要填 key。';
  $('#moreProviders summary').textContent = `更多服务商（${$$('#cardsMore .card').length}）`;
}

// 跳到「账号与 Key」里某张卡片并闪一下
function gotoCard(id) {
  location.hash = 'accounts';
  requestAnimationFrame(() => {
    const card = $(`[data-card="${id}"]`);
    if (!card) return;
    if (card.closest('details')) card.closest('details').open = true;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
  });
}

async function fetchStatus(url, init) {
  try {
    const res = await fetch(url, init);
    return { ok: res.ok, status: res.status, res };
  } catch {
    return { ok: false, status: 0 };
  }
}

const why = (r) => (r.status === 0 ? '连不上，检查一下网络' : r.status === 401 || r.status === 403 ? 'key 不对' : `出错了（${r.status}）`);

async function testProvider(p, card) {
  const k = S.keys;
  const missing = p === 'azure' ? !k.azure.key : !k[p];
  if (missing) return say(card, '先填上 key', 'err');
  say(card, '测试中…');
  let r;
  if (p === 'elevenlabs') {
    r = await fetchStatus('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': k.elevenlabs } });
    if (r.ok) {
      const j = await r.res.json().catch(() => ({}));
      const left = j.character_limit - j.character_count;
      return say(card, Number.isFinite(left) ? `可用 ✓ 本月还剩 ${left.toLocaleString()} 额度` : '可用 ✓', 'ok');
    }
    // 有的 key 没有查看额度的权限，再用声音列表试一次
    if (r.status === 401) {
      const r2 = await fetchStatus('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': k.elevenlabs } });
      if (r2.ok) return say(card, '可用 ✓', 'ok');
    }
  } else if (p === 'azure') {
    r = await fetchStatus(`https://${k.azure.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { headers: { 'Ocp-Apim-Subscription-Key': k.azure.key } });
    if (r.status === 401) return say(card, 'key 不对，或者区域和创建时选的不一样', 'err');
  } else {
    r = await fetchStatus(`${WDub.PROVIDERS[p].base}/models`, { headers: { Authorization: `Bearer ${k[p]}` } });
  }
  say(card, r.ok ? '可用 ✓' : why(r), r.ok ? 'ok' : 'err');
  // key 能用不代表选的模型还能用：顺便重新查一次 Gemini 现在能用的模型
  if (p === 'gemini' && r.ok) (geminiKeyLoaded = null), loadGeminiModels();
}

async function testLocal(id, card) {
  say(card, '测试中…');
  const base = get(S, LOCAL[id].path).replace(/\/+$/, '');
  const r = await fetchStatus(`${base}/models`);
  if (!r.ok) return say(card, r.status ? `出错了（${r.status}）` : '没启动 ✗ 按下面的步骤开启', 'err');
  if (id === 'ollama') {
    const ids = ((await r.res.json().catch(() => ({}))).data || []).map((m) => m.id);
    loadOllamaModels();
    return ids.length ? say(card, `运行中 ✓ 已下载 ${ids.length} 个模型`, 'ok') : say(card, `运行中，但还没下载模型，运行：ollama pull ${OLLAMA_MT}`, 'err');
  }
  say(card, '运行中 ✓', 'ok');
}

const tone = () => new Float32Array(32000).map((_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / 16000));

// ---------- 一键方案 ----------

const PLANS = [
  {
    id: 'free', name: '免费', tag: '马上能用',
    desc: 'Google 翻译 + 系统声音 + 本地识别。什么都不用填。',
    set: { translator: 'google', 'tts.engine': 'system', 'asr.engine': 'local' }
  },
  {
    id: 'best', name: '推荐', tag: '效果最好',
    desc: 'DeepSeek 翻译 + Azure 神经语音。翻译更自然、声音接近真人。要填两个 key，Azure 每月 50 万字免费。',
    set: { translator: 'llm', 'llm.provider': 'deepseek', 'llm.model': 'deepseek-chat', 'tts.engine': 'azure', 'asr.engine': 'local' },
    goto: 'deepseek'
  },
  {
    id: 'local', name: '全本地', tag: '不联网',
    desc: 'Ollama 翻译 + 系统声音 + 本地识别。不花钱、不联网，用你电脑上 Ollama 里的模型翻译。',
    set: { translator: 'llm', 'llm.provider': 'ollama', 'tts.engine': 'system', 'asr.engine': 'local' },
    goto: 'ollama'
  }
];

function buildPlans() {
  $('#plans').append(
    ...PLANS.map((plan) => {
      const use = el('button', { className: 'btn primary', textContent: '用这套' });
      use.onclick = async () => {
        for (const [k, v] of Object.entries(plan.set)) await WDub.setSetting(k, v);
        // 全本地：模型用 Ollama 里已经下载的（翻译专用的优先）
        if (plan.set['llm.provider'] === 'ollama') {
          await loadOllamaModels();
          const list = WDub.MODELS.llm.ollama;
          if (list.length && !list.some(([m]) => m === S.llm.model)) await WDub.setSetting('llm.model', list[0][0]);
        }
        flashSaved();
        if (plan.goto) gotoCard(plan.goto);
      };
      const card = el('div', { className: 'plan glass' },
        el('div', { className: 'plan-head' }, el('b', { textContent: plan.name }), el('span', { className: 'tag', textContent: plan.tag }), el('span', { className: 'badge' })),
        el('p', { textContent: plan.desc }), use);
      card.dataset.plan = plan.id;
      return card;
    }),
    el('p', { className: 'hint mix', textContent: '也可以混搭：到「翻译」「语音」「识别」各页单独选。' })
  );
}

function renderPlans() {
  if (globalThis.WDubMobile) return;
  for (const plan of PLANS) {
    const on = Object.entries(plan.set).every(([k, v]) => k === 'llm.model' || get(S, k) === v);
    const card = $(`[data-plan="${plan.id}"]`);
    card.classList.toggle('on', on);
    card.querySelector('.badge').textContent = on ? '当前' : '';
  }
}

// ---------- 角色声音 ----------

const voiceOptions = (engine) => WDub.voiceOptions(engine, S, systemVoices, elevenVoices);

// 填了 ElevenLabs key 后，声音列表里加上账号里的声音（包括克隆的）
let elevenVoices = [], elevenKeyLoaded = '';
async function loadElevenVoices() {
  const key = S.keys.elevenlabs;
  if (S.tts.engine !== 'elevenlabs' || key === elevenKeyLoaded) return;
  elevenKeyLoaded = key;
  elevenVoices = await WDub.fetchElevenVoices(key);
  if (key === S.keys.elevenlabs) renderCast();
}

function renderCast() {
  loadElevenVoices();
  const engine = S.tts.engine;
  const cast = S.cast[engine] || { narrator: '', male: [], female: [] };
  const opts = voiceOptions(engine);
  const narrator = $('#narrator');
  narrator.replaceChildren(
    ...(engine === 'system' ? [el('option', { value: '', textContent: '自动（跟随目标语言）' })] : []),
    ...opts.map(([v, n]) => el('option', { value: v, textContent: n }))
  );
  if (cast.narrator && !opts.some(([v]) => v === cast.narrator)) narrator.append(el('option', { value: cast.narrator, textContent: cast.narrator }));
  narrator.value = cast.narrator || '';

  for (const pool of ['male', 'female']) {
    const box = $('#' + pool);
    const list = cast[pool] || [];
    const chips = list.map((v) => {
      const label = opts.find(([x]) => x === v)?.[1] || v;
      const rm = el('button', { textContent: '✕', title: '移除' });
      rm.onclick = () => save(`cast.${engine}.${pool}`, list.filter((x) => x !== v));
      return el('span', { className: 'chip' }, label, rm);
    });
    const add = el('select', {}, el('option', { value: '', textContent: '＋ 添加声音' }), ...opts.filter(([v]) => !list.includes(v)).map(([v, n]) => el('option', { value: v, textContent: n })));
    add.onchange = () => add.value && save(`cast.${engine}.${pool}`, [...list, add.value]);
    box.replaceChildren(...chips, add);
  }
}

$('#narrator').addEventListener('change', (e) => save(`cast.${S.tts.engine}.narrator`, e.target.value));

$('#testVoice').addEventListener('click', async () => {
  WDub.MobileAudio?.unlock();
  $('#testResult').textContent = '合成中…';
  const voice = S.cast[S.tts.engine]?.narrator || '';
  const r = await chrome.runtime.sendMessage({ target: 'bg', type: 'tts.test', payload: { text: $('#testText').value, voice } });
  try {
    if (r?.result?.mobileAudio) await WDub.MobileAudio.handle(r.result.mobileAudio);
    $('#testResult').textContent = r?.error ? `失败：${r.error}` : '正在播放 ✓';
  } catch (e) {
    $('#testResult').textContent = `失败：${e.message}`;
  }
});

// ---------- 翻译 ----------

$('#testLlm').addEventListener('click', async () => {
  $('#llmResult').textContent = '测试中…';
  const r = await chrome.runtime.sendMessage({ target: 'bg', type: 'llm.test' });
  $('#llmResult').textContent = r?.error ? `失败：${r.error}` : `成功：Hello, welcome back to the channel. → ${r.result.sample}`;
});

// ---------- 语音识别 ----------

// 测试识别：OpenAI 格式的接口用 /models 测地址和 key，比真的识别一段音频快得多；其余用 2 秒提示音
$('#testAsr').addEventListener('click', async () => {
  const out = $('#asrResult');
  out.textContent = '测试中…';
  const { engine, conf, lang } = WDub.ASR.config(S);
  const local = engine === 'local' || engine === 'sensevoice';
  try {
    if (conf.baseUrl) {
      const res = await fetch(`${conf.baseUrl.replace(/\/+$/, '')}/models`, { headers: conf.apiKey ? { Authorization: `Bearer ${conf.apiKey}` } : {} });
      if (!res.ok) throw new Error(`${res.status}${res.status === 401 ? '（key 不对）' : ''}`);
      out.textContent = '连接成功 ✓';
      return;
    }
    await WDub.ASR.engines[engine].run(WDub.ASR.wav(tone()), conf, lang);
    out.textContent = '连接成功 ✓（测试用的是提示音，识别不出文字是正常的）';
  } catch (e) {
    if (local && /fetch/i.test(e.message)) {
      out.replaceChildren('本地识别服务没有启动。', el('a', { href: '#accounts', textContent: '怎么开启 →', onclick: (ev) => (ev.preventDefault(), gotoCard('asr')) }));
    } else out.textContent = `失败：${e.message}`;
  }
});

// 选中文引擎时，视频语言还是英语的话自动改成中文
$('[data-k="asr.engine"]').addEventListener('click', (e) => {
  const v = e.target.dataset.v;
  if ((v === 'sensevoice' || v === 'doubao') && S.asr.language === 'en') save('asr.language', 'zh');
});

// ---------- 字幕预览 ----------

function previewSubtitleSetting(path, value) {
  S.subtitle[path.split('.')[1]] = value;
  const picker = $(`input[type="color"][data-k="${path}"]`);
  if (picker && document.activeElement !== picker) picker.value = value;
  renderPreview();
  renderSubtitlePresets();
  syncSubtitleHex();
  $$('.val[data-for]').filter((n) => n.dataset.for === path)
    .forEach((n) => (n.textContent = fmt(value, n.dataset.fmt)));
  if (path === 'subtitle.edge') {
    $$('[data-show="subtitle.edge=shadow,outline"]').forEach((n) => (n.hidden = value === 'none'));
  }
  if (path === 'subtitle.mode' || path === 'subtitle.edge' || path === 'subtitle.position') {
    const seg = $(`.seg[data-k="${path}"]`);
    seg?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === value));
  }
}

function syncSubtitleHex() {
  $$('[data-hex-for]').forEach((n) => {
    if (document.activeElement !== n) n.value = get(S, n.dataset.hexFor) || '';
    if (document.activeElement !== n) n.setAttribute('aria-invalid', 'false');
  });
}

function renderSubtitlePresets() {
  const host = $('#subtitlePresets');
  if (!host.firstChild) {
    for (const preset of WDub.SUBTITLE_PRESETS) {
      const sample = el('span', { textContent: '字幕效果 Aa' });
      sample.style.color = preset.style.translatedColor;
      sample.style.background = `rgba(11,16,36,${preset.style.bgOpacity})`;
      if (preset.style.edge === 'shadow') sample.style.textShadow = `0 1px 3px ${preset.style.edgeColor}, 0 0 2px ${preset.style.edgeColor}`;
      if (preset.style.edge === 'outline') {
        sample.style.webkitTextStroke = `.06em ${preset.style.edgeColor}`;
        sample.style.paintOrder = 'stroke fill';
      }
      const button = el('button', { type: 'button', className: 'subtitle-preset' },
        el('span', { className: 'sample' }, sample),
        el('b', { textContent: preset.title }), el('small', { textContent: preset.note }));
      button.dataset.preset = preset.id;
      button.addEventListener('click', () => {
        Object.assign(S.subtitle, preset.style);
        render();
        WDub.setSettings(Object.fromEntries(Object.entries(preset.style).map(([key, value]) => [`subtitle.${key}`, value])))
          .then(flashSaved);
      });
      host.append(button);
    }
  }
  const id = WDub.subtitlePresetId(S.subtitle);
  host.querySelectorAll('button').forEach((b) => {
    const active = b.dataset.preset === id;
    b.classList.toggle('on', active);
    b.setAttribute('aria-pressed', String(active));
  });
  $('#subtitleStyleName').textContent = `当前样式：${WDub.SUBTITLE_PRESETS.find((p) => p.id === id)?.title || '自定义'}`;
}

function renderPreview() {
  const s = S.subtitle;
  const card = $('.pv-card');
  const tr = $('.pv-tr'), or = $('.pv-or');
  card.style.background = `rgba(11,16,36,${s.bgOpacity})`;
  card.style.fontFamily = s.fontFamily || '-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
  const box = $('.pv-video');
  const width = box.clientWidth || 720;
  card.style.fontSize = `${s.fontSize * Math.min(Math.max(width / 1280, 0.55), 1.6)}px`;
  card.style.flexDirection = s.order === 'translatedFirst' ? 'column' : 'column-reverse';
  box.style.justifyContent = s.position === 'top' ? 'flex-start' : 'flex-end';
  const offset = `${((box.clientHeight || 258) * s.offset) / 100}px`;
  box.style.paddingTop = s.position === 'top' ? offset : '0';
  box.style.paddingBottom = s.position === 'bottom' ? offset : '0';
  tr.style.color = s.translatedColor;
  tr.style.fontWeight = 600;
  or.style.color = s.originalColor;
  or.style.fontSize = `${s.originalScale}em`;
  or.style.fontWeight = 400;
  or.style.background = Number(s.originalBg) > 0 ? `rgba(11,16,36,${s.originalBg})` : 'transparent';
  or.style.padding = Number(s.originalBg) > 0 ? '.04em .4em' : '0';
  or.style.borderRadius = Number(s.originalBg) > 0 ? '.35em' : '0';
  const edgeColor = s.edgeColor || '#000000';
  const shadow = s.edge === 'shadow' ? `0 1px 3px ${edgeColor}, 0 0 2px ${edgeColor}` : 'none';
  const stroke = s.edge === 'outline' ? `.06em ${edgeColor}` : '0';
  for (const n of [tr, or]) {
    n.style.textShadow = shadow;
    n.style.webkitTextStroke = stroke;
    n.style.paintOrder = 'stroke fill';
  }
  or.hidden = s.mode === 'translated';
  card.hidden = s.mode === 'off';
}
window.addEventListener('resize', () => S && renderPreview());

// ---------- 规则表 ----------

function renderPacks() {
  const host = $('#term-packs');
  if (!host) return;
  const selected = new Set(S.rules.packMode === 'manual' ? WDub.enabledPackIds(S) : []);
  const row = (pack) => {
    const input = el('input', { type: 'checkbox', checked: selected.has(pack.id), disabled: S.rules.packMode !== 'manual' });
    input.addEventListener('change', () => {
      const on = new Set(WDub.enabledPackIds(S));
      if (input.checked) on.add(pack.id);
      else on.delete(pack.id);
      save('rules.packs', WDub.TERM_PACKS.map((item) => item.id).filter((id) => on.has(id)));
    });
    return el('label', { className: 'pack' }, input, el('span', {}, el('b', { textContent: pack.title }), el('small', { textContent: pack.source })));
  };
  host.replaceChildren(
    el('h2', {}, '精选词表 ', el('span', { className: 'hint', textContent: S.rules.packMode === 'manual' ? '勾选后用于所有视频' : '自动模式会按视频内容选择，播放后在 W 浮窗查看结果' })),
    ...WDub.TERM_PACKS.filter((pack) => pack.auto).map(row),
    el('details', { className: 'adv' }, el('summary', {}, '旧版大词典（仅手动使用）'), ...WDub.TERM_PACKS.filter((pack) => !pack.auto).map(row))
  );
}

function renderRules() {
  $$('.rule-block').forEach((block) => {
    const name = block.dataset.rule, a = block.dataset.a, b = block.dataset.b;
    const list = S.rules[name] || [];
    const commit = (next) => save(`rules.${name}`, next);
    const rows = list.map((r, i) => {
      const on = el('input', { type: 'checkbox', checked: r.on !== false, title: '启用' });
      on.onchange = () => commit(list.map((x, k) => (k === i ? { ...x, on: on.checked } : x)));
      const ia = el('input', { type: 'text', value: r[a] || '', placeholder: block.dataset.pa });
      const ib = el('input', { type: 'text', value: r[b] || '', placeholder: block.dataset.pb });
      const upd = () => commit(list.map((x, k) => (k === i ? { ...x, [a]: ia.value, [b]: ib.value } : x)));
      ia.onchange = ib.onchange = upd;
      const rm = el('button', { className: 'icon', textContent: '✕', title: '删除' });
      rm.onclick = () => commit(list.filter((_, k) => k !== i));
      return el('tr', {}, el('td', {}, on), el('td', {}, ia), el('td', {}, ib), el('td', {}, rm));
    });
    const add = el('button', { className: 'btn small add', textContent: '＋ 新增一条' });
    add.onclick = () => commit([...list, { [a]: '', [b]: '', on: true }]);
    block.querySelector('table')?.remove();
    block.querySelector('.add')?.remove();
    if (rows.length) block.append(el('table', {}, ...rows));
    block.append(add);
  });
}

// ---------- 站点 ----------

function renderSites() {
  const list = S.disabledSites;
  $('#sites-list').replaceChildren(
    ...(list.length
      ? list.map((d) => {
          const rm = el('button', { className: 'btn small', textContent: '移除' });
          rm.onclick = () => save('disabledSites', list.filter((x) => x !== d));
          return el('li', {}, d, rm);
        })
      : [el('li', { className: 'hint', textContent: '暂无' })])
  );
}

$('#siteAdd').addEventListener('click', () => {
  const v = $('#siteInput').value.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (!v || S.disabledSites.includes(v)) return;
  $('#siteInput').value = '';
  save('disabledSites', [...S.disabledSites, v]);
});

// ---------- 备份与迁移 ----------

// key 用你设的密码加密：PBKDF2 把密码变成密钥，再用 AES-GCM 加密
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function passwordKey(pw, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(obj, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await passwordKey(pw, salt), new TextEncoder().encode(JSON.stringify(obj)));
  return { salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) };
}
async function unseal(box, pw) {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, await passwordKey(pw, unb64(box.salt)), unb64(box.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('密码不对');
  }
}

const storedRaw = async () => WDub.migrate((await chrome.storage.local.get('settings')).settings) || { v: 3 };

$('#withKeys').addEventListener('change', (e) => {
  $('#exportPw').hidden = !e.target.checked;
  if (e.target.checked) $('#exportPw').focus();
});

$('#exportCfg').addEventListener('click', async () => {
  const raw = await storedRaw();
  const file = { app: 'wdub', v: 2, exportedAt: new Date().toISOString(), settings: WDub.stripSecrets(raw) };
  if ($('#withKeys').checked) {
    const pw = $('#exportPw').value;
    if (pw.length < 4) return ($('#dataResult').textContent = '请先设一个至少 4 位的密码，导入时要用。');
    file.encryptedKeys = await seal(WDub.pickSecrets(raw), pw);
  }
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  el('a', { href: URL.createObjectURL(blob), download: `wdub-backup-${new Date().toISOString().slice(0, 10)}.json` }).click();
  $('#dataResult').textContent = file.encryptedKeys ? '已导出，key 已加密。记住刚才设的密码，导入时要用。' : '已导出（不含 key）。';
});

// 导入：只接受设置里本来就有的项目；这台电脑上的 key 保留，备份里解锁出来的 key 覆盖同名的
let pending = null;
async function applyImport(secrets) {
  const known = (base, patch) =>
    Object.fromEntries(
      Object.entries(patch || {})
        .filter(([k]) => Object.hasOwn(base, k))
        .map(([k, v]) => [k, WDub.isPlainObject(base[k]) && WDub.isPlainObject(v) ? known(base[k], v) : v])
    );
  const current = await storedRaw();
  const incoming = WDub.stripSecrets(known(WDub.DEFAULTS, WDub.migrate(pending)));
  let next = WDub.putSecrets(WDub.deepMerge(WDub.stripSecrets(current), incoming), WDub.pickSecrets(current));
  if (secrets) {
    const nonEmpty = (v) => (WDub.isPlainObject(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '').map(([k, x]) => [k, nonEmpty(x)])) : v);
    next = WDub.deepMerge(next, nonEmpty(WDub.putSecrets({}, secrets)));
  }
  await chrome.storage.local.set({ settings: { ...next, v: 3, at: Date.now() } });
  pending = null;
  $('#unlock').hidden = true;
  $('#dataResult').textContent = secrets ? '设置和 key 都已导入 ✓' : '设置已导入 ✓（key 保留了这台电脑上现有的）';
}

$('#importCfg').addEventListener('click', () => $('#cfgFile').click());
$('#cfgFile').addEventListener('change', async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    // 新格式 {app:'wdub', settings, encryptedKeys}；旧版导出的文件就是设置本身
    pending = data.app === 'wdub' ? data.settings : data;
    if (data.encryptedKeys) {
      pending.__box = data.encryptedKeys;
      $('#unlock').hidden = false;
      $('#importPw').value = '';
      $('#importPw').focus();
      $('#dataResult').textContent = '这个备份里有加密的 key：输入导出时设的密码解锁，或者只导入设置。';
    } else await applyImport(null);
  } catch (err) {
    $('#dataResult').textContent = `导入失败：${err.message}`;
  } finally {
    e.target.value = '';
  }
});
$('#unlockOk').addEventListener('click', async () => {
  try {
    const box = pending.__box;
    delete pending.__box;
    const secrets = await unseal(box, $('#importPw').value).catch((err) => {
      pending.__box = box;
      throw err;
    });
    await applyImport(secrets);
  } catch (err) {
    $('#dataResult').textContent = `导入失败：${err.message}`;
  }
});
$('#importPw').addEventListener('keydown', (e) => e.key === 'Enter' && $('#unlockOk').click());
$('#unlockSkip').addEventListener('click', () => {
  delete pending.__box;
  applyImport(null);
});

async function renderSync() {
  const { syncState } = await chrome.storage.local.get('syncState');
  $('#syncState').textContent = !chrome.storage.sync
    ? '这个浏览器不支持同步，换电脑时请用下面的导出备份。'
    : syncState === 'too-big'
      ? '⚠ 设置和术语太多，超出了 Chrome 同步的容量，换电脑时请用下面的导出备份。'
      : '设置和术语库会通过 Chrome 同步，自动出现在登录同一个 Google 账号的其他电脑上（key 除外）。需要 Chrome 已登录并开启同步。';
}

// 分类清理：每一项都走后台，保证内存缓存和已打开页面一起失效（文档 E）
const clearGroups = {
  clearCache: { label: '翻译缓存', prefixes: ['tr:'] },
  clearAsr: { label: '识别与校对结果', prefixes: ['asr:'] },
  clearPeople: { label: '人物绑定和说话人结果', prefixes: ['cuefix:', 'spk:'] },
  clearStudy: { label: '视频纪要', prefixes: ['study:'] }
};
for (const [id, group] of Object.entries(clearGroups)) {
  $(`#${id}`).addEventListener('click', async () => {
    if (!confirm(`清空${group.label}？清理后无法恢复。`)) return;
    const r = await chrome.runtime.sendMessage({ target: 'bg', type: 'cache.clear', payload: { prefixes: group.prefixes } });
    if (r?.error) return ($('#dataResult').textContent = `清理失败：${r.error}`);
    $('#dataResult').textContent = `已清空 ${r.result?.removed ?? 0} 条${group.label}。`;
  });
}
$('#clearAll').addEventListener('click', async () => {
  if (!confirm('清空全部本机数据？设置、key、缓存都会删除，无法恢复。')) return;
  const r = await chrome.runtime.sendMessage({ target: 'bg', type: 'cache.clear', payload: { all: true } });
  if (r?.error) return ($('#dataResult').textContent = `清理失败：${r.error}`);
  $('#dataResult').textContent = `已清空全部本机数据（${r.result?.removed ?? 0} 项）。请重新加载扩展。`;
});
$('#resetCfg').addEventListener('click', async () => {
  if (!confirm('恢复全部默认设置？这台电脑上的 key 也会被清除。')) return;
  // 写一份带时间的空设置，而不是直接删掉：否则下次启动会从 Chrome 同步里把旧设置拉回来
  await chrome.storage.local.set({ settings: { v: 3, at: Date.now() } });
  $('#dataResult').textContent = '已恢复默认设置。';
});

// ---------- 快捷键（只能在 Chrome 的快捷键页面修改，这里显示当前设置） ----------

async function renderShortcuts() {
  const cmds = (await chrome.commands?.getAll?.()) || [];
  $('#shortcuts').replaceChildren(
    ...cmds.flatMap((c) => [
      Object.assign(document.createElement('span'), { textContent: c.description }),
      Object.assign(document.createElement('kbd'), { textContent: c.shortcut || '未设置', className: c.shortcut ? '' : 'none' })
    ])
  );
}
renderShortcuts();
// 从快捷键页面改完回来时刷新
window.addEventListener('focus', renderShortcuts);
$('#editShortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

// ---------- 分栏切换：一次只显示一个功能区 ----------

const sections = $$('main section');
function showSection(id) {
  const i = Math.max(0, sections.findIndex((s) => s.id === id));
  sections.forEach((s, k) => s.classList.toggle('on', k === i));
  $$('nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + sections[i].id));
  const title = (s) => s?.querySelector('h1').textContent;
  $('#prevSec').hidden = i === 0;
  $('#prevSec').textContent = `← ${title(sections[i - 1]) || ''}`;
  $('#nextSec').hidden = i === sections.length - 1;
  $('#nextSec').textContent = `下一项：${title(sections[i + 1]) || ''} →`;
  $('#prevSec').onclick = () => (location.hash = sections[i - 1].id);
  $('#nextSec').onclick = () => (location.hash = sections[i + 1].id);
  window.scrollTo(0, 0);
}
sections.forEach((s, k) =>
  s.querySelector('h1').insertAdjacentElement('beforebegin', Object.assign(document.createElement('div'), { className: 'crumb', textContent: `${k + 1} / ${sections.length}` }))
);
window.addEventListener('hashchange', () => showSection(location.hash.slice(1)));
showSection(location.hash.slice(1));

// ---------- 启动 ----------

(async () => {
  fillLangs();
  fillLists();
  buildCards();
  if (!globalThis.WDubMobile) buildPlans();
  if (globalThis.WDubMobile) {
    $('#start .lead').textContent = '在视频页点 W，双语字幕与中文配音会一起播放。先在「账号与 Key」填写 Azure 或 ElevenLabs 配音 key；无字幕视频还需 ElevenLabs 识别 key。';
    $('#accounts .lead').textContent = 'key 只保存在这台手机的扩展存储中，用于调用你选择的云端翻译、配音和识别服务。';
    $('#cardsLocal').hidden = true;
    $('#cardsLocal').previousElementSibling.hidden = true;
    $('#asr .lead').textContent = '没有字幕时，用 ElevenLabs 云端识别视频。确认识别出的文字后，再翻译和配音。';
    $('#editShortcuts').parentElement.hidden = true;
  } else {
    systemVoices = await new Promise((r) => chrome.tts.getVoices(r));
  }
  S = await WDub.getSettings();
  bindInputs();
  render();
  renderSync();
  WDub.onSettingsChanged((s) => {
    S = s;
    render();
  });
})();
