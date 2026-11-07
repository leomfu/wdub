// 视频上的两样东西：
// 1. VideoBar：非 YouTube 网站的 W 按钮和设置按钮，放在播放器底部播放栏的位置
// 2. LoadingCard：加载时显示在视频中下方的进度卡片（获取字幕 → 翻译 → 就绪）
(function () {
  const WDub = globalThis.WDub;


  const ICONS = {
    w: WDub.mark(),
    // 星光滑杆：和 YouTube 上的设置按钮同一个图标
    settings: `<svg viewBox="0 0 36 36"><path class="w" d="M9 14h8.5M25.5 14H27M9 22h2.5M17 22h10" fill="none" stroke-width="2.2" stroke-linecap="round"/>
      <path class="star" d="M21.5 9.2l1.25 3.55 3.55 1.25-3.55 1.25-1.25 3.55-1.25-3.55-3.55-1.25 3.55-1.25z"/><circle class="w" cx="14.2" cy="22" r="2.6" fill="none" stroke-width="2.2"/></svg>`
  };

  // 跟随 document.fullscreenElement，保证全屏时也能看见
  function keepInFullscreen(host) {
    const fix = () => {
      const parent = document.fullscreenElement || document.documentElement;
      if (host.isConnected && host.parentNode !== parent) parent.appendChild(host);
    };
    document.addEventListener('fullscreenchange', fix);
    return () => document.removeEventListener('fullscreenchange', fix);
  }

  // ---------- 播放栏按钮 ----------

  // 常见播放器的控制栏：找到就把按钮放进去，跟着播放器一起显示 / 隐藏
  const KNOWN_BARS = [
    { bar: '.bpx-player-control-bottom-right', before: '.bpx-player-ctrl-full' }, // B 站
    { bar: '.vjs-control-bar', before: '.vjs-fullscreen-control' }, // video.js
    { bar: '.plyr__controls', before: '[data-plyr="fullscreen"]' }, // Plyr
    { bar: '.jw-button-container', before: '.jw-icon-fullscreen' } // JW Player
  ];

  const BAR_CSS = `
  ${WDub.HOST_THEME_CSS}
  :host { all: initial; }
  * { box-sizing: border-box; font-family: var(--font); }
  .bar { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: var(--radius); transition: opacity .2s, transform .2s; }
  .float .bar { background: var(--glass-hi), var(--glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    box-shadow: var(--shadow), inset 0 0 0 1px var(--line-strong); color: var(--text); }
  .float.hidden .bar { opacity: 0; transform: translateY(6px); pointer-events: none; }
  /* 放进播放器自己的控制栏时，背景是视频，图标始终用白色 */
  .inline { height: 100%; display: flex; align-items: center; color: #fff; }
  button { position: relative; width: 36px; height: 36px; padding: 6px; border: 0; border-radius: var(--radius); background: transparent; color: inherit;
    cursor: pointer; display: grid; place-items: center; }
  .inline button { width: 34px; height: 34px; }
  button:hover { background: var(--field-hi); }
  .inline button:hover { background: rgba(255,255,255,.14); }
  svg { width: 100%; height: 100%; overflow: visible; }
  .w { stroke: currentColor; }
  /* 运行中：方格和印泥点亮成金色 */
  button[data-state=playing] .wl-frame { stroke: var(--accent); opacity: 1; }
  button[data-state=playing] .wl-dot { filter: drop-shadow(0 0 3px var(--accent)); }
  button[data-run=subtitle][data-state=playing] .wl-glyph { stroke: var(--accent); }
  .star { fill: var(--accent); transform-box: fill-box; transform-origin: center; transition: transform .3s; }
  button:hover .star { transform: rotate(45deg) scale(1.15); }
  /* 没能开始：印泥点变红，悬停看原因 */
  button[data-state=error] .wl-dot { fill: var(--danger) !important; }
  button[data-state=preparing]::after { content: ""; position: absolute; inset: 2px; border-radius: 50%; border: 2px solid var(--line);
    border-top-color: var(--accent); animation: spin .9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .tip { position: absolute; bottom: calc(100% + 8px); right: 0; white-space: nowrap; padding: 5px 9px; border-radius: var(--radius);
    background: var(--glass); color: var(--text); box-shadow: inset 0 0 0 1px var(--line); font-size: 12px; opacity: 0; pointer-events: none; transition: opacity .15s; }
  button:hover .tip { opacity: 1; }
  `;

  class VideoBar {
    constructor(handlers) {
      this.h = handlers;
      this.host = document.createElement('div');
      this.host.className = 'wdub-bar-host';
      // 内部是封闭的 Shadow DOM，外部点击判断看不到里面的按钮，所以在宿主上标记
      this.host.dataset.wdubOpener = '1';
      this.root = this.host.attachShadow({ mode: 'closed' });
      const btn = (act, label) => `<button data-act="${act}" data-wdub-opener="1" aria-label="${label}">${ICONS[act]}<span class="tip">${label}</span></button>`;
      WDub.setHTML(this.root, `<style>${BAR_CSS}</style><div class="wrap float hidden"><div class="bar">${btn('w', 'W 声幕')}${btn('settings', 'W 声幕设置')}</div></div>`);
      this.wrap = this.root.querySelector('.wrap');
      this.wBtn = this.root.querySelector('[data-act=w]');
      this.root.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (b.dataset.act === 'settings') this.h.onOpenSettings(b);
          else this.h.onToggle();
        })
      );
      this.onMove = this.onMove.bind(this);
      this.follow = this.follow.bind(this);
      document.addEventListener('pointermove', this.onMove, true);
      this.unFs = keepInFullscreen(this.host);
    }

    // 每次 watch 时调用：确认按钮挂在当前视频的播放栏上
    attach(video) {
      this.video = video;
      const known = this.findKnownBar(video);
      if (known) {
        if (this.host.parentNode !== known.bar) {
          this.host.style.cssText = 'display:inline-flex;height:100%;align-self:stretch;';
          const before = known.bar.querySelector(known.before);
          before?.parentNode === known.bar ? known.bar.insertBefore(this.host, before) : known.bar.appendChild(this.host);
        }
        this.wrap.className = 'wrap inline';
        cancelAnimationFrame(this.raf);
        this.raf = null;
        return;
      }
      // 没认出来的播放器：浮在视频底部右侧，鼠标移到视频上才出现
      if (this.wrap.classList.contains('inline') || !this.host.isConnected) {
        this.host.style.cssText = 'position:fixed;z-index:2147483646;';
        (document.fullscreenElement || document.documentElement).appendChild(this.host);
        this.wrap.className = 'wrap float hidden';
      }
    }

    findKnownBar(video) {
      let el = video.parentElement;
      for (let i = 0; el && i < 6; i++, el = el.parentElement) {
        for (const k of KNOWN_BARS) {
          const bar = el.querySelector(k.bar);
          if (bar) return { bar, before: k.before };
        }
      }
      return null;
    }

    get floating() {
      return this.wrap.classList.contains('float');
    }

    onMove(e) {
      if (!this.floating || !this.video?.isConnected) return;
      const r = this.video.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (inside) this.reveal();
    }

    reveal(ms = 2500) {
      this.wrap.classList.remove('hidden');
      if (!this.raf) this.raf = requestAnimationFrame(this.follow);
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        // 正在准备时一直显示，让人知道还在加载
        if (!this.busy) this.wrap.classList.add('hidden');
      }, ms);
    }

    follow() {
      this.raf = null;
      if (!this.floating || !this.video?.isConnected) return;
      const r = this.video.getBoundingClientRect();
      // 播放器自己的进度条和按钮一般占底部 40～50px，放在它正上方
      const offset = r.height > 260 ? 56 : 10;
      Object.assign(this.host.style, { left: 'auto', top: 'auto', right: `${window.innerWidth - r.right + 12}px`, bottom: `${window.innerHeight - r.bottom + offset}px` });
      if (!this.wrap.classList.contains('hidden')) this.raf = requestAnimationFrame(this.follow);
    }

    // 点 W 时做什么，显示在按钮提示里
    setWMode(wMode) {
      this.wTip = wMode === 'subtitle' ? '一键只翻字幕 · Alt+T' : '一键中文配音 + 字幕 · Alt+D';
      if (this.wBtn.dataset.state !== 'error') this.wBtn.querySelector('.tip').textContent = this.wTip;
    }

    setState(st) {
      const active = st.phase === 'preparing' || st.phase === 'playing';
      this.busy = st.phase === 'preparing';
      const error = st.phase === 'error';
      this.wBtn.dataset.state = active ? st.phase : error ? 'error' : 'idle';
      this.wBtn.dataset.run = st.mode || 'dub';
      // 出错不在视频上弹提示：W 的印泥点变红，悬停时说明原因
      this.wBtn.querySelector('.tip').textContent = error ? `没能开始：${st.message || '出错了'}（点击重试）` : this.wTip || '';
      if (this.busy) this.reveal();
    }

    destroy() {
      document.removeEventListener('pointermove', this.onMove, true);
      cancelAnimationFrame(this.raf);
      this.unFs();
      this.host.remove();
    }
  }

  // ---------- 加载进度卡片 ----------

  const CARD_CSS = `
  ${WDub.HOST_THEME_CSS}
  :host { all: initial; }
  * { box-sizing: border-box; font-family: var(--font); }
  .card { width: 100%; padding: 14px 16px 12px; border-radius: var(--radius); color: var(--text);
    background: var(--glass-hi), var(--glass); backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3);
    box-shadow: var(--shadow), inset 0 0 0 1px var(--line-strong), 0 0 70px -40px var(--accent);
    opacity: 0; transform: translateY(10px) scale(.97); transition: opacity .28s ease, transform .28s cubic-bezier(.16,1,.3,1); }
  .card.show { opacity: 1; transform: none; }
  .card.leave { opacity: 0; transform: scale(.94); transition-duration: .4s; }
  .top { display: flex; align-items: center; gap: 12px; }

  /* 左边的 WL 方印：加载时一圈金色光弧绕着转，完成时光弧合成整圈并打勾 */
  .orb { position: relative; width: 40px; height: 40px; flex: none; display: grid; place-items: center; color: var(--text); }
  .orb::before { content: ""; position: absolute; inset: -3px; border-radius: 50%;
    background: conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--accent) 30%, transparent) 120deg, var(--accent) 300deg, transparent 360deg);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px)); mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1.5px));
    animation: spin 1.1s linear infinite; }
  .orb svg { width: 28px; height: 28px; transition: opacity .25s, transform .25s; }
  .orb .check { position: absolute; width: 22px; height: 22px; opacity: 0; transform: scale(.5); color: var(--accent); }
  .orb i { position: absolute; width: 3.5px; height: 3.5px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px var(--accent); top: 50%; left: 50%;
    animation: orbit 1.6s linear infinite; }
  .orb i:nth-of-type(2) { animation-delay: -.53s; background: var(--text); box-shadow: 0 0 6px var(--text); width: 2.5px; height: 2.5px; }
  .orb i:nth-of-type(3) { animation-delay: -1.06s; width: 2.5px; height: 2.5px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes orbit { from { transform: rotate(0deg) translateX(25px) rotate(0deg); } to { transform: rotate(360deg) translateX(25px) rotate(-360deg); } }
  /* 完成：光弧合成一枚实心金印，中间打勾 */
  .done .orb::before { animation: none; background: var(--accent); -webkit-mask: none; mask: none; inset: 4px; box-shadow: 0 0 16px -2px var(--accent); }
  .done .orb .logo { opacity: 0; transform: scale(.5); }
  .done .orb .check { opacity: 1; transform: none; transition-delay: .1s; }
  .done .orb i { display: none; }

  .txt { flex: 1; min-width: 0; }
  .title { font-family: var(--display); font-size: 16px; letter-spacing: .5px; }
  .detail { margin-top: 2px; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .done .title { color: var(--accent); }
  .pct { font-size: 20px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--accent); }
  .pct:empty { display: none; }

  .bar { position: relative; height: 3px; margin: 12px 0 10px; border-radius: 3px; background: var(--field); overflow: hidden; }
  .bar b { position: absolute; inset: 0 auto 0 0; width: 0; border-radius: 3px; background: linear-gradient(90deg, var(--accent), var(--accent-2));
    box-shadow: 0 0 8px var(--accent); transition: width .4s ease; }
  /* 进度条上流动的高光，表示还在工作 */
  .bar b::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.6), transparent);
    transform: translateX(-100%); animation: shine 1.4s ease-in-out infinite; }
  .indeterminate .bar b { width: 32%; animation: slide 1.2s ease-in-out infinite; }
  .done .bar b::after { display: none; }
  @keyframes shine { to { transform: translateX(100%); } }
  @keyframes slide { from { left: -32%; } to { left: 100%; } }

  .steps { display: flex; margin: 0; padding: 0; list-style: none; font-size: 11.5px; color: var(--faint); }
  .steps li { flex: 1; display: flex; align-items: center; gap: 6px; }
  .steps li:not(:last-child)::after { content: ""; flex: 1; height: 1px; margin: 0 8px; background: var(--line); }
  .steps li span { width: 7px; height: 7px; border-radius: 50%; background: var(--line-strong); flex: none; transition: background .3s, box-shadow .3s; }
  .steps li.on { color: var(--text); }
  .steps li.on span { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); animation: pulse 1.2s ease-in-out infinite; }
  .steps li.ok { color: var(--muted); }
  .steps li.ok span { background: var(--muted); }
  .steps li.ok:not(:last-child)::after { background: color-mix(in srgb, var(--accent) 60%, transparent); }
  @keyframes pulse { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 6%, transparent); } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; } }
  `;

  class LoadingCard {
    constructor() {
      this.host = document.createElement('div');
      this.host.className = 'wdub-loading-host';
      this.host.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;display:none;';
      this.root = this.host.attachShadow({ mode: 'closed' });
      WDub.setHTML(
        this.root,
        `<style>${CARD_CSS}</style><div class="card" role="status" aria-live="polite">
          <div class="top">
            <div class="orb">${WDub.mark('logo')}
              <svg class="check" viewBox="0 0 24 24"><path d="M5.5 12.5l4 4 9-9.5" fill="none" stroke="var(--primary-ink)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><i></i><i></i><i></i></div>
            <div class="txt"><div class="title"></div><div class="detail"></div></div>
            <div class="pct"></div>
          </div>
          <div class="bar"><b></b></div>
          <ol class="steps"><li><span></span>获取字幕</li><li><span></span>翻译</li><li><span></span>就绪</li></ol>
        </div>`
      );
      this.card = this.root.querySelector('.card');
      this.$ = (s) => this.root.querySelector(s);
      this.follow = this.follow.bind(this);
      this.unFs = keepInFullscreen(this.host);
    }

    // 由 main.js 在每次状态变化时调用
    // 卡片只在刚开始时出现几秒，之后收起、在后台继续准备（识别、翻译），不挡着看视频；
    // 出错也不在视频上提示，原因写在 W 按钮的提示和工具栏弹窗里
    update(st, video) {
      if (video) this.video = video;
      const was = this.visible;
      if (st.phase === 'preparing') return this.dismissed ? undefined : this.loading(st);
      this.dismissed = false;
      clearTimeout(this.collapse);
      this.collapse = null;
      if (st.phase === 'playing' && was) return this.finish(st);
      this.hide(0);
    }

    loading(st) {
      const dub = st.mode !== 'subtitle';
      const known = st.total > 0;
      // 配音只需先翻开头一段就能开播，按比例显示会误导，所以用流动的进度条
      const p = known && !dub ? st.translated / st.total : null;
      this.show();
      this.card.classList.remove('done');
      this.card.classList.toggle('indeterminate', p == null);
      this.$('.title').textContent = known ? (dub ? '正在准备中文配音' : '正在翻译当前片段') : '正在加载字幕';
      this.$('.steps li:nth-child(2)').lastChild.textContent = '翻译开头';
      this.$('.steps li:nth-child(3)').lastChild.textContent = dub ? '开始配音' : '显示字幕';
      let detail = st.message || '';
      if (known && !dub) {
        detail = `已翻译 ${st.translated} / ${st.total} 句 · ${st.engine === 'llm' ? 'AI 翻译' : 'Google 翻译'}${this.eta(st)}`;
      } else if (known) {
        detail = `共 ${st.total} 句，先翻译开头几句就开始播放`;
      }
      this.$('.detail').textContent = detail;
      this.$('.pct').textContent = p == null ? '' : `${Math.round(p * 100)}%`;
      this.$('.bar b').style.width = p == null ? '' : `${Math.max(3, p * 100)}%`;
      this.setStep(known ? 1 : 0);
      if (!this.collapse) {
        this.collapse = setTimeout(() => {
          this.dismissed = true;
          this.card.classList.add('indeterminate');
          this.$('.title').textContent = '在后台继续准备';
          this.$('.detail').textContent = dub ? '配音会继续准备，视频可照常播放' : '字幕会继续翻译，视频可照常播放';
          this.$('.pct').textContent = '';
          this.hide(1800);
        }, 5000);
      }
    }

    // 根据已经过的时间估算剩余时间
    eta(st) {
      const now = performance.now();
      if (!this.rate || st.translated < this.rate.n) this.rate = { t: now, n: st.translated };
      const done = st.translated - this.rate.n, secs = (now - this.rate.t) / 1000;
      if (done < 5 || secs < 1) return '';
      const left = Math.ceil(((st.total - st.translated) * secs) / done);
      return left > 1 ? ` · 约 ${left} 秒` : '';
    }

    finish(st) {
      const dub = st.mode !== 'subtitle';
      this.card.classList.remove('indeterminate');
      this.card.classList.add('done');
      this.$('.bar b').style.width = dub ? '100%' : `${st.total ? Math.round((st.translated / st.total) * 100) : 0}%`;
      this.$('.pct').textContent = '';
      this.$('.title').textContent = dub ? '配音已开始' : '字幕翻译已开启';
      this.$('.detail').textContent = st.message || (dub ? '后面的句子边播边翻译' : '其余字幕在后台继续翻译，视频可照常播放');
      this.setStep(3);
      this.hide(1500);
    }

    setStep(n) {
      this.root.querySelectorAll('.steps li').forEach((li, i) => {
        li.classList.toggle('ok', i < n);
        li.classList.toggle('on', i === n);
      });
    }

    show() {
      clearTimeout(this.timer);
      if (!this.visible) {
        this.visible = true;
        this.rate = null;
        this.host.style.display = '';
        (document.fullscreenElement || document.documentElement).appendChild(this.host);
        this.card.classList.remove('leave');
        this.follow();
        requestAnimationFrame(() => this.card.classList.add('show'));
      }
    }

    hide(delay) {
      clearTimeout(this.timer);
      if (!this.visible) return;
      this.timer = setTimeout(() => {
        this.card.classList.add('leave');
        this.timer = setTimeout(() => {
          this.visible = false;
          this.card.classList.remove('show', 'leave');
          this.host.style.display = 'none';
        }, 400);
      }, delay);
    }

    // 卡片放在视频水平居中、偏下的位置，不挡住画面主体
    follow() {
      cancelAnimationFrame(this.raf);
      if (!this.visible) return;
      const r = this.video?.isConnected ? this.video.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
      const w = Math.min(380, Math.max(260, r.width * 0.6));
      const h = this.card.offsetHeight || 110;
      const top = Math.min(r.top + r.height * 0.62 - h / 2, r.top + r.height - h - 70);
      Object.assign(this.host.style, { width: `${w}px`, left: `${r.left + (r.width - w) / 2}px`, top: `${Math.max(r.top + 12, top)}px` });
      this.raf = requestAnimationFrame(this.follow);
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      this.unFs();
      this.host.remove();
    }
  }

  WDub.VideoBar = VideoBar;
  WDub.LoadingCard = LoadingCard;
})();
