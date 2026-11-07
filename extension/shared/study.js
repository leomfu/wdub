// 视频学习面板共用的数据整理。只接受字幕里的时间，避免 AI 返回越界的跳转点。
(function () {
  const WDub = (globalThis.WDub = globalThis.WDub || {});
  const clean = (value, limit = 320) => String(value || '').trim().slice(0, limit);
  const seconds = (value) => {
    if (value === null || value === undefined || value === '') return NaN;
    if (typeof value === 'number') return value;
    const raw = String(value ?? '').trim();
    if (/^\d+(?::\d{1,2}){1,2}$/.test(raw))
      return raw.split(':').reduce((n, part) => n * 60 + Number(part), 0);
    return Number(raw);
  };
  const stamp = (time) => {
    const n = Math.max(0, Math.floor(Number(time) || 0));
    const h = Math.floor(n / 3600), m = Math.floor(n / 60) % 60, s = n % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };
  // 纪要以字幕原文为准，避免沿用逐句翻译里可能出现的断句或误译。
  const cueLine = (cue) => `[${stamp(cue.start)}]${cue.speaker ? ` [${WDub.speakerLabel?.(cue.speaker) || String(cue.speaker).slice(0, 40)}]` : ''} ${String(cue.text || cue.tr).trim()}`;

  WDub.Study = {
    stamp,
    providers: [
      ['auto', '自动选已配置的服务'], ['gemini', 'Gemini API'], ['openai', 'OpenAI API'],
      ['deepseek', 'DeepSeek API'], ['ollama', 'Ollama 本地模型'],
      ['custom', '自定义兼容 API'], ['codex', '本机 Codex CLI']
    ],
    resolve(settings) {
      const chosen = settings.study?.provider || 'auto';
      const configured = (name) => name === 'ollama' ? settings.llm.provider === 'ollama'
        : name === 'custom' ? !!(settings.study?.custom?.baseUrl && settings.study?.custom?.apiKey) || !!(settings.llm.custom?.baseUrl && settings.llm.custom?.apiKey)
          : !!settings.keys?.[name];
      const candidates = [...new Set([settings.llm.provider, 'gemini', 'openai', 'deepseek', 'custom', 'ollama'])];
      const provider = chosen === 'auto' ? candidates.find((name) => configured(name)) : chosen;
      if (!provider) return { provider: 'auto', error: '还没有可用的纪要模型。请打开「模型」填入 API key，或选择本机 Codex / Ollama。' };
      const study = settings.study || {};
      const model = study.models?.[provider] || ((provider === 'ollama' || (provider === 'custom' && chosen === 'auto')) ? settings.llm.model : '');
      const endpoints = {
        gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
        openai: 'https://api.openai.com/v1',
        deepseek: 'https://api.deepseek.com/v1'
      };
      const baseUrl = provider === 'codex' ? study.codex?.baseUrl
        : provider === 'ollama' ? settings.local?.ollama
          : provider === 'custom' ? (study.custom?.baseUrl || (chosen === 'auto' ? settings.llm.custom?.baseUrl : ''))
            : endpoints[provider];
      const apiKey = provider === 'codex' ? study.codex?.token
        : provider === 'ollama' ? 'ollama'
          : provider === 'custom' ? (study.custom?.apiKey || (chosen === 'auto' ? settings.llm.custom?.apiKey : ''))
            : settings.keys?.[provider];
      if (provider === 'ollama' && (!model || WDub.isMtModel?.(model))) return { provider, error: 'Ollama 需要选择已安装的通用对话模型；翻译专用模型不能生成纪要。' };
      if (provider !== 'codex' && !model) return { provider, error: '请先填写纪要模型名称。' };
      if (!baseUrl) return { provider, error: '请先填写 API 地址。' };
      if (!apiKey) return { provider, error: provider === 'codex' ? '请先启动本机 Codex 桥接服务，并填入它显示的连接口令。' : '请先填写这个服务的 API key。' };
      return { provider, model, baseUrl, apiKey, label: WDub.Study.providers.find(([id]) => id === provider)?.[1] || provider };
    },
    // 字幕按完整句分块，长视频每一段都参与总结。
    chunks(cues, maxChars = 22000) {
      const out = [];
      let lines = [], size = 0;
      for (const cue of cues || []) {
        if (!Number.isFinite(Number(cue.start)) || !(cue.text || cue.tr)) continue;
        const line = cueLine(cue);
        if (lines.length && size + line.length > maxChars) { out.push(lines.join('\n')); lines = []; size = 0; }
        lines.push(line);
        size += line.length + 1;
      }
      if (lines.length) out.push(lines.join('\n'));
      return out;
    },
    normalize(raw, duration = Infinity) {
      const max = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : Infinity;
      const at = (value) => {
        const n = seconds(value);
        return Number.isFinite(n) && n >= 0 && n <= max ? Math.floor(n) : null;
      };
      const timed = (items, fields, limit) => (Array.isArray(items) ? items : []).slice(0, limit).map((item) => {
        const row = typeof item === 'string' ? { text: item } : item || {};
        const result = { at: at(row.at ?? row.time ?? row.start) };
        for (const [key, size] of fields) result[key] = clean(row[key], size);
        return result;
      }).filter((item) => fields.some(([key]) => item[key]));
      return {
        kind: ['meeting', 'learning', 'other'].includes(raw?.kind) ? raw.kind : 'other',
        oneLine: clean(raw?.oneLine, 400),
        keyPoints: timed(raw?.keyPoints, [['text', 400]], 8),
        chapters: timed(raw?.chapters, [['title', 100], ['summary', 400]], 12)
          .filter((item) => item.title).sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity)),
        concepts: timed(raw?.concepts, [['term', 80], ['explain', 360]], 10).filter((item) => item.term),
        questions: timed(raw?.questions, [['q', 240], ['a', 400]], 8).filter((item) => item.q && item.a),
        decisions: timed(raw?.decisions, [['text', 320]], 8),
        actions: timed(raw?.actions, [['text', 320]], 8)
      };
    }
  };
})();
