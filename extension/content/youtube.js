// YouTube 播放器集成：控制栏里的 W 按钮（一键配音或只翻字幕）、星光滑杆设置按钮，以及动效。
(function () {
  const WDub = globalThis.WDub;

  // W 按钮：「格中篆」WL 标志 + 外圈进度环（只翻字幕模式用：翻译时填满，完成后向内收拢）。配音模式用星光动效
  const ICON = `<svg class="wdub-yt-icon" viewBox="0 0 36 36" aria-hidden="true">
    <circle class="wdub-ring-track" cx="18" cy="18" r="16" fill="none" stroke-width="1.6"/>
    <g class="wdub-ring-g"><circle class="wdub-ring" cx="18" cy="18" r="16" fill="none" stroke-width="2" stroke-linecap="round"
      pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 18 18)"/></g>
    <g transform="translate(7.2 7.2) scale(.45)">${WDub.markParts()}</g>
  </svg>`;

  // 设置按钮：星光滑杆。两条滑杆，上面的滑块是一颗渐变四角星，和 YouTube 自己的齿轮区分开
  const GEAR = `<svg class="wdub-yt-icon" viewBox="0 0 36 36" aria-hidden="true" style="--accent:#f3cf7a">
    <path class="wdub-gear-line" d="M9 14h8.5M25.5 14H27M9 22h2.5M17 22h10" fill="none" stroke-width="2.2" stroke-linecap="round"/>
    <path class="wdub-gear-star" d="M21.5 9.2l1.25 3.55 3.55 1.25-3.55 1.25-1.25 3.55-1.25-3.55-3.55-1.25 3.55-1.25z"/>
    <circle class="wdub-gear-knob" cx="14.2" cy="22" r="2.6" fill="none" stroke-width="2.2"/>
  </svg>`;

  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- 星光动效（画在播放器上的透明画布里） ----------

  class StarFX {
    constructor(player) {
      this.player = player;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'wdub-yt-fx';
      this.ctx = this.canvas.getContext('2d');
      this.particles = [];
      this.mode = null; // converge | burst
      this.frame = this.frame.bind(this);
    }

    mount() {
      if (this.canvas.parentNode !== this.player) this.player.appendChild(this.canvas);
      const r = this.player.getBoundingClientRect();
      const dpr = devicePixelRatio || 1;
      this.canvas.width = r.width * dpr;
      this.canvas.height = r.height * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.box = r;
    }

    // 以按钮中心为原点
    origin(btn) {
      const b = btn.getBoundingClientRect();
      return { x: b.left + b.width / 2 - this.box.left, y: b.top + b.height / 2 - this.box.top };
    }

    star(x, y, r, rot, color, alpha) {
      const c = this.ctx;
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      c.globalAlpha = alpha;
      c.fillStyle = color;
      c.shadowColor = color;
      c.shadowBlur = r * 2.2;
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const rad = i % 2 ? r * 0.32 : r;
        const a = (i * Math.PI) / 4;
        c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      c.closePath();
      c.fill();
      c.restore();
    }

    color(t) {
      // 冰白和印泥金两种星光，偶尔纯白高光
      if (Math.random() < 0.15) return '#FFFFFF';
      const a = [223, 229, 247], b = [243, 207, 122];
      return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
    }

    // 准备中：星星从四周向按钮聚拢
    converge(btn) {
      if (reduceMotion()) return;
      this.mount();
      this.btn = btn;
      this.mode = 'converge';
      this.started = performance.now();
      if (!this.raf) this.raf = requestAnimationFrame(this.frame);
    }

    // 就绪：一圈星星从按钮向外迸发
    burst(btn) {
      if (reduceMotion()) return this.stop();
      this.mount();
      this.btn = btn;
      this.mode = 'burst';
      this.started = performance.now();
      const o = this.origin(btn);
      this.particles = Array.from({ length: 18 }, (_, i) => {
        const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
        return { angle, dist: 6, reach: 60 + Math.random() * 70, size: 4 + Math.random() * 4.5, rot: Math.random() * 3, color: this.color(Math.random()), o };
      });
      if (!this.raf) this.raf = requestAnimationFrame(this.frame);
    }

    stop() {
      this.mode = null;
      this.particles = [];
      cancelAnimationFrame(this.raf);
      this.raf = null;
      this.canvas.remove();
    }

    frame(now) {
      this.raf = null;
      if (!this.mode || !this.btn?.isConnected) return this.stop();
      const c = this.ctx;
      c.clearRect(0, 0, this.box.width, this.box.height);
      const o = this.origin(this.btn);
      const t = (now - this.started) / 1000;

      if (this.mode === 'converge') {
        // 持续生成，越靠近中心越快，到达后被“吸收”
        while (this.particles.length < 40) {
          const start = 70 + Math.random() * 90;
          this.particles.push({ angle: Math.random() * Math.PI * 2, start, dist: start, size: 2.2 + Math.random() * 3.2, rot: Math.random() * 3, spin: (Math.random() - 0.5) * 4, color: this.color(Math.random()) });
        }
        for (const p of this.particles) {
          const k = 1 - p.dist / p.start;
          p.dist -= 0.9 + k * 4.5;
          p.rot += p.spin * 0.016;
          const swirl = p.angle + k * 0.9; // 带一点旋涡感
          const alpha = Math.min(1, (p.start - p.dist) / 18) * Math.min(1, p.dist / 14);
          this.star(o.x + Math.cos(swirl) * p.dist, o.y + Math.sin(swirl) * p.dist, p.size * (0.6 + (1 - k) * 0.6), p.rot, p.color, alpha);
        }
        this.particles = this.particles.filter((p) => p.dist > 4);
        // 中心的光晕随时间慢慢变亮，呼吸
        const glow = 10 + Math.sin(t * 5) * 3 + Math.min(t, 2) * 4;
        const g = c.createRadialGradient(o.x, o.y, 0, o.x, o.y, glow * 2);
        g.addColorStop(0, 'rgba(255,255,255,.55)');
        g.addColorStop(0.4, 'rgba(243,207,122,.25)');
        g.addColorStop(1, 'rgba(243,207,122,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(o.x, o.y, glow * 2, 0, Math.PI * 2);
        c.fill();
      }

      if (this.mode === 'burst') {
        const d = 0.95; // 动画总时长（秒）
        const k = Math.min(t / d, 1);
        const ease = 1 - Math.pow(1 - k, 3);
        // 中心闪光
        const flash = c.createRadialGradient(o.x, o.y, 0, o.x, o.y, 46);
        flash.addColorStop(0, `rgba(255,255,255,${0.8 * (1 - k)})`);
        flash.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = flash;
        c.beginPath();
        c.arc(o.x, o.y, 46, 0, Math.PI * 2);
        c.fill();
        // 扩散的光环
        c.save();
        c.globalAlpha = 0.7 * (1 - k);
        c.strokeStyle = '#f3cf7a';
        c.lineWidth = 2 * (1 - k) + 0.5;
        c.shadowColor = '#dfe5f7';
        c.shadowBlur = 12;
        c.beginPath();
        c.arc(o.x, o.y, 10 + ease * 110, 0, Math.PI * 2);
        c.stroke();
        c.restore();
        for (const p of this.particles) {
          const dist = p.dist + ease * p.reach;
          this.star(o.x + Math.cos(p.angle) * dist, o.y + Math.sin(p.angle) * dist, p.size * (1 - k * 0.6), p.rot + ease * 2, p.color, 1 - k);
        }
        if (k >= 1) return this.stop();
      }
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  // ---------- 播放器里的按钮 ----------

  class YouTubeUI {
    constructor(handlers) {
      this.h = handlers;
      this.phase = 'idle';
      this.mode = 'dub';
    }

    makeButton(cls, icon, label, onClick) {
      const b = document.createElement('button');
      b.className = `ytp-button wdub-yt-btn ${cls}`;
      b.dataset.wdubOpener = '1';
      b.setAttribute('aria-label', label);
      b.title = label;
      WDub.setHTML(b, icon);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(b);
      });
      return b;
    }

    // YouTube 是单页应用，播放器会重建；定时调用以确保按钮存在
    ensure() {
      const player = document.getElementById('movie_player');
      const controls = player?.querySelector('.ytp-right-controls');
      if (!player || !controls) return;
      // 控制栏顺序：[W] [设置] [YouTube 自己的按钮…]
      if (!this.gear?.isConnected) {
        this.gear = this.makeButton('wdub-yt-gear', GEAR, 'W 声幕设置', (b) => this.h.onOpenSettings(b));
        controls.prepend(this.gear);
      }
      if (!this.btn?.isConnected) {
        this.btn = this.makeButton('wdub-yt-main', ICON, 'W 声幕', () => this.h.onToggle());
        controls.prepend(this.btn);
      }
      if (!this.fx || this.fx.player !== player) this.fx = new StarFX(player);
      this.render();
    }

    // wMode：点 W 时做什么（dub 配音 + 字幕 | subtitle 只翻字幕），用于按钮提示文字
    setWMode(wMode) {
      this.wMode = wMode;
      this.render();
    }

    setState(st) {
      if (!st.phase) return;
      this.ensure();
      if (!this.btn) return;
      const prev = this.phase, prevMode = this.mode;
      const phase = st.phase === 'stopped' ? 'idle' : st.phase;
      this.phase = phase;
      this.mode = st.mode || 'dub';
      // 运行中切换了模式：先把上一种模式的动效清掉
      if (prevMode !== this.mode) this.resetRing(), this.fx.stop();
      if (this.mode === 'subtitle') this.ringPhase(phase, prev, st);
      else this.starPhase(phase, prev);
      if (phase === 'idle' || phase === 'error') this.resetRing(), this.fx.stop();
      this.message = st.message;
      this.render();
    }

    // 配音：准备中星星聚拢，就绪时向外迸发
    starPhase(phase, prev) {
      if (phase === 'preparing' && prev !== 'preparing') this.fx.converge(this.btn);
      if (phase === 'playing' && prev !== 'playing') this.fx.burst(this.btn);
    }

    // 只翻字幕：进度环随翻译进度填满，完成时向内收拢、轻轻一哒（文字进度在视频中下方的加载卡片里）
    ringPhase(phase, prev, st) {
      const ring = this.btn.querySelector('.wdub-ring');
      if (phase === 'preparing') {
        this.fx.stop();
        const p = st.total ? st.translated / st.total : null;
        this.btn.classList.toggle('indeterminate', p == null);
        ring.style.strokeDashoffset = p == null ? '' : String(100 - Math.max(4, p * 100));
      } else if (phase === 'playing' && prev === 'preparing') {
        this.btn.classList.remove('indeterminate', 'done');
        ring.style.strokeDashoffset = '0';
        void this.btn.offsetWidth; // 重新触发动画
        this.btn.classList.add('done');
      }
    }

    resetRing() {
      this.btn.classList.remove('indeterminate', 'done');
      this.btn.querySelector('.wdub-ring').style.strokeDashoffset = '';
    }

    render() {
      if (!this.btn) return;
      this.btn.dataset.state = this.phase;
      this.btn.dataset.mode = this.phase === 'idle' ? this.wMode || 'dub' : this.mode;
      const what = (this.wMode || 'dub') === 'subtitle' ? '只翻字幕' : '中文配音 + 字幕';
      this.btn.title =
        this.phase === 'preparing'
          ? `W 声幕 · ${this.message || '正在准备…'}`
          : this.phase === 'playing'
            ? `W 声幕 · ${this.mode === 'subtitle' ? '字幕已翻译' : '配音中'}，点击停止`
            : this.phase === 'error'
              ? `W 声幕 · 没能开始：${this.message || '出错了'}（点击重试）`
              : `W 声幕 · 一键${what}（在设置里可改）`;
    }

    destroy() {
      this.fx?.stop();
      this.btn?.remove();
      this.gear?.remove();
    }
  }

  WDub.YouTubeUI = YouTubeUI;
})();
