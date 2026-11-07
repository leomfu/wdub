// 视频旁的学习纪要：按需打开，阅读时不改动网页播放器布局。
(function () {
  const WDub = globalThis.WDub;
  const CSS = `
    ${WDub.HOST_THEME_CSS}
    :host { all: initial; }
    * { box-sizing: border-box; font-family: var(--font); }
    .drawer { position: fixed; top: 0; right: 0; z-index: 2147483647; width: min(410px, 100vw); height: 100dvh;
      display: flex; flex-direction: column; background: var(--bg); color: var(--text);
      box-shadow: -18px 0 52px rgba(4, 9, 24, .28), inset 1px 0 var(--line); }
    .drawer[hidden] { display: none; }
    .head { padding: 20px 22px 14px; border-bottom: 1px solid var(--line); }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .head-actions { display: flex; align-items: center; gap: 5px; }
    .head-actions .action { padding: 6px 7px; border: 0; border-radius: 5px; background: none; color: var(--muted); font-size: 11px; }
    .head-actions .action:hover { background: var(--field); color: var(--text); }
    .brand { color: var(--accent); font-size: 12px; font-weight: 600; letter-spacing: .06em; }
    button { cursor: pointer; }
    .close { width: 32px; height: 32px; border: 1px solid var(--line); border-radius: 7px;
      background: var(--field); color: var(--text); font-size: 20px; line-height: 1; }
    .title { margin: 14px 0 6px; font-size: 21px; line-height: 1.32; font-weight: 600; overflow-wrap: anywhere; }
    .sub { color: var(--muted); font-size: 11.5px; line-height: 1.5; }
    .tabs { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid var(--line); padding: 0 12px; }
    .tabs button { height: 43px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--muted); font-size: 12px; }
    .tabs button[aria-selected='true'] { border-bottom-color: var(--accent); color: var(--text); font-weight: 600; }
    button:focus-visible, summary:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .body { flex: 1; overflow: auto; padding: 22px 22px 42px; scrollbar-width: thin; }
    .body[hidden] { display: none; }
    .message { margin: 26px 22px; padding: 16px; border-radius: 8px; background: var(--field);
      color: var(--muted); font-size: 13px; line-height: 1.7; }
    .message[hidden] { display: none; }
    .message.error { color: var(--danger); }
    .config { flex: 1; overflow: auto; padding: 18px 22px 30px; }
    .config[hidden], .drawer.configuring .tabs, .drawer.configuring .body,
    .drawer.configuring .message, .drawer.configuring .foot { display: none; }
    .config h3 { margin: 0 0 5px; font-size: 16px; }
    .config p { color: var(--muted); font-size: 12px; line-height: 1.6; }
    .config label { display: block; margin: 18px 0 6px; color: var(--muted); font-size: 12px; }
    .config select, .config input { width: 100%; height: 38px; padding: 0 10px; border: 1px solid var(--line-strong);
      border-radius: 6px; background: var(--field); color: var(--text); font-size: 12.5px; }
    .config .field[hidden] { display: none; }
    .config .hint { margin: 8px 0; }
    .config .test { margin-top: 18px; padding: 9px 13px; border: 1px solid var(--line-strong);
      border-radius: 6px; background: var(--field); color: var(--text); font-size: 12px; }
    .config .result { min-height: 18px; margin: 9px 0; color: var(--muted); }
    h3 { margin: 26px 0 11px; color: var(--text); font-size: 13px; font-weight: 600; }
    h3:first-child { margin-top: 0; }
    .lead { margin: 0; font-size: 17px; line-height: 1.65; font-weight: 500; overflow-wrap: anywhere; }
    .note { margin: 9px 0 0; color: var(--muted); font-size: 11.5px; line-height: 1.6; }
    .items { list-style: none; margin: 0; padding: 0; }
    .items li { display: flex; align-items: flex-start; gap: 10px; padding: 11px 0; border-bottom: 1px solid var(--line); }
    .items li:last-child { border-bottom: 0; }
    .copy { flex: 1; min-width: 0; color: var(--text); font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
    .time { flex: none; min-width: 42px; padding: 2px 5px; border: 1px solid var(--line); border-radius: 5px;
      background: var(--field); color: var(--accent); font: 11px/1.4 ui-monospace, Menlo, monospace; }
    .time:hover { border-color: var(--accent); }
    .time[hidden] { display: none; }
    .chapter { position: relative; padding: 2px 0 18px 23px; border-left: 1px solid var(--line-strong); margin-left: 6px; }
    .chapter::before { content: ''; position: absolute; left: -5px; top: 7px; width: 9px; height: 9px;
      border-radius: 50%; background: var(--accent); }
    .chapter:last-child { border-left-color: transparent; }
    .chapter b { display: block; margin: 7px 0 3px; font-size: 14px; font-weight: 600; }
    .chapter p { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.65; }
    .concept { padding: 13px 0; border-bottom: 1px solid var(--line); }
    .concept b { display: block; margin-bottom: 5px; font-size: 13px; }
    .concept p { margin: 0 0 7px; color: var(--muted); font-size: 12.5px; line-height: 1.65; }
    .question { border-bottom: 1px solid var(--line); padding: 11px 0; }
    .question summary { cursor: pointer; font-size: 13px; line-height: 1.55; font-weight: 500; }
    .answer { margin: 10px 0 7px; padding: 10px 12px; border-radius: 6px; background: var(--field);
      color: var(--text); font-size: 12.5px; line-height: 1.65; }
    textarea { width: 100%; min-height: 260px; padding: 14px; resize: vertical; border: 1px solid var(--line-strong);
      border-radius: 8px; background: var(--field); color: var(--text); font-size: 13px; line-height: 1.7; }
    textarea::placeholder { color: var(--muted); }
    .foot { flex: none; padding: 10px 22px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .foot span { color: var(--muted); font-size: 11px; }
    .retry { border: 0; background: none; color: var(--accent); font-size: 12px; padding: 6px 0; }
    .retry:disabled { opacity: .45; cursor: wait; }
    @media (max-width: 640px) { .drawer { top: auto; bottom: 0; width: 100vw; height: min(78dvh, 740px);
      border-radius: 14px 14px 0 0; box-shadow: 0 -14px 46px rgba(4,9,24,.3); }
      .head { padding: 14px 18px 10px; } .title { font-size: 17px; margin-top: 9px; }
      .body { padding: 17px 18px 34px; } .foot { padding: 8px 18px; } }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
  `;

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  class StudyPanel {
    constructor({ onSeek, onRetry, onTest, onHistory }) {
      this.onSeek = onSeek;
      this.onRetry = onRetry;
      this.onTest = onTest;
      this.onHistory = onHistory;
      this.host = document.createElement('div');
      this.host.className = 'wdub-study-host';
      this.root = this.host.attachShadow({ mode: 'closed' });
      WDub.setHTML(this.root, `<style>${CSS}</style><aside class="drawer" role="dialog" aria-label="视频学习纪要" hidden>
        <header class="head"><div class="top"><span class="brand">W 声幕 · 学习纪要</span><div class="head-actions">
          <button class="action model-action" type="button">模型</button><button class="action history-action" type="button">历史</button>
          <button class="close" type="button" aria-label="关闭学习纪要">×</button></div></div>
          <h2 class="title"></h2><div class="sub">用已配置的 AI 整理字幕 · 点击时间回到视频</div></header>
        <nav class="tabs" role="tablist" aria-label="学习内容">
          <button type="button" role="tab" data-tab="overview" aria-selected="true">概览</button>
          <button type="button" role="tab" data-tab="timeline" aria-selected="false">时间线</button>
          <button type="button" role="tab" data-tab="practice" aria-selected="false">学一学</button>
          <button type="button" role="tab" data-tab="notes" aria-selected="false">我的笔记</button>
        </nav><div class="message" hidden></div><main class="body" role="tabpanel"></main>
        <div class="config" hidden><h3>纪要使用哪个模型</h3><p>纪要的服务和模型单独选择；同一家服务的 API key 与翻译共用。更换后点「重新整理」才会用新模型生成。</p>
          <div class="field"><label for="study-provider">服务</label><select id="study-provider"></select></div>
          <div class="field model-field"><label for="study-model">模型名称</label><input id="study-model" list="study-model-options" spellcheck="false" /><datalist id="study-model-options"></datalist><p class="hint model-hint"></p></div>
          <div class="field url-field"><label for="study-url">接口地址</label><input id="study-url" type="url" spellcheck="false" /></div>
          <div class="field key-field"><label for="study-key">API key / 连接口令</label><input id="study-key" type="password" autocomplete="off" spellcheck="false" /></div>
          <p class="hint provider-hint"></p><button class="test" type="button">测试模型连接</button><p class="result" role="status"></p>
        </div>
        <footer class="foot"><span>AI 整理的内容请结合原片核对</span><button class="retry" type="button">重新整理</button></footer>
      </aside>`);
      this.drawer = this.root.querySelector('.drawer');
      this.body = this.root.querySelector('.body');
      this.message = this.root.querySelector('.message');
      this.tab = 'overview';
      this.root.querySelector('.close').addEventListener('click', () => this.close());
      this.root.querySelector('.retry').addEventListener('click', () => this.onRetry());
      this.root.querySelector('.history-action').addEventListener('click', () => this.onHistory());
      this.root.querySelector('.model-action').addEventListener('click', () => this.toggleConfig());
      this.bindConfig();
      this.root.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => this.selectTab(button.dataset.tab)));
      this.keydown = (event) => { if (event.key === 'Escape' && !this.drawer.hidden) { event.stopPropagation(); this.close(); } };
      document.addEventListener('keydown', this.keydown, true);
      this.fullscreen = () => this.attach();
      document.addEventListener('fullscreenchange', this.fullscreen);
      this.attach();
    }

    bindConfig() {
      const select = this.root.querySelector('#study-provider');
      select.append(...WDub.Study.providers.map(([id, label]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = label;
        return option;
      }));
      const save = (path, value) => {
        this.pendingSave = WDub.setSetting(path, value);
        this.pendingSave.catch((e) => (this.root.querySelector('.result').textContent = `保存失败：${e.message}`));
        return this.pendingSave;
      };
      select.addEventListener('change', async () => {
        await save('study.provider', select.value);
        this.renderConfig();
      });
      this.root.querySelector('#study-model').addEventListener('change', (event) =>
        save(`study.models.${select.value}`, event.target.value.trim()));
      this.root.querySelector('#study-url').addEventListener('change', (event) => {
        const path = { ollama: 'local.ollama', custom: 'study.custom.baseUrl', codex: 'study.codex.baseUrl' }[select.value];
        if (path) save(path, event.target.value.trim());
      });
      this.root.querySelector('#study-key').addEventListener('change', (event) => {
        const path = ['gemini', 'openai', 'deepseek'].includes(select.value) ? `keys.${select.value}`
          : { custom: 'study.custom.apiKey', codex: 'study.codex.token' }[select.value];
        if (path) save(path, event.target.value.trim());
      });
      this.root.querySelector('.test').addEventListener('click', async (event) => {
        const status = this.root.querySelector('.result');
        event.target.disabled = true;
        status.textContent = '正在连接模型…';
        try {
          await this.pendingSave;
          const result = await this.onTest();
          status.textContent = `连接成功：${result.model}`;
        } catch (e) { status.textContent = `连接失败：${e.message}`; }
        finally { event.target.disabled = false; }
      });
    }

    async toggleConfig(open = !this.drawer.classList.contains('configuring')) {
      this.drawer.classList.toggle('configuring', open);
      this.root.querySelector('.config').hidden = !open;
      this.root.querySelector('.model-action').textContent = open ? '返回纪要' : '模型';
      if (open) await this.renderConfig();
    }

    async showConfigError(message) {
      await this.toggleConfig(true);
      this.root.querySelector('.result').textContent = message;
    }

    async renderConfig() {
      const s = await WDub.getSettings();
      const provider = s.study.provider;
      const root = this.root;
      root.querySelector('#study-provider').value = provider;
      const modelField = root.querySelector('.model-field');
      const urlField = root.querySelector('.url-field');
      const keyField = root.querySelector('.key-field');
      modelField.hidden = provider === 'auto';
      urlField.hidden = !['ollama', 'custom', 'codex'].includes(provider);
      keyField.hidden = ['auto', 'ollama'].includes(provider);
      const choices = {
        gemini: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
        openai: ['gpt-6.1-sol', 'gpt-6-luna'],
        deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
        codex: ['gpt-6.1-sol', 'gpt-6-luna']
      }[provider] || [];
      root.querySelector('#study-model-options').replaceChildren(...choices.map((value) => {
        const option = document.createElement('option'); option.value = value; return option;
      }));
      root.querySelector('#study-model').value = s.study.models[provider] || '';
      root.querySelector('#study-model').placeholder = provider === 'codex' ? '留空使用 Codex 默认模型' : '输入模型 ID';
      root.querySelector('.model-hint').textContent = provider === 'gemini' ? '推荐 Gemini 3.8 Flash：适合长视频和综合学习。'
        : provider === 'openai' ? '推荐 GPT-6.1 Sol：适合复杂的编程、数学和物理内容。'
          : provider === 'deepseek' ? '推荐 DeepSeek V4 Flash：中文纪要与成本较均衡。'
            : provider === 'ollama' ? '填写已在 Ollama 下载的通用对话模型名称。'
              : provider === 'codex' ? '实验功能：需要自己安装 Codex CLI。可留空，跟随本机默认模型。' : '填写服务实际支持的模型 ID。';
      root.querySelector('#study-url').value = provider === 'ollama' ? s.local.ollama
        : provider === 'codex' ? s.study.codex.baseUrl : s.study.custom.baseUrl;
      root.querySelector('#study-key').value = ['gemini', 'openai', 'deepseek'].includes(provider) ? s.keys[provider]
        : provider === 'codex' ? s.study.codex.token : s.study.custom.apiKey;
      root.querySelector('.key-field label').textContent = provider === 'codex' ? '本机连接口令' : 'API key';
      const selected = WDub.Study.resolve(s);
      root.querySelector('.provider-hint').textContent = provider === 'auto'
        ? (selected.error || `当前会使用 ${selected.label} · ${selected.model}`)
        : provider === 'codex'
          ? '在项目目录运行 node tools/study-codex-server.mjs，再把显示的口令贴到上方。Codex CLI 使用你的 ChatGPT 登录，需要联网。'
          : provider === 'custom' ? '接口需兼容 OpenAI 的 /chat/completions。' : '';
    }

    attach() {
      const parent = document.fullscreenElement || document.documentElement;
      if (this.host.parentNode !== parent) parent.appendChild(this.host);
    }

    open() {
      this.attach();
      this.previousFocus = document.activeElement;
      this.drawer.hidden = false;
      this.root.querySelector('.close').focus();
    }

    close() {
      this.drawer.hidden = true;
      if (this.previousFocus?.isConnected) this.previousFocus.focus();
    }

    async setContext(url, title) {
      this.url = url;
      this.root.querySelector('.title').textContent = title || '这个视频';
      const key = `study-note:${WDub.hash(url)}`;
      this.noteKey = key;
      this.note = '';
      try {
        const saved = (await chrome.storage.local.get(key))[key];
        if (this.noteKey === key) this.note = String(saved || '').slice(0, 10000);
      } catch {}
      if (this.tab === 'notes') this.render();
    }

    setLoading() {
      this.loading = true;
      this.root.querySelector('.retry').disabled = true;
      this.body.hidden = true;
      this.message.hidden = false;
      this.message.classList.remove('error');
      this.message.textContent = '正在按视频字幕整理纪要。长视频会分段阅读，可能需要稍等。';
    }

    setError(message) {
      this.loading = false;
      this.root.querySelector('.retry').disabled = false;
      this.body.hidden = true;
      this.message.hidden = false;
      this.message.classList.add('error');
      this.message.textContent = message;
    }

    setData(result) {
      this.loading = false;
      this.root.querySelector('.retry').disabled = false;
      this.data = result.data;
      this.message.hidden = true;
      this.body.hidden = false;
      this.render();
    }

    selectTab(tab) {
      this.tab = tab;
      this.root.querySelectorAll('[data-tab]').forEach((button) => {
        const active = button.dataset.tab === tab;
        button.setAttribute('aria-selected', String(active));
      });
      if (tab === 'notes' || (this.data && !this.loading)) {
        this.message.hidden = true;
        this.body.hidden = false;
        this.render();
      }
    }

    timeButton(at) {
      const button = node('button', 'time', at == null ? '' : WDub.Study.stamp(at));
      button.type = 'button';
      button.hidden = at == null;
      button.setAttribute('aria-label', `跳转到视频 ${WDub.Study.stamp(at)}`);
      button.addEventListener('click', () => this.onSeek(at));
      return button;
    }

    heading(text) { this.body.append(node('h3', '', text)); }

    list(items) {
      const ul = node('ul', 'items');
      for (const item of items) {
        const li = node('li');
        li.append(this.timeButton(item.at), node('span', 'copy', item.text));
        ul.append(li);
      }
      this.body.append(ul);
    }

    render() {
      this.body.replaceChildren();
      const d = this.data;
      if (this.tab === 'notes') {
        this.heading('留给自己的理解');
        const input = node('textarea');
        input.value = this.note || '';
        input.placeholder = '记下你真正理解了什么、还想查什么。笔记只保存在这台设备上。';
        input.maxLength = 10000;
        input.setAttribute('aria-label', '我的视频笔记');
        input.addEventListener('input', () => {
          this.note = input.value;
          const key = this.noteKey, value = this.note;
          clearTimeout(this.noteTimers?.get(key));
          this.noteTimers ||= new Map();
          this.noteTimers.set(key, setTimeout(() => chrome.storage.local.set({ [key]: value }).catch(() => {}), 500));
        });
        this.body.append(input, node('p', 'note', '输入后自动保存；下次打开同一个视频还能继续写。'));
        return;
      }
      if (!d) return;
      if (this.tab === 'overview') {
        this.body.append(node('p', 'lead', d.oneLine || '已根据字幕整理以下要点。'),
          node('p', 'note', '时间按钮可跳回原片，便于核对上下文。'));
        if (d.keyPoints.length) { this.heading('核心要点'); this.list(d.keyPoints); }
        if (d.decisions.length) { this.heading('明确决定'); this.list(d.decisions); }
        if (d.actions.length) { this.heading('后续行动'); this.list(d.actions); }
      }
      if (this.tab === 'timeline') {
        this.heading('按时间梳理');
        if (!d.chapters.length) this.body.append(node('p', 'note', '这段视频暂未形成清晰的章节，可从概览的要点跳转。'));
        for (const chapter of d.chapters) {
          const box = node('div', 'chapter');
          box.append(this.timeButton(chapter.at), node('b', '', chapter.title), node('p', '', chapter.summary));
          this.body.append(box);
        }
      }
      if (this.tab === 'practice') {
        this.heading('关键概念');
        if (!d.concepts.length) this.body.append(node('p', 'note', '字幕里没有足够明确的概念可解释。'));
        for (const item of d.concepts) {
          const box = node('div', 'concept');
          box.append(node('b', '', item.term), node('p', '', item.explain), this.timeButton(item.at));
          this.body.append(box);
        }
        this.heading('看完试着回答');
        if (!d.questions.length) this.body.append(node('p', 'note', '这段内容暂未生成自测题。'));
        for (const item of d.questions) {
          const box = node('details', 'question');
          box.append(node('summary', '', item.q), node('div', 'answer', item.a), this.timeButton(item.at));
          this.body.append(box);
        }
      }
      this.body.scrollTop = 0;
    }

    destroy() {
      document.removeEventListener('keydown', this.keydown, true);
      document.removeEventListener('fullscreenchange', this.fullscreen);
      this.host.remove();
    }
  }

  WDub.StudyPanel = StudyPanel;
})();
