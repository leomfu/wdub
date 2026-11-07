// 字幕层：贴在视频上方显示双语字幕，跟随视频位置、尺寸和全屏状态。
(function () {
  const WDub = globalThis.WDub;

  class SubtitleOverlay {
    constructor(video) {
      this.video = video;
      this.host = document.createElement('div');
      this.host.className = 'wdub-overlay-host';
      this.root = this.host.attachShadow({ mode: 'closed' });
      WDub.setHTML(this.root, `<style>
        :host { all: initial; }
        .box { position: fixed; pointer-events: none; z-index: 2147483646; display: flex; flex-direction: column;
               align-items: center; justify-content: flex-end; box-sizing: border-box; padding: 0 4%; }
        .box.top { justify-content: flex-start; }
        .card { display: flex; flex-direction: column; align-items: center; gap: .22em; max-width: 92%;
                padding: .28em .7em; border-radius: .45em; pointer-events: none; user-select: none; }
        .line { line-height: 1.32; text-align: center; white-space: pre-wrap; word-break: break-word; }
        .edge-shadow .line { text-shadow: 0 1px 3px var(--edge-color), 0 0 2px var(--edge-color); }
        .edge-outline .line { -webkit-text-stroke: .06em var(--edge-color); paint-order: stroke fill; }
        .empty { display: none; }
      </style><div class="box"><div class="card empty"></div></div>`);
      this.box = this.root.querySelector('.box');
      this.card = this.root.querySelector('.card');
      this.visible = true;
      this.place = this.place.bind(this);
      this.timer = setInterval(this.place, 300);
      window.addEventListener('resize', this.place);
      window.addEventListener('scroll', this.place, true);
      document.addEventListener('fullscreenchange', this.place);
      this.attach();
    }

    attach() {
      const parent = document.fullscreenElement && document.fullscreenElement.contains(this.video) ? document.fullscreenElement : document.documentElement;
      if (this.host.parentNode !== parent) parent.appendChild(this.host);
    }

    place() {
      if (!this.video.isConnected) return;
      this.attach();
      const r = this.video.getBoundingClientRect();
      const s = this.style || WDub.DEFAULTS.subtitle;
      Object.assign(this.box.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        paddingBottom: s.position === 'bottom' ? `${(r.height * s.offset) / 100}px` : '0',
        paddingTop: s.position === 'top' ? `${(r.height * s.offset) / 100}px` : '0',
        display: r.width < 50 || !this.visible ? 'none' : 'flex'
      });
      // 字号随播放器宽度缩放，以 1280px 宽为基准
      const scale = Math.min(Math.max(r.width / 1280, 0.55), 1.6);
      this.card.style.fontSize = `${s.fontSize * scale}px`;
    }

    applyStyle(style) {
      this.style = style;
      this.box.classList.toggle('top', style.position === 'top');
      this.card.className = `card edge-${style.edge}${this.card.classList.contains('empty') ? ' empty' : ''}`;
      this.card.style.background = `rgba(11,16,36,${style.bgOpacity})`; // 夜空蓝，和整体风格一致
      this.card.style.setProperty('--edge-color', style.edgeColor || '#000000');
      this.card.style.fontFamily = style.fontFamily || '-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
      this.place();
    }

    // cue: { text, tr }；mode: bilingual | translated | off
    render(cue, mode) {
      const s = this.style || WDub.DEFAULTS.subtitle;
      this.card.replaceChildren();
      if (!cue || mode === 'off') {
        this.card.classList.add('empty');
        return;
      }
      const lines = [];
      const tr = cue.tr ? { text: cue.tr, color: s.translatedColor, size: 1, weight: 600 } : null;
      const orig = { text: cue.text, color: s.originalColor, size: s.originalScale, weight: 400, bg: Number(s.originalBg) || 0 };
      if (mode === 'translated') lines.push(tr || orig);
      else if (s.order === 'translatedFirst') lines.push(tr, orig);
      else lines.push(orig, tr);
      for (const l of lines.filter(Boolean)) {
        const div = document.createElement('div');
        div.className = 'line';
        div.textContent = l.text;
        div.style.color = l.color;
        div.style.fontSize = `${l.size}em`;
        div.style.fontWeight = l.weight;
        if (l.bg > 0) {
          div.style.background = `rgba(11,16,36,${l.bg})`;
          div.style.borderRadius = '.35em';
          div.style.padding = '.04em .4em';
        }
        this.card.appendChild(div);
      }
      this.card.classList.remove('empty');
    }

    setVisible(v) {
      this.visible = v;
      this.place();
    }

    destroy() {
      clearInterval(this.timer);
      window.removeEventListener('resize', this.place);
      window.removeEventListener('scroll', this.place, true);
      document.removeEventListener('fullscreenchange', this.place);
      this.host.remove();
    }
  }

  WDub.SubtitleOverlay = SubtitleOverlay;
})();
