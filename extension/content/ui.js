// 悬浮球 + 控制面板。全部放在 Shadow DOM 里，和网页样式互不影响。
(function () {
  const WDub = globalThis.WDub;

  const LOGO = WDub.mark();

  const CSS = `
  ${WDub.HOST_THEME_CSS}
  :host { all: initial; }
  * { box-sizing: border-box; font-family: var(--font); }
  .ball { position: fixed; width: 46px; height: 46px; border-radius: 50%; z-index: 2147483647; cursor: grab; color: var(--text);
    display: grid; place-items: center; background: var(--glass-hi), var(--glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    box-shadow: var(--shadow), inset 0 0 0 1px var(--line-strong);
    transition: transform .18s ease, box-shadow .18s ease, opacity .2s; opacity: .85; user-select: none; touch-action: none; }
  .ball:hover { transform: scale(1.06); opacity: 1; }
  .ball svg { width: 26px; height: 26px; }
  .ball::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; border: 1.5px solid transparent; transition: border-color .2s; }
  .ball.playing { opacity: 1; box-shadow: var(--shadow), inset 0 0 0 1px var(--line-strong), 0 0 26px -6px var(--accent); }
  .ball.playing::after { border-color: color-mix(in srgb, var(--accent) 70%, transparent); }
  .ball.preparing::after { border-color: var(--line); border-top-color: var(--accent); animation: spin .9s linear infinite; }
  .ball.error::before { content: ""; position: absolute; top: 2px; right: 2px; width: 9px; height: 9px; border-radius: 50%; background: var(--danger); box-shadow: 0 0 0 2px var(--bg); }
  @keyframes spin { to { transform: rotate(360deg); } }

  .panel { position: fixed; width: 320px; max-height: min(640px, calc(100vh - 32px)); overflow: auto; z-index: 2147483647;
    background: var(--glass-hi), var(--glass); backdrop-filter: blur(18px) saturate(1.3); -webkit-backdrop-filter: blur(18px) saturate(1.3);
    color: var(--text); border-radius: var(--radius); box-shadow: var(--shadow), inset 0 0 0 1px var(--line-strong);
    padding: 14px; font-size: 13px; line-height: 1.5; opacity: 0; transform: translateY(6px) scale(.98); pointer-events: none;
    transition: opacity .18s cubic-bezier(.16,1,.3,1), transform .18s cubic-bezier(.16,1,.3,1); scrollbar-width: thin; }
  .panel.open { opacity: 1; transform: none; pointer-events: auto; }
  @media (max-width: 600px) {
    .panel { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); padding-bottom: env(safe-area-inset-bottom); }
    .main-btn { min-height: 48px; }
    .seg button, select, .tool { min-height: 38px; }
    .ball { width: 50px; height: 50px; }
  }
  .head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .head svg { width: 24px; height: 24px; }
  .brand { font-family: var(--display); font-size: 17px; letter-spacing: .5px; }
  .chip { margin-left: auto; font-size: 11px; padding: 2px 8px; border-radius: 99px; background: var(--field); color: var(--muted); }
  .chip.on { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
  .chip.err { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
  .icon-btn { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 5px; border-radius: var(--radius); line-height: 0; }
  .icon-btn:hover { background: var(--field); color: var(--text); }

  /* 主按钮：冰白底深色字（亮色主题下反过来） */
  .main-btn { width: 100%; height: 42px; border: 0; border-radius: var(--radius); cursor: pointer; font-size: 14.5px; font-weight: 500; letter-spacing: 1px;
    color: var(--primary-ink); background: var(--primary); transition: filter .15s, transform .1s; }
  .main-btn:hover { filter: brightness(1.06); }
  .main-btn:active { transform: scale(.985); }
  .main-btn.stop { background: var(--field); color: var(--text); box-shadow: inset 0 0 0 1.5px var(--line-strong); }
  .status { min-height: 18px; margin: 8px 2px 4px; color: var(--muted); font-size: 12px; }
  .status.err { color: var(--danger); }
  .bar { height: 3px; border-radius: 3px; background: var(--field); overflow: hidden; margin: 0 2px 10px; }
  .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--accent), var(--accent-2)); box-shadow: 0 0 8px var(--accent); transition: width .3s; }

  .row { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
  .row > label { width: 64px; flex: none; color: var(--muted); font-size: 12px; }
  select { flex: 1; min-width: 0; height: 30px; border-radius: var(--radius); border: 0; background: var(--field); color: var(--text);
    padding: 0 8px; font-size: 12.5px; outline: none; box-shadow: inset 0 0 0 1.5px var(--line); }
  select:focus { box-shadow: inset 0 0 0 1.5px var(--line-strong); }
  option { background: var(--bg); color: var(--text); }
  .seg.wmode { display: grid; margin-top: 8px; }
  .seg { flex: 1; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; background: var(--field); border-radius: var(--radius); padding: 2px;
    box-shadow: inset 0 0 0 1px var(--line); }
  .seg button { height: 26px; border: 0; background: transparent; color: var(--muted); border-radius: 4px; cursor: pointer; font-size: 12px; }
  .seg button:hover { color: var(--text); }
  .seg button.on { background: var(--field-hi); color: var(--text); box-shadow: inset 0 0 0 1px var(--line-strong); }
  input[type=range] { flex: 1; accent-color: var(--accent); height: 4px; }
  .sub-colors { display: flex; align-items: center; gap: 12px; flex: 1; }
  .sub-colors label { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 11px; cursor: pointer; }
  .sub-colors input { width: 31px; height: 29px; padding: 2px; border: 1px solid var(--line); border-radius: 5px;
    background: var(--field); cursor: pointer; }
  .row.disabled { opacity: .35; pointer-events: none; }
  .val { width: 34px; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; font-size: 12px; }
  /* 「更多设置」：默认收起，展开时平滑撑开 */
  .more-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; margin-top: 6px; padding: 8px 2px; border: 0;
    background: transparent; color: var(--muted); font-size: 12px; cursor: pointer; border-top: 1px solid var(--line); }
  .more-toggle:hover { color: var(--text); }
  .more-toggle .wi { width: 16px; height: 16px; transition: transform .2s; }
  .more-toggle.open .wi { transform: rotate(180deg); }
  .more { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .22s ease; }
  .more.open { grid-template-rows: 1fr; }
  .more > div { overflow: hidden; }
  .term-toggle { width: 100%; margin: 8px 0 2px; padding: 8px 10px; text-align: left; border: 1px solid var(--line);
    border-radius: var(--radius); background: var(--field); color: var(--text); cursor: pointer; font-size: 12px; }
  .term-toggle span { color: var(--muted); font-size: 11px; }
  .term-panel { padding: 7px 9px 10px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--field); }
  .term-panel[hidden] { display: none; }
  .term-hint { color: var(--muted); font-size: 11px; margin: 4px 0 7px; }
  .term-pack-list { display: grid; gap: 3px; }
  .term-pack-list label { display: flex; align-items: center; gap: 6px; font-size: 11.5px; }
  .term-pack-list input { accent-color: var(--accent); }
  .term-personal { max-height: 130px; overflow: auto; }
  .term-personal-row, .term-add { display: flex; gap: 4px; margin-top: 5px; }
  .term-personal-row input, .term-add input { min-width: 0; width: 42%; height: 28px; border: 1px solid var(--line); border-radius: 4px;
    background: var(--glass); color: var(--text); padding: 0 6px; font-size: 11px; }
  .term-add button { flex: none; border: 0; border-radius: 4px; background: var(--primary); color: var(--primary-ink); font-size: 11px; cursor: pointer; }
  .term-label { margin-top: 8px; font-size: 11px; color: var(--muted); }
  .tools { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 8px; padding-top: 10px; border-top: 1px solid var(--line); }
  .tool { border: 0; background: transparent; color: var(--muted); border-radius: var(--radius); padding: 7px 2px 6px; cursor: pointer; font-size: 11px;
    display: flex; flex-direction: column; align-items: center; gap: 5px; transition: background .15s, color .15s; }
  .tool:hover { background: var(--field); color: var(--text); }
  .wi { width: 18px; height: 18px; display: block; }
  .icon-btn .wi { width: 16px; height: 16px; }
  /* 配音声音 + 多人配音（WDub.CastEditor，和工具栏弹窗共用） */
  .play { flex: none; width: 30px; height: 30px; border: 0; border-radius: var(--radius); background: var(--field); color: var(--muted); cursor: pointer; font-size: 11px; }
  .play:hover { color: var(--text); box-shadow: inset 0 0 0 1px var(--line-strong); }
  .grow { flex: 1; font-size: 11.5px; color: var(--faint); }
  .switch { position: relative; width: 34px; height: 20px; flex: none; }
  .switch input { opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; position: absolute; z-index: 1; }
  .switch span { position: absolute; inset: 0; border-radius: 99px; background: var(--field); box-shadow: inset 0 0 0 1px var(--line); transition: background .2s; }
  .switch span::after { content: ""; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--muted); transition: transform .2s, background .2s; }
  .switch input:checked + span { background: var(--primary); }
  .switch input:checked + span::after { transform: translateX(14px); background: var(--primary-ink); }
  .people[hidden] { display: none; }
  .detect-toggle { width: 100%; margin: 4px 0 2px; }
  .detect-panel[hidden] { display: none; }
  .person { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
  .person input { width: 74px; flex: none; height: 30px; border-radius: var(--radius); border: 0; background: var(--field); color: var(--text);
    padding: 0 8px; font-size: 12.5px; outline: none; box-shadow: inset 0 0 0 1.5px var(--line); }
  .person input:focus { box-shadow: inset 0 0 0 1.5px var(--line-strong); }
  .person .rm { flex: none; width: 22px; height: 30px; border: 0; background: transparent; color: var(--faint); cursor: pointer; }
  .person .rm:hover { color: var(--danger); }
  .detect-row { display: flex; gap: 6px; margin: 4px 0 2px; }
  .detect { flex: 1; height: 30px; border: 0; border-radius: var(--radius); cursor: pointer; font-size: 12.5px; font-weight: 500;
    background: color-mix(in srgb, var(--accent) 18%, var(--field)); color: var(--text); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent); }
  .detect:hover { box-shadow: inset 0 0 0 1px var(--accent); }
  .detect:disabled { opacity: .6; cursor: progress; }
  select.count { flex: none; width: 92px; font-size: 12px; }
  .job { margin: 6px 0; font-size: 11.5px; color: var(--muted); line-height: 1.6; }
  .job:empty { display: none; }
  .job.err { color: var(--danger); }
  .person.found .who { width: 74px; flex: none; display: flex; flex-direction: column; line-height: 1.25; overflow: hidden; }
  .person.found .who b { font-size: 12.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .person.found .who small { font-size: 10.5px; color: var(--faint); white-space: nowrap; }
  .person .play { width: 26px; }
  .cue-fix { margin: 8px 0; padding: 8px; border-radius: var(--radius); background: var(--field); }
  .cue-fix[hidden] { display: none; }
  .cue-nav, .cue-fields { display: flex; align-items: center; gap: 5px; }
  .cue-nav { margin-bottom: 6px; }
  .cue-text { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
  .cue-fix button { border: 0; border-radius: var(--radius); padding: 5px 7px; background: var(--glass); color: var(--text); cursor: pointer; font-size: 11px; }
  .cue-fix .apply { background: var(--primary); color: var(--primary-ink); }
  .cue-fix select { min-width: 0; flex: 1; font-size: 11px; }
  .cue-note { margin-top: 5px; font-size: 10px; color: var(--muted); }
  .people .add { border: 0; background: transparent; color: var(--muted); font-size: 12px; cursor: pointer; padding: 2px 0 4px; }
  .people .add:hover { color: var(--text); }
  .foot { display: flex; justify-content: space-between; margin-top: 10px; font-size: 11px; color: var(--faint); }
  .foot a { color: var(--muted); cursor: pointer; text-decoration: none; }
  .foot a:hover { color: var(--text); }
  `;

  class FloatingUI {
    constructor(handlers) {
      this.h = handlers;
      this.host = document.createElement('div');
      this.host.className = 'wdub-ui-host';
      this.root = this.host.attachShadow({ mode: 'closed' });
      WDub.setHTML(this.root, `<style>${CSS}</style>
        <div class="ball" title="W 声幕（Alt+D 开关配音）">${LOGO}</div>
        <div class="panel" role="dialog" aria-label="W 声幕">
          <div class="head">${LOGO}<span class="brand">W 声幕</span><span class="chip">未开启</span>
            <button class="icon-btn" data-act="close" title="收起">${WDub.ICONS.close}</button></div>
          <button class="main-btn">开始</button>
          <div class="seg wmode" data-k="wMode"><button data-v="dub">配音 + 字幕</button><button data-v="subtitle">只翻字幕</button></div>
          <div class="status"></div>
          <div class="bar"><i></i></div>
          <button class="term-toggle" data-act="terms">术语词表：<span class="term-summary">播放后自动选择</span></button>
          <div class="term-panel" hidden>
            <div class="row"><label>选择方式</label><select data-k="rules.packMode"><option value="auto">按视频自动</option><option value="manual">手动固定</option></select></div>
            <div class="term-hint"></div><div class="term-pack-list"></div>
            <div class="term-label">我的译法（只在 AI 翻译时生效）</div>
            <div class="term-personal"></div>
            <div class="term-add"><input aria-label="原文词语" placeholder="原文，如 AI agent"><input aria-label="中文译法" placeholder="译法，如 AI 智能体"><button type="button">添加</button></div>
          </div>
          <div class="row"><label>字幕</label><div class="seg" data-k="subtitle.mode">
            <button data-v="bilingual">双语</button><button data-v="translated">仅中文</button><button data-v="off">关闭</button></div></div>
          <div class="sub-style"></div>
          <div class="row"><label>原声</label><div class="seg" data-k="audio.originalMode">
            <button data-v="duck">保留原声</button><button data-v="mute">静音原声</button></div></div>
          <button class="more-toggle" data-act="more"><span>更多设置</span>${WDub.ICONS.chevron}</button>
          <div class="more"><div>
            <div class="row"><label>翻译成</label><select data-k="targetLang"></select></div>
            <div class="row"><label>翻译</label><select data-k="translator">
              <option value="google">Google（免费）</option><option value="llm">AI 大模型</option></select></div>
            <div class="row voice-row"><label>声音</label><select data-k="tts.engine">
              <option value="system">系统声音（免费）</option><option value="azure">Azure 神经语音</option><option value="elevenlabs">ElevenLabs</option></select></div>
            <div class="row"><label>配音音量</label><input type="range" min="0" max="1" step="0.05" data-k="audio.dubVolume"><span class="val"></span></div>
            <div class="row orig-vol"><label>原声音量</label><input type="range" min="0" max="1" step="0.05" data-k="audio.originalVolume"><span class="val"></span></div>
          </div></div>
          <div class="tools">
            <button class="tool" data-act="import">${WDub.ICONS.import}导入字幕</button>
            <button class="tool" data-act="export">${WDub.ICONS.export}导出译文</button>
            <button class="tool" data-act="summary">${WDub.ICONS.summary}学习纪要</button>
            <button class="tool" data-act="options">${WDub.ICONS.settings}全部设置</button>
          </div>
          <div class="foot"><a data-act="hide-site">在此网站隐藏 W 按钮</a><span>Alt+D 配音 · Alt+T 字幕</span></div>
          <input type="file" accept=".srt,.vtt,.txt" hidden>
        </div>`);
      document.documentElement.appendChild(this.host);
      this.ball = this.$('.ball');
      this.panel = this.$('.panel');
      this.$('select[data-k=targetLang]').append(
        ...WDub.LANGS.filter(([c]) => c !== 'auto').map(([c, n]) => Object.assign(document.createElement('option'), { value: c, textContent: n }))
      );
      // 「声音」下面：配音声音 + 多人配音
      this.$('.sub-style').replaceWith(this.subtitleControls());
      this.cast = new WDub.CastEditor({ rowClass: 'row', onSave: (k, v) => this.h.onSetting(k, v), onTry: (voice) => this.h.onTryVoice(voice),
        onDetect: () => this.h.onDetectSpeakers(), onCorrect: (fix) => this.h.onCorrectCue(fix), onJump: (delta) => this.h.onJumpCue(delta),
        allowDetect: !globalThis.WDubMobile });
      this.$('.voice-row').after(this.cast.el);
      if (globalThis.WDubMobile) {
        this.$('select[data-k="tts.engine"] option[value="system"]')?.remove();
        this.$('.foot span').textContent = '点 W 开始配音';
      }
      this.bind();
      this.restorePosition();
      chrome.storage.local.get('panelMore').then((r) => this.setMore(!!r.panelMore), () => {});
    }

    $(sel) {
      return this.root.querySelector(sel);
    }

    subtitleControls() {
      const wrap = document.createElement('div');
      wrap.className = 'sub-style';
      const row = (label, ...nodes) => {
        const line = document.createElement('div');
        line.className = 'row';
        const name = document.createElement('label');
        name.textContent = label;
        line.append(name, ...nodes);
        return line;
      };
      const size = document.createElement('input');
      size.type = 'range';
      size.min = '14';
      size.max = '44';
      size.step = '1';
      size.dataset.k = 'subtitle.fontSize';
      const px = document.createElement('span');
      px.className = 'val';
      size.addEventListener('input', () => {
        const n = Number(size.value);
        px.textContent = String(n);
        this.h.onSetting('subtitle.fontSize', n);
      });
      const look = document.createElement('select');
      look.dataset.look = 'subtitle';
      const custom = document.createElement('option');
      custom.value = '';
      custom.textContent = '自定义';
      custom.hidden = true;
      look.append(custom);
      for (const item of WDub.SUBTITLE_PRESETS) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.title;
        look.append(option);
      }
      look.addEventListener('change', () => {
        const item = WDub.SUBTITLE_PRESETS.find((entry) => entry.id === look.value);
        if (!item) return;
        WDub.setSettings(Object.fromEntries(Object.entries(item.style).map(([key, value]) => [`subtitle.${key}`, value])));
      });
      const colors = document.createElement('div');
      colors.className = 'sub-colors';
      for (const [label, key] of [['中文', 'translatedColor'], ['原文', 'originalColor']]) {
        const field = document.createElement('label');
        field.textContent = label;
        const input = document.createElement('input');
        input.type = 'color';
        input.dataset.k = `subtitle.${key}`;
        input.setAttribute('aria-label', `${label}字幕颜色`);
        input.addEventListener('input', () => this.h.onSetting(`subtitle.${key}`, input.value));
        field.append(input);
        colors.append(field);
      }
      wrap.append(row('字号', size, px), row('样式', look), row('颜色', colors));
      return wrap;
    }

    bind() {
      // 悬浮球：拖动 + 点击打开面板
      let drag = null;
      this.ball.addEventListener('pointerdown', (e) => {
        drag = { x: e.clientX, y: e.clientY, left: this.ball.offsetLeft, top: this.ball.offsetTop, moved: false };
        this.ball.setPointerCapture(e.pointerId);
      });
      this.ball.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) this.moveBall(drag.left + dx, drag.top + dy);
      });
      this.ball.addEventListener('pointerup', () => {
        if (drag && !drag.moved) this.togglePanel();
        else if (drag) this.snapBall();
        drag = null;
      });

      this.$('.main-btn').addEventListener('click', () => this.h.onToggle());
      // 在面板里打字（比如人物名）时，按键不传给网页：否则 YouTube 会把 F、K、空格当成快捷键
      for (const type of ['keydown', 'keyup', 'keypress']) this.panel.addEventListener(type, (e) => e.stopPropagation());
      this.root.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        if (act === 'close') this.togglePanel(false);
        if (act === 'more') this.setMore(!this.$('.more').classList.contains('open'), true);
        if (act === 'terms') {
          this.$('.term-panel').hidden = !this.$('.term-panel').hidden;
          this.renderTerms(this.settings, true);
          setTimeout(() => this.positionPanel(this.anchor), 0);
        }
        if (act === 'import') this.$('input[type=file]').click();
        if (act === 'export') this.h.onExport();
        if (act === 'summary') this.h.onSummary();
        if (act === 'options') this.h.onOptions();
        if (act === 'hide-site') this.h.onHideSite();
      });
      this.$('input[type=file]').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (f) this.h.onImport(await f.text(), f.name);
        e.target.value = '';
      });
      this.root.querySelectorAll('select[data-k]').forEach((el) => el.addEventListener('change', () => this.h.onSetting(el.dataset.k, el.value)));
      this.$('.term-add button').addEventListener('click', async () => {
        const [src, dst] = this.root.querySelectorAll('.term-add input');
        if (!src.value.trim() || !dst.value.trim()) return;
        await this.h.onAddTerm(src.value.trim(), dst.value.trim());
        src.value = dst.value = '';
      });
      this.root.querySelectorAll('.term-add input').forEach((input) => input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.$('.term-add button').click(); }
      }));
      this.root.querySelectorAll('input[type=range][data-k^="audio."]').forEach((el) =>
        el.addEventListener('input', () => {
          el.nextElementSibling.textContent = Math.round(el.value * 100);
          this.h.onSetting(el.dataset.k, Number(el.value));
        })
      );
      this.root.querySelectorAll('.seg[data-k]').forEach((seg) =>
        seg.addEventListener('click', (e) => {
          const v = e.target.dataset.v;
          if (v) this.h.onSetting(seg.dataset.k, v);
        })
      );
      document.addEventListener('pointerdown', (e) => {
        const path = e.composedPath();
        if (this.panel.classList.contains('open') && !path.includes(this.host) && !path.some((n) => n.dataset?.wdubOpener)) this.togglePanel(false);
      });
      // 全屏时把整个界面挂到全屏元素里，否则面板会被挡住
      document.addEventListener('fullscreenchange', () => {
        const parent = document.fullscreenElement || document.documentElement;
        if (this.host.parentNode !== parent) parent.appendChild(this.host);
        if (this.panel.classList.contains('open')) this.positionPanel(this.anchor);
      });
    }

    // 「更多设置」展开状态会记住，下次打开面板保持一致
    setMore(open, save) {
      this.$('.more').classList.toggle('open', open);
      this.$('.more-toggle').classList.toggle('open', open);
      this.$('.more-toggle span').textContent = open ? '收起' : '更多设置';
      if (save) chrome.storage.local.set({ panelMore: open }).catch(() => {});
      // 展开动画结束后按新高度重新摆放（向上弹出的面板不会盖住按钮）
      if (this.panel.classList.contains('open')) setTimeout(() => this.positionPanel(this.anchor), 240);
    }

    get(obj, path) {
      return path.split('.').reduce((o, k) => o?.[k], obj);
    }

    sync(s) {
      this.settings = s;
      this.root.querySelectorAll('select[data-k]').forEach((el) => (el.value = this.get(s, el.dataset.k)));
      this.root.querySelectorAll('input[type=range][data-k^="audio."]').forEach((el) => {
        el.value = this.get(s, el.dataset.k);
        el.nextElementSibling.textContent = Math.round(el.value * 100);
      });
      const sizeInput = this.$('input[data-k="subtitle.fontSize"]');
      if (sizeInput) {
        const px = Number(s.subtitle?.fontSize) || 24;
        sizeInput.value = String(px);
        sizeInput.nextElementSibling.textContent = String(px);
      }
      const look = this.$('select[data-look="subtitle"]');
      if (look) {
        look.value = WDub.subtitlePresetId(s.subtitle);
      }
      this.root.querySelectorAll('input[type="color"][data-k^="subtitle."]').forEach((input) => {
        if (this.root.activeElement !== input) input.value = this.get(s, input.dataset.k);
      });
      this.root.querySelectorAll('.seg[data-k]').forEach((seg) => {
        const v = this.get(s, seg.dataset.k);
        seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      });
      // 静音原声时，原声音量滑块没有意义
      this.$('.orig-vol').classList.toggle('disabled', s.audio.originalMode === 'mute');
      this.cast.update({ s });
      this.renderTerms(s, true);
      // 引擎、目标语言或 ElevenLabs key 变了才重新要声音列表
      const vsig = [WDub.ttsEngine(s), s.targetLang, s.keys.elevenlabs].join('|');
      if (vsig !== this.vsig) {
        this.vsig = vsig;
        this.h.onVoices().then((r) => r && vsig === this.vsig && this.cast.update(r)).catch(() => {});
      }
    }

    renderTerms(s, redrawPersonal = false) {
      if (!s) return;
      const auto = s.rules.packMode !== 'manual';
      const selected = auto ? (this.termState?.termPacks || []) : WDub.enabledPackIds(s);
      const titles = selected.map((id) => WDub.TERM_PACKS.find((p) => p.id === id)?.title).filter(Boolean);
      this.$('.term-summary').textContent = auto ? (this.termState ? `${titles.join(' · ') || '未匹配'}（${this.termState.termSource === 'ai' ? 'AI' : '本地'}）` : '播放后自动选择') : `手动 · ${titles.join(' · ') || '未选'}`;
      this.$('.term-hint').textContent = auto
        ? `本视频：${titles.join('、') || '未匹配主题'}。${this.termState?.termSource === 'ai' ? '由 AI 判断' : '由本地关键词判断'}；勾选会切换为手动。`
        : '勾选的词表会用于之后播放的视频。';
      if (!s.rules.enabled) this.$('.term-hint').textContent += ' 术语规则已关闭。';
      else if (s.translator !== 'llm' || this.termTranslationEngine === 'google') this.$('.term-hint').textContent += ' 当前使用 Google 翻译，词表暂不生效。';
      const sig = `${auto}|${selected.join(',')}`;
      if (sig !== this.termSig) {
        this.termSig = sig;
        const host = this.$('.term-pack-list');
        host.replaceChildren();
        for (const pack of WDub.TERM_PACKS.filter((p) => p.auto)) {
          const label = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'checkbox'; input.checked = selected.includes(pack.id);
          input.addEventListener('change', () => {
            const next = new Set(selected);
            if (input.checked) next.add(pack.id); else next.delete(pack.id);
            this.h.onTermPacks([...next]);
          });
          label.append(input, document.createTextNode(pack.title));
          host.append(label);
        }
      }
      if (!redrawPersonal) return;
      const host = this.$('.term-personal');
      host.replaceChildren();
      const rows = s.rules.glossary || [];
      for (let i = Math.max(0, rows.length - 5); i < rows.length; i++) {
        const row = document.createElement('div'); row.className = 'term-personal-row';
        for (const field of ['src', 'dst']) {
          const input = document.createElement('input');
          input.value = rows[i][field] || '';
          input.setAttribute('aria-label', field === 'src' ? '原文词语' : '中文译法');
          input.addEventListener('change', () => this.h.onEditTerm(i, field, input.value.trim()));
          row.append(input);
        }
        host.append(row);
      }
    }

    // 视频里认出的说话人（面板开着时每秒刷新一次，AI 翻译时会陆续认出新的人）
    refreshSpeakers() {
      clearInterval(this.speakerTimer);
      if (!this.panel.classList.contains('open')) return;
      const tick = () => (this.panel.classList.contains('open') ? this.cast.update(this.h.getSpeakers()) : clearInterval(this.speakerTimer));
      tick();
      this.speakerTimer = setInterval(tick, 1000);
    }

    setState({ phase, message, translated, total, engine, mode = 'dub', termPacks, termSource }) {
      this.termTranslationEngine = phase === 'idle' || phase === 'preparing' ? '' : engine || this.termTranslationEngine;
      if (Array.isArray(termPacks)) this.termState = { termPacks, termSource };
      else if (phase === 'idle' || phase === 'stopped' || phase === 'preparing') this.termState = null;
      this.renderTerms(this.settings);
      const chip = this.$('.chip');
      const status = this.$('.status');
      const active = phase === 'preparing' || phase === 'playing';
      this.ball.classList.toggle('playing', phase === 'playing');
      this.ball.classList.toggle('preparing', phase === 'preparing');
      this.ball.classList.toggle('error', phase === 'error');
      // 主按钮：没在运行时是「开始」，运行中变成「停止」
      const btn = this.$('.main-btn');
      btn.textContent = active ? (phase === 'preparing' ? '停止（准备中…）' : '停止') : '开始';
      btn.classList.toggle('stop', active);
      chip.className = `chip${phase === 'playing' ? ' on' : phase === 'error' ? ' err' : ''}`;
      const playing = mode === 'subtitle' ? (total && translated < total ? '字幕翻译中' : '字幕已就绪') : '配音中';
      chip.textContent = { preparing: '准备中', playing, error: '出错了', stopped: '未开启', idle: '未开启' }[phase] || '未开启';
      status.classList.toggle('err', phase === 'error');
      if (message) status.textContent = message;
      else if (total) status.textContent = `已翻译 ${translated}/${total} 句 · ${engine === 'llm' ? 'AI 翻译' : 'Google 翻译'}`;
      else if (!active) status.textContent = '';
      this.$('.bar i').style.width = total ? `${(translated / total) * 100}%` : '0';
      this.cast.update({ phase, ...this.h.getSpeakers() });
    }

    togglePanel(open = !this.panel.classList.contains('open')) {
      if (open) this.positionPanel(null);
      this.panel.classList.toggle('open', open);
      this.refreshSpeakers();
    }

    // 从播放栏里的设置按钮打开：面板贴着按钮弹出
    openAt(el) {
      if (this.panel.classList.contains('open') && this.anchor === el) return this.togglePanel(false);
      this.positionPanel(el);
      this.panel.classList.add('open');
      this.refreshSpeakers();
    }

    positionPanel(anchorEl) {
      this.anchor = anchorEl;
      if (globalThis.WDubMobile && window.innerWidth <= 600) {
        Object.assign(this.panel.style, {
          left: '8px', top: '8px', maxHeight: 'calc(100dvh - 16px)'
        });
        return;
      }
      const w = 320, gap = 10, vh = window.innerHeight;
      const full = Math.min(this.panel.scrollHeight, 640);
      let left, top, room;
      if (anchorEl) {
        const r = anchorEl.getBoundingClientRect();
        if (r.top < vh / 2) {
          // 入口在上方（YouTube 右上角的「设置」）：右边对齐，向下展开；放不下就在面板里滚动，不盖住入口
          left = r.right - w;
          top = r.bottom + 8;
          room = vh - top - 16;
        } else {
          // 入口在播放栏里：向上弹出
          left = r.left + r.width / 2 - w + 40;
          room = r.top - 10 - 16;
          top = r.top - 10 - Math.min(full, room);
        }
      } else {
        const b = this.ball.getBoundingClientRect();
        left = b.left > window.innerWidth / 2 ? b.left - w - gap : b.right + gap;
        room = vh - 32;
        top = Math.min(Math.max(16, b.top - 40), vh - Math.min(full, room) - 16);
      }
      left = Math.min(Math.max(16, left), window.innerWidth - w - 16);
      Object.assign(this.panel.style, { left: `${left}px`, top: `${Math.max(16, top)}px`, maxHeight: `${Math.max(240, Math.min(640, room))}px` });
    }

    moveBall(x, y) {
      const max = (v, lim) => Math.min(Math.max(v, 6), lim - 52);
      Object.assign(this.ball.style, { left: `${max(x, window.innerWidth)}px`, top: `${max(y, window.innerHeight)}px` });
    }

    snapBall() {
      const r = this.ball.getBoundingClientRect();
      const x = r.left + 23 < window.innerWidth / 2 ? 12 : window.innerWidth - 58;
      this.moveBall(x, r.top);
      const pos = { side: x < 100 ? 'left' : 'right', y: r.top / window.innerHeight };
      chrome.storage.local.set({ ballPos: pos }).catch(() => {});
    }

    async restorePosition() {
      let pos = { side: 'right', y: 0.62 };
      try {
        pos = (await chrome.storage.local.get('ballPos')).ballPos || pos;
      } catch {}
      this.moveBall(pos.side === 'left' ? 12 : window.innerWidth - 58, pos.y * window.innerHeight);
    }

    // 只隐藏悬浮球；面板仍可从 YouTube 右上角或播放栏里的设置按钮打开
    setBallVisible(v) {
      this.ball.style.display = v ? '' : 'none';
    }

    destroy() {
      this.host.remove();
    }
  }

  WDub.FloatingUI = FloatingUI;
})();
