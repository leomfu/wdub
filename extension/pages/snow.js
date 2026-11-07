// 背景装饰：零星的小星点、细小的 + / × 星芒和几片 ❄ 雪花，都是静止的。
// 只用在扩展自己的页面（设置、弹窗、本地播放器），不放在视频上；设置里可以关掉。
(function () {
  const { WDub } = globalThis;
  const canvas = document.createElement('canvas');
  canvas.className = 'snow';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '0' });
  const ctx = canvas.getContext('2d');
  let enabled = false;

  // 固定种子的随机数：每次打开位置都一样，不会闪来闪去
  function rng(seed) {
    return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  }

  // 六瓣雪花：六条主枝，每条枝上一对小分叉
  function flake(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const cx = Math.cos(a), cy = Math.sin(a);
      ctx.moveTo(x, y);
      ctx.lineTo(x + cx * r, y + cy * r);
      const bx = x + cx * r * 0.55, by = y + cy * r * 0.55;
      for (const s of [-1, 1]) {
        const b = a + (s * Math.PI) / 4;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(b) * r * 0.32, by + Math.sin(b) * r * 0.32);
      }
    }
    ctx.stroke();
  }

  function cross(x, y, r, rotate) {
    ctx.beginPath();
    const a = rotate ? Math.PI / 4 : 0;
    for (const k of [0, Math.PI / 2]) {
      ctx.moveTo(x - Math.cos(a + k) * r, y - Math.sin(a + k) * r);
      ctx.lineTo(x + Math.cos(a + k) * r, y + Math.sin(a + k) * r);
    }
    ctx.stroke();
  }

  function draw() {
    const dpr = devicePixelRatio || 1;
    const w = innerWidth, h = innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 颜色跟随主题：暗色是冰白，亮色是淡淡的蓝灰
    const light = getComputedStyle(document.documentElement).colorScheme === 'light';
    const ink = light ? '90,104,160' : '223,229,247';
    const rand = rng(20251027);
    const area = (w * h) / 10000;
    ctx.lineCap = 'round';
    // 星点
    for (let i = 0; i < area * 1.2; i++) {
      ctx.fillStyle = `rgba(${ink},${(light ? 0.18 : 0.25) + rand() * 0.45})`;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, 0.5 + rand() * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // + / × 星芒
    for (let i = 0; i < area * 0.18; i++) {
      ctx.strokeStyle = `rgba(${ink},${(light ? 0.22 : 0.3) + rand() * 0.35})`;
      ctx.lineWidth = 1;
      cross(rand() * w, rand() * h, 2.5 + rand() * 2.5, rand() < 0.5);
    }
    // 雪花：数量少、尺寸不一，更像点缀
    for (let i = 0; i < Math.max(3, area * 0.06); i++) {
      ctx.strokeStyle = `rgba(${ink},${(light ? 0.25 : 0.35) + rand() * 0.35})`;
      ctx.lineWidth = 1.1;
      flake(rand() * w, rand() * h, 5 + rand() * 7);
    }
  }

  function set(on) {
    enabled = on;
    if (enabled) {
      if (!canvas.isConnected) document.body.prepend(canvas);
      // 主题切换后 color-scheme 在下一帧才生效
      requestAnimationFrame(draw);
    } else canvas.remove();
  }

  addEventListener('resize', () => enabled && draw());
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => enabled && requestAnimationFrame(draw));
  WDub.getSettings().then((s) => set(s.snow !== false), () => set(true));
  WDub.onSettingsChanged((s) => set(s.snow !== false));
})();
