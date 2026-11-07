const { WDub } = globalThis;
const $ = (s) => document.querySelector(s);
const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

// 线条图标
WDub.setHTML($('#openOptions'), WDub.ICONS.settings);
document.querySelectorAll('[data-icon]').forEach((el) => WDub.setHTML(el, WDub.ICONS[el.dataset.icon]));

$('select[data-k=targetLang]').append(
  ...WDub.LANGS.filter(([c]) => c !== 'auto').map(([c, n]) => Object.assign(document.createElement('option'), { value: c, textContent: n }))
);

function render(s) {
  document.querySelectorAll('select[data-k]').forEach((el) => (el.value = get(s, el.dataset.k)));
  document.querySelectorAll('input[type=checkbox][data-k]').forEach((el) => (el.checked = !!get(s, el.dataset.k)));
  document.querySelectorAll('.seg[data-k]').forEach((seg) => {
    const v = get(s, seg.dataset.k);
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  });
  // 选了需要 key 的引擎但没填：直接在那一项下面说明现在实际用的是什么
  const note = (el, text) => {
    el.hidden = !text;
    WDub.setHTML(el, text ? `${text} · <a data-fix>去填写</a>` : '');
  };
  note($('#noteTr'), s.translator === 'llm' && !s.llm.apiKey ? '未填 key，暂用 Google 免费翻译' : '');
  const ttsMissing = WDub.missingKey(s, 'tts');
  note($('#noteTts'), ttsMissing ? '未填 key，所选配音无法启动' : '');
  S = s;
  renderVoice(s);
}
// ---------- 配音声音 + 多人配音（和视频上的面板共用 WDub.CastEditor） ----------

const cast = new WDub.CastEditor({
  rowClass: 'field',
  onSave: (path, v) => WDub.setSetting(path, v),
  onTry: async (voice) => {
    WDub.MobileAudio?.unlock();
    const r = await chrome.runtime.sendMessage({ target: 'bg', type: 'tts.test', payload: { text: '你好，这是 W 声幕的配音试听。', voice } });
    if (r?.error) throw new Error(r.error);
    if (r?.result?.mobileAudio) return WDub.MobileAudio.handle(r.result.mobileAudio);
  },
  onDetect: () => sendCmd('detect-speakers'),
  onCorrect: (fix) => sendCmd('correct-cue', fix),
  onJump: (delta) => sendCmd('jump-cue', { delta }),
  allowDetect: !globalThis.WDubMobile
});
$('#cast').replaceWith(cast.el);

let S = null, systemVoices = [], elevenVoices = [], elevenKey = null;
chrome.tts?.getVoices((v) => {
  systemVoices = v || [];
  if (S) renderVoice(S);
});
if (globalThis.WDubMobile) {
  $('select[data-k="tts.engine"] option[value="system"]')?.remove();
  $('#toggle').disabled = true;
  $('#toggle').textContent = '请在视频页点 W 开始';
  document.querySelector('.hint.center').textContent = '点视频页上的 W，启动字幕与配音';
}

// 按用户选定的引擎列出声音；缺 key 的提示另行显示。
async function renderVoice(s) {
  const engine = WDub.ttsEngine(s);
  if (engine === 'elevenlabs' && s.keys.elevenlabs !== elevenKey) {
    elevenKey = s.keys.elevenlabs;
    elevenVoices = await WDub.fetchElevenVoices(elevenKey);
  }
  cast.update({ s, engine, options: WDub.voiceOptions(engine, s, systemVoices, elevenVoices) });
}

// 「去填写」直接打开设置页的「账号与 Key」
document.addEventListener('click', (e) => e.target.closest('[data-fix]') && chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#accounts') }));

WDub.getSettings().then(render);
WDub.onSettingsChanged(render);

document.querySelectorAll('select[data-k]').forEach((el) => el.addEventListener('change', () => WDub.setSetting(el.dataset.k, el.value)));
document.querySelectorAll('input[type=checkbox][data-k]').forEach((el) => el.addEventListener('change', () => WDub.setSetting(el.dataset.k, el.checked)));
document.querySelectorAll('.seg[data-k]').forEach((seg) =>
  seg.addEventListener('click', (e) => e.target.dataset.v && WDub.setSetting(seg.dataset.k, e.target.dataset.v))
);

// ---------- 当前标签页的状态 ----------

let tabId = null;
async function refreshState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  let st = null;
  try {
    st = await chrome.tabs.sendMessage(tabId, { ask: 'state' });
  } catch {}
  showState(st);
}

function showState(st) {
  cast.update({ speakers: st?.speakers || [], currentCue: st?.currentCue || null,
    job: st?.job || null, video: st?.video, phase: st?.phase || '' });
  const el = $('#state'), text = el.querySelector('span');
  const set = (cls, msg) => {
    el.className = `state ${cls}`;
    text.textContent = msg;
  };
  const active = st && ['preparing', 'playing'].includes(st.phase);
  const mode = st?.mode || 'dub';
  $('#toggle').disabled = globalThis.WDubMobile || !st?.hasVideo;
  // 和视频上的面板一致：运行中按钮变成灰色的「停止」
  $('#toggle').textContent = globalThis.WDubMobile ? '请在视频页点 W 开始' : active ? '停止' : '开始';
  $('#toggle').classList.toggle('primary', !active);
  $('#toggle').classList.toggle('stop', active);
  if (!st) return set('err', '这个页面用不了：浏览器内部页面，或者需要刷新一下');
  if (!st.hasVideo) return set('', '这个页面没有找到视频');
  const progress = st.total ? ` · 已翻译 ${st.translated}/${st.total} 句` : '';
  if (st.phase === 'preparing') return set('busy', (st.message || '正在准备…') + progress);
  if (st.phase === 'playing') return set('on', (mode === 'dub' ? '正在中文配音' : '中文字幕已开启') + progress);
  if (st.phase === 'error') return set('err', st.message || '出错了');
  set('', '找到视频了，点下面开始');
}

refreshState();
setInterval(refreshState, 800);

async function sendCmd(cmd, payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { cmd, payload });
    setTimeout(refreshState, 150);
  } catch {
    showState(null);
  }
}
$('#toggle').addEventListener('click', () => sendCmd('toggle-main'));
$('#openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#openOptions2').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#openPlayer').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('player/player.html') }));
$('#openStudy').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('study/history.html') }));
