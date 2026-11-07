// 本地视频页：复用内容脚本的配音引擎，自己提供控制面板。
const { WDub } = globalThis;
const $ = (s) => document.querySelector(s);
const video = $('#video');
let hasVideo = false, hasSubs = false;

// 用本页面板代替网页里的悬浮球
const panel = {
  setState({ phase, message, translated, total, engine, mode = 'dub' }) {
    const active = phase === 'preparing' || phase === 'playing';
    const dubOn = active && mode === 'dub', subOn = active && mode === 'subtitle';
    $('#toggle').textContent = dubOn ? '停止配音' : '开始配音';
    $('#toggle').classList.toggle('primary', !dubOn);
    $('#toggleSub').textContent = subOn ? '关闭字幕翻译' : '只翻字幕';
    $('#export').disabled = !WDub.app.engine;
    $('#status').classList.toggle('err', phase === 'error');
    if (message) $('#status').textContent = message;
    else if (total) $('#status').textContent = `已翻译 ${translated}/${total} 句 · ${engine === 'llm' ? 'AI 翻译' : 'Google 翻译'}`;
    else if (!active) $('#status').textContent = hasSubs ? '准备好了，点「开始配音」。' : '先选择视频和字幕。';
    $('#bar').style.width = total ? `${(translated / total) * 100}%` : '0';
  },
  sync(s) {
    document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.subtitle.mode));
  },
  showSummary() {},
  setVisible() {}
};

let videoFile = null;
let asrCues = null;

function ready() {
  $('#toggle').disabled = $('#toggleSub').disabled = !(hasVideo && hasSubs);
  $('#recognize').hidden = !hasVideo || hasSubs;
}

// ---------- AI 识别字幕 ----------

const asrCacheKey = (f, s) => 'asr:' + WDub.hash(`${f.name}|${f.size}|${f.lastModified}|${s.asr.engine}|${s.asr[s.asr.engine]?.model || ''}|${s.asr.language}`);

async function recognize() {
  const s = await WDub.getSettings();
  const engineName = WDub.ASR_ENGINES.find(([v]) => v === s.asr.engine)?.[1].split(' · ')[0] || 'AI';
  const key = asrCacheKey(videoFile, s);
  const btn = $('#recognize');
  const say = (msg, err) => {
    $('#status').textContent = msg;
    $('#status').classList.toggle('err', !!err);
  };
  let tick;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached) return finish(cached.cues, cached.language, '（使用缓存）');
  if (videoFile.size > 2 * 1024 ** 3) return say('文件超过 2GB，浏览器内存放不下。请先用 ffmpeg 提取音频（.m4a）再拖进来识别。', true);

  btn.disabled = true;
  const started = Date.now();
  // 识别时间较长，每秒刷新一次已用时间
  let stageText = '';
  tick = setInterval(() => say(`${stageText} · 已用 ${Math.round((Date.now() - started) / 1000)} 秒`), 1000);
  try {
    const result = globalThis.WDubMobile
      ? await WDub.MobileCloud.transcribe({ file: videoFile, settings: s })
      : await WDub.ASR.transcribe(await videoFile.arrayBuffer(), s, (p) => {
        stageText =
          p.stage === 'decode' ? '正在提取音频…' : p.stage === 'recognize' ? `${engineName} 识别中${p.total > 1 ? `（第 ${p.done + 1}/${p.total} 段）` : ''}…` : '整理字幕…';
        say(stageText);
      });
    if (!result.cues.length) throw new Error('没有识别出任何语音');
    if (globalThis.WDubMobile) {
      const reviewed = await WDub.app.reviewCues(result.cues);
      if (!reviewed) return say('已取消字幕校对，视频保持原样。');
      result.cues = reviewed;
    }
    await chrome.storage.local.set({ [key]: { cues: result.cues, language: result.language, at: Date.now() } });
    finish(result.cues, result.language, `，用时 ${Math.round((Date.now() - started) / 1000)} 秒`);
  } catch (e) {
    const conf = s.asr[s.asr.engine];
    const local = /127\.0\.0\.1|localhost/.test(conf?.baseUrl || '');
    const cmd = s.asr.engine === 'sensevoice' ? 'bash tools/start-whisper.sh --sensevoice' : 'bash tools/start-whisper.sh';
    const hint = local && /fetch/i.test(e.message) ? `本地识别服务没有启动，请在终端运行：${cmd}` : e.message;
    say(`识别失败：${hint}`, true);
  } finally {
    clearInterval(tick);
    btn.disabled = false;
  }

  function finish(cues, language, note) {
    clearInterval(tick);
    asrCues = cues;
    const speakers = new Set(cues.map((c) => c.speaker).filter(Boolean)).size;
    WDub.app.importCues(cues, `AI 识别字幕`, language || s.asr.language);
    $('#subName').textContent = `AI 识别（${cues.length} 句${speakers > 1 ? ` · ${speakers} 个说话人` : ''}）`;
    $('#exportAsr').hidden = false;
    hasSubs = true;
    ready();
    say(`识别完成：${cues.length} 句${note}。点「开始配音」。`);
  }
}

function exportAsr() {
  const blob = new Blob([WDub.Subs.toSrt(asrCues, 'text')], { type: 'text/plain;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `${videoFile.name.replace(/\.[^.]+$/, '')}.srt`
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function loadVideo(file) {
  videoFile = file;
  // 上一个视频的 AI 字幕不属于新视频；手动导入的字幕保留（视频和字幕可能一起拖进来）
  if (asrCues) {
    hasSubs = false;
    $('#subName').textContent = '未选择';
  }
  asrCues = null;
  $('#exportAsr').hidden = true;
  if (video.src) URL.revokeObjectURL(video.src);
  WDub.app.stop();
  video.src = URL.createObjectURL(file);
  video.dataset.wdubFileKey = WDub.hash(`${file.name}|${file.size}|${file.lastModified}`);
  video.hidden = false;
  $('#drop').hidden = true;
  $('#videoName').textContent = file.name;
  document.title = `${file.name} · W 声幕`;
  hasVideo = true;
  WDub.app.video = video;
  ready();
}

async function loadSubs(file) {
  WDub.app.importSubtitles(await file.text(), file.name);
  if (WDub.app.imported) {
    $('#subName').textContent = `${file.name}（${WDub.app.imported.cues.length} 句）`;
    hasSubs = true;
  }
  ready();
}

function handleFiles(files) {
  for (const f of files) {
    if (/\.(srt|vtt|txt)$/i.test(f.name)) loadSubs(f);
    else if (f.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v)$/i.test(f.name)) loadVideo(f);
  }
}

$('#pickVideo').onclick = () => $('#videoFile').click();
$('#pickSub').onclick = () => $('#subFile').click();
$('#videoFile').onchange = (e) => e.target.files[0] && loadVideo(e.target.files[0]);
$('#subFile').onchange = (e) => e.target.files[0] && loadSubs(e.target.files[0]);
$('#options').onclick = () => chrome.runtime.openOptionsPage();
$('#toggle').onclick = () => WDub.app.toggle('dub');
$('#toggleSub').onclick = () => WDub.app.toggle('subtitle');
$('#recognize').onclick = () => recognize();
$('#exportAsr').onclick = () => exportAsr();
$('#export').onclick = () => WDub.app.exportSrt();
$('#mode').onclick = (e) => {
  const v = e.target.dataset.v;
  if (!v) return;
  WDub.setSetting('subtitle.mode', v);
  WDub.app.engine?.setSubtitleMode(v);
};

const stage = $('#stage');
stage.addEventListener('dragover', (e) => (e.preventDefault(), stage.classList.add('over')));
stage.addEventListener('dragleave', () => stage.classList.remove('over'));
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  stage.classList.remove('over');
  handleFiles(e.dataTransfer.files);
});

// 等 main.js 初始化完再接管面板
(async function attach() {
  while (!WDub.app?.settings) await new Promise((r) => setTimeout(r, 50));
  WDub.app.ui = panel;
  panel.sync(WDub.app.settings);
  panel.setState({ phase: 'idle' });
})();
