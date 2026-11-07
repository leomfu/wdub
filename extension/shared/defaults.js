// W 声幕：所有页面（后台、内容脚本、弹窗、设置页）共用的默认配置与工具函数。
// 以经典脚本加载，挂在 globalThis.WDub 上。
(function () {
  const WDub = (globalThis.WDub = globalThis.WDub || {});

  WDub.DEFAULTS = {
    theme: 'auto', // 外观：auto 跟随系统 | light 亮色 | dark 暗色
    snow: true, // 设置页、弹窗、本地播放器背景里的星点和雪花装饰（静止）
    floatingBall: true, // 屏幕右边可拖动的 W 悬浮球，点开快捷面板
    controlBar: true, // 非 YouTube 网站：在视频底部播放栏位置放 W 和设置按钮
    wMode: 'dub', // 点 W 时：dub 配音 + 中文字幕 | subtitle 只翻字幕（不配音）
    youtubeButton: true, // 在 YouTube 播放器控制栏里放 W 按钮
    sourceLang: 'auto',
    targetLang: 'zh-CN',
    skipSameLanguage: true,

    // 各服务商的 key 集中放在这里，翻译、配音、识别共用。导出时默认不带，也不进 Chrome 同步
    keys: {
      deepseek: '', openai: '', qwen: '', gemini: '', claude: '', groq: '', elevenlabs: '',
      azure: { key: '', region: 'eastasia' },
      doubao: { appKey: '', accessKey: '' }
    },
    // 本地服务的地址
    local: {
      asr: 'http://127.0.0.1:8199/v1', // tools/start-whisper.sh，Whisper 和 SenseVoice 共用
      kokoro: 'http://localhost:8880/v1',
      ollama: 'http://localhost:11434/v1'
    },

    // 翻译：google（免费，无需配置）| llm（大模型，质量更高，支持术语和说话人识别）
    translator: 'google',
    llm: {
      provider: 'deepseek', // 见 WDub.PROVIDERS，另有 ollama（本地）| custom（自定义接口）
      model: 'deepseek-chat',
      // 本地模型失败时是否允许改发云端：null 表示按服务自动判断（本地默认不允许）（文档 C）
      allowCloudFallback: null,
      custom: { baseUrl: '', apiKey: '' },
      batchSize: 40,
      detectSpeakers: true,
      domainHint: ''
    },
    // 学习纪要独立选择模型；auto 优先复用已配置的服务，但不会改翻译模型。
    study: {
      provider: 'auto',
      models: { gemini: 'gemini-3.8-flash', openai: 'gpt-6.1-sol', deepseek: 'deepseek-v4-flash', ollama: '', custom: '', codex: '' },
      custom: { baseUrl: '', apiKey: '' },
      codex: { baseUrl: 'http://127.0.0.1:8198/v1', token: '' }
    },

    // 语音：system（Chrome 内置声音，免费）| azure（免费额度每月 50 万字）| elevenlabs（音质最好）| openai
    //      | kokoro（本地）| custom（任意 OpenAI 兼容 /audio/speech 接口）
    tts: {
      engine: 'system',
      maxSpeed: 1.6, // 配音太长时最多加速到几倍
      azure: { style: '' },
      // flash 每个字消耗 0.5 额度、延迟低；multilingual_v2 音质更好、每个字 1 额度
      elevenlabs: { model: 'eleven_flash_v2_5' },
      openai: { model: 'gpt-4o-mini-tts', instructions: '' },
      custom: { baseUrl: '', apiKey: '', model: '' }
    },

    // 语音识别：视频没有字幕时用。
    // 外语：local（本地 Whisper）| groq | openai | elevenlabs | azure；中文：sensevoice（本地）| doubao；custom 自定义接口
    asr: {
      engine: 'local',
      language: 'en', // 视频语言，auto 为自动检测
      maxSpeakers: 4,
      autoOnMissing: true, // 网页视频没字幕时自动识别（仅限能直接下载的视频）
      local: { model: 'mlx-community/whisper-large-v3-turbo', token: '' }, // token：启动 tools/start-whisper.sh 时打印的连接口令
      groq: { model: 'whisper-large-v3-turbo' },
      openai: { model: 'whisper-1' },
      elevenlabs: { model: 'scribe_v1' },
      custom: { baseUrl: '', apiKey: '', model: '' }
    },

    // 角色声音：narrator 为主声音；多人对话时按性别轮换 male / female 声音池。键为引擎名。
    multiVoice: true,
    // 一键识别人物：听声音分出每句是谁说的。engine：local（本地声纹模型，免费）| elevenlabs（更准，消耗额度）；count：人数，0 为自动
    diarize: { engine: 'local', count: 0 },
    cast: {
      system: { narrator: '', male: [], female: [] },
      azure: {
        narrator: 'zh-CN-YunxiNeural',
        male: ['zh-CN-YunxiNeural', 'zh-CN-YunjianNeural', 'zh-CN-YunyangNeural'],
        female: ['zh-CN-XiaoxiaoNeural', 'zh-CN-XiaoyiNeural', 'zh-CN-XiaochenNeural']
      },
      elevenlabs: {
        narrator: 'nPczCjzI2devNBz1zQrb',
        male: ['nPczCjzI2devNBz1zQrb', 'JBFqnCBsd6RMkjVDRZzb', 'onwK4e9ZLuTAKqWW03F9'],
        female: ['EXAVITQu4vr4xnSDxMaL', 'Xb7hH8MSUJpSbSDYk0k2', 'XrExE9yKIg1WjnnlVkGX']
      },
      openai: { narrator: 'alloy', male: ['onyx', 'echo', 'ash'], female: ['nova', 'shimmer', 'coral'] },
      kokoro: { narrator: 'zm_yunxi', male: ['zm_yunxi', 'zm_yunjian', 'zm_yunyang'], female: ['zf_xiaoxiao', 'zf_xiaoyi', 'zf_xiaobei'] },
      custom: { narrator: 'alloy', male: ['onyx', 'echo', 'ash'], female: ['nova', 'shimmer', 'coral'] }
    },

    audio: {
      originalMode: 'duck', // duck：保留原声（说话时压低）| mute：静音原声
      dubVolume: 1,
      originalVolume: 0.12, // 配音说话时原声音量
      smartDuck: true, // 句子之间恢复原声，听得到背景音乐和环境声
      idleVolume: 0.6, // 句子之间的原声音量
      slowVideoWhenLagging: true, // 配音还没念完时放慢画面等一等
      minVideoRate: 0.7
    },

    subtitle: {
      mode: 'bilingual', // bilingual | translated | off
      hideNative: true,
      order: 'translatedFirst',
      position: 'bottom', // bottom | top
      offset: 8, // 距离边缘的百分比
      fontSize: 24,
      fontFamily: '',
      translatedColor: '#FFFFFF',
      originalColor: '#D7DAE3',
      originalScale: 0.78,
      bgOpacity: 0.5,
      edge: 'shadow', // none | shadow | outline
      edgeColor: '#000000',
      originalBg: 0 // 原文这一行自己的底，0 表示没有。和 edge 一起由面板里的样式组合写入
    },

    rules: {
      enabled: true,
      packMode: 'auto', // auto：按视频内容选择；manual：始终使用用户勾选的词表
      glossary: [], // {src, dst, on}  开着的一条盖过专业词库；关掉或空着就当没有，不会挡住词库
      packs: [], // 启用的 TERM_PACKS id。词条在 extension/terms，不写进同步，也不写进 glossary
      preReplace: [], // {find, repl, on}  翻译前修正原文识别错误
      postReplace: [], // {find, repl, on} 翻译后替换译文
      pronunciation: [] // {find, say, on}  朗读前替换读法，不影响字幕显示
    },

    disabledSites: []
  };

  WDub.LANGS = [
    ['auto', '自动检测'], ['zh-CN', '中文（简体）'], ['zh-TW', '中文（繁體）'], ['en', 'English'],
    ['ja', '日本語'], ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'],
    ['pt', 'Português'], ['ru', 'Русский'], ['it', 'Italiano'], ['ar', 'العربية'], ['hi', 'हिन्दी'],
    ['th', 'ไทย'], ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia'], ['tr', 'Türkçe']
  ];

  // Azure 常用神经声音（全部列表见 https://learn.microsoft.com/azure/ai-services/speech-service/language-support）
  WDub.AZURE_VOICES = [
    ['zh-CN-XiaoxiaoNeural', '晓晓 · 女 · 温暖'], ['zh-CN-XiaoyiNeural', '晓伊 · 女 · 活泼'],
    ['zh-CN-XiaochenNeural', '晓辰 · 女 · 自然'], ['zh-CN-XiaohanNeural', '晓涵 · 女 · 知性'],
    ['zh-CN-XiaomoNeural', '晓墨 · 女 · 叙事'], ['zh-CN-XiaoxuanNeural', '晓萱 · 女 · 成熟'],
    ['zh-CN-YunxiNeural', '云希 · 男 · 阳光'], ['zh-CN-YunjianNeural', '云健 · 男 · 激情'],
    ['zh-CN-YunyangNeural', '云扬 · 男 · 播音'], ['zh-CN-YunzeNeural', '云泽 · 男 · 沉稳'],
    ['zh-CN-YunfengNeural', '云枫 · 男 · 低沉'], ['zh-CN-YunhaoNeural', '云皓 · 男 · 广告'],
    ['zh-CN-XiaoxiaoMultilingualNeural', '晓晓多语言 · 女'], ['zh-CN-YunyiMultilingualNeural', '云逸多语言 · 男'],
    ['zh-TW-HsiaoChenNeural', '曉臻 · 女 · 台湾'], ['zh-TW-YunJheNeural', '雲哲 · 男 · 台湾'],
    ['en-US-AvaMultilingualNeural', 'Ava · F · EN'], ['en-US-AndrewMultilingualNeural', 'Andrew · M · EN'],
    ['ja-JP-NanamiNeural', '七海 · 女 · 日'], ['ja-JP-KeitaNeural', '圭太 · 男 · 日']
  ];

  // ElevenLabs 自带的通用声音（都能说中文）；填了 key 后设置页还会列出你账号里的声音，包括克隆的
  WDub.ELEVENLABS_VOICES = [
    ['nPczCjzI2devNBz1zQrb', 'Brian · 男 · 低沉'], ['JBFqnCBsd6RMkjVDRZzb', 'George · 男 · 温和'],
    ['onwK4e9ZLuTAKqWW03F9', 'Daniel · 男 · 播音'], ['TX3LPaxmHKxFdv7VOQHJ', 'Liam · 男 · 年轻'],
    ['iP95p4xoKVk53GoZ742B', 'Chris · 男 · 随和'], ['cjVigY5qzO86Huf0OWal', 'Eric · 男 · 沉稳'],
    ['EXAVITQu4vr4xnSDxMaL', 'Sarah · 女 · 柔和'], ['Xb7hH8MSUJpSbSDYk0k2', 'Alice · 女 · 自信'],
    ['XrExE9yKIg1WjnnlVkGX', 'Matilda · 女 · 亲切'], ['pFZP5JQG7iQjIQuC4Bku', 'Lily · 女 · 温暖'],
    ['cgSgspJ2msm6clMCkdW9', 'Jessica · 女 · 活泼'], ['FGY2WhTYpPnrIDTdsKH5', 'Laura · 女 · 轻快']
  ];

  WDub.OPENAI_VOICES = [
    ['alloy', 'alloy · 中性'], ['ash', 'ash · 男'], ['ballad', 'ballad · 男'], ['coral', 'coral · 女'],
    ['echo', 'echo · 男'], ['fable', 'fable · 男'], ['nova', 'nova · 女'], ['onyx', 'onyx · 男 · 低沉'],
    ['sage', 'sage · 女'], ['shimmer', 'shimmer · 女'], ['verse', 'verse · 男']
  ];

  // Kokoro 的声音：z 开头说中文，a 开头说英文
  WDub.KOKORO_VOICES = [
    ['zm_yunxi', '云希 · 男'], ['zm_yunjian', '云健 · 男'], ['zm_yunyang', '云扬 · 男'], ['zm_yunxia', '云夏 · 男'],
    ['zf_xiaoxiao', '晓晓 · 女'], ['zf_xiaoyi', '晓伊 · 女'], ['zf_xiaobei', '晓北 · 女'], ['zf_xiaoni', '晓妮 · 女'],
    ['af_heart', 'Heart · F · EN'], ['af_bella', 'Bella · F · EN'], ['am_michael', 'Michael · M · EN'], ['am_adam', 'Adam · M · EN']
  ];

  // 服务商：接口地址固定，key 放在 settings.keys 里
  WDub.PROVIDERS = {
    deepseek: { name: 'DeepSeek', base: 'https://api.deepseek.com/v1' },
    openai: { name: 'OpenAI', base: 'https://api.openai.com/v1' },
    qwen: { name: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    gemini: { name: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    claude: { name: 'Claude', base: 'https://api.anthropic.com/v1' },
    groq: { name: 'Groq', base: 'https://api.groq.com/openai/v1' },
    elevenlabs: { name: 'ElevenLabs' },
    azure: { name: 'Azure 语音' },
    doubao: { name: '豆包语音' }
  };

  // 设置页里能选的引擎和模型：每项只留一个免费的加一两个最好用的，选多了反而难挑。
  // 其他引擎（OpenAI、通义千问、Claude、Groq、豆包、Kokoro、自定义接口）的代码还在，加回这里的列表就能用。
  // 只有一个模型的不显示下拉；Ollama 的模型在设置页里从本机读取
  WDub.MODELS = {
    llm: {
      deepseek: [['deepseek-chat', 'DeepSeek V3']],
      // Gemini 更新换代快、旧型号会对新用户停用：先用自动跟随最新版的别名，填了 key 后设置页会换成查到的最新型号
      gemini: [['gemini-flash-latest', '最新 Flash · 快'], ['gemini-flash-lite-latest', '最新 Flash Lite · 最便宜']],
      ollama: []
    },
    tts: {
      elevenlabs: [['eleven_flash_v2_5', 'Flash v2.5 · 快、省额度'], ['eleven_multilingual_v2', 'Multilingual v2 · 音质最好']]
    },
    asr: {}
  };

  WDub.LLM_PROVIDERS = [['deepseek', 'DeepSeek'], ['gemini', 'Gemini'], ['ollama', 'Ollama · 本地']];
  WDub.TTS_ENGINES = globalThis.WDubMobile
    ? [['azure', 'Azure'], ['elevenlabs', 'ElevenLabs']]
    : [['system', '系统声音 · 免费'], ['azure', 'Azure'], ['elevenlabs', 'ElevenLabs']];
  WDub.ASR_ENGINES = globalThis.WDubMobile
    ? [['elevenlabs', 'ElevenLabs']]
    : [['local', '本地 Whisper'], ['sensevoice', '本地 SenseVoice · 中文'], ['elevenlabs', 'ElevenLabs']];

  // 专业词库目录。正文在 extension/terms/<id>.json，设置里只存 id。
  WDub.TERM_PACKS = [
    { id: 'ai-modern', title: 'AI 入门与应用', source: '常见 AI 工具、模型与工作流；只收录含义明确的术语', auto: true,
      hints: ['artificial intelligence', 'machine learning', 'large language model', 'llm', 'generative ai', 'neural network', 'prompt engineering', 'ai agent', 'fine tuning', 'rag', 'ai'] },
    { id: 'business-modern', title: '商业与创业', source: '商业模式、营销、运营和增长', auto: true,
      hints: ['business model', 'startup', 'revenue', 'profit', 'customer acquisition', 'marketing', 'sales funnel', 'conversion rate', 'pricing', 'market fit', 'entrepreneurship'] },
    { id: 'learning-modern', title: '学习方法', source: '课程、记忆与练习方法', auto: true,
      hints: ['study skills', 'spaced repetition', 'active recall', 'deliberate practice', 'metacognition', 'learning strategy', 'study habit', 'study plan', 'learning science'] },
    { id: 'programming-modern', title: '编程开发', source: '代码、开发工具与常见软件概念', auto: true,
      hints: ['programming', 'coding', 'software development', 'developer', 'javascript', 'python', 'api', 'debugging', 'source code', 'repository', 'function', 'algorithm'] },
    { id: 'english-modern', title: '英语学习', source: '语法、发音、词汇与语言练习', auto: true,
      hints: ['learn english', 'english language', 'english grammar', 'pronunciation', 'vocabulary', 'listening practice', 'speaking practice', 'verb tense', 'sentence structure', 'fluency'] },
    { id: 'math-modern', title: '数学', source: '代数、几何、函数与统计', auto: true,
      hints: ['mathematics', 'math', 'algebra', 'geometry', 'calculus', 'equation', 'derivative', 'probability', 'statistics', 'theorem'] },
    { id: 'physics-modern', title: '物理', source: '力学、能量、电磁与基础物理', auto: true,
      hints: ['physics', 'velocity', 'acceleration', 'momentum', 'electric field', 'gravity', 'quantum mechanics', 'thermodynamics', 'kinetic energy', 'newton law'] },
    { id: 'learning', title: '旧版 · 教育学大词典', source: 'NAER 教育学 15367；收词广，可能有生硬译法' },
    { id: 'programming', title: '旧版 · 编程大词典', source: 'NAER 两岸计算机等；含扩展补充的现代词' },
    { id: 'business', title: '旧版 · 商业大词典', source: 'NAER 管理学、市场学；部分译法偏旧' },
    { id: 'investing', title: '旧版 · 投资大词典', source: 'NAER 经济学、央行双语词汇' }
  ];
  WDub.AUTO_TERM_PACK_IDS = WDub.TERM_PACKS.filter((p) => p.auto).map((p) => p.id);
  WDub.activePackIds = (settings, suggested = []) => settings?.rules?.packMode !== 'auto'
    ? WDub.enabledPackIds(settings)
    : WDub.AUTO_TERM_PACK_IDS.filter((id) => suggested.includes(id));

  WDub.suggestTermPackIds = function (title, texts) {
    const sample = Array.isArray(texts) ? texts.join(' ').slice(0, 20000) : '';
    const titleText = String(title || '').toLowerCase();
    const body = sample.toLowerCase();
    const score = (hay, word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'gi');
      return [...hay.matchAll(re)].length;
    };
    return WDub.TERM_PACKS.filter((p) => p.auto)
      .map((p) => ({ id: p.id, score: p.hints.reduce((n, hint) => n + Math.min(4, score(body, hint)) + 3 * Math.min(2, score(titleText, hint)), 0) }))
      .filter((p) => p.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((p) => p.id);
  };

  // 面板里的一个下拉项同时写描边和原文底。不在表里的组合（设置页单独调过）显示为「自定义」。
  WDub.SUBTITLE_LOOKS = [
    { id: 'shadow-clear', label: '阴影 · 原文无底', edge: 'shadow', originalBg: 0 },
    { id: 'shadow-soft', label: '阴影 · 原文浅底', edge: 'shadow', originalBg: 0.55 },
    { id: 'shadow-solid', label: '阴影 · 原文深底', edge: 'shadow', originalBg: 0.88 },
    { id: 'outline-clear', label: '描边 · 原文无底', edge: 'outline', originalBg: 0 },
    { id: 'outline-soft', label: '描边 · 原文浅底', edge: 'outline', originalBg: 0.55 },
    { id: 'plain-solid', label: '无描边 · 原文深底', edge: 'none', originalBg: 0.88 }
  ];
  // 设置页的起点样式：只改外观，不改字幕开关、字号、位置和用户的字体选择。
  WDub.SUBTITLE_PRESETS = [
    { id: 'clear', title: '清晰白字', note: '适合多数视频', style: { translatedColor: '#FFFFFF', originalColor: '#D7DAE3', edge: 'shadow', edgeColor: '#000000', bgOpacity: 0.5, originalBg: 0 } },
    { id: 'ink', title: '黑字白边', note: '亮暗画面都醒目', style: { translatedColor: '#172033', originalColor: '#172033', edge: 'outline', edgeColor: '#FFFFFF', bgOpacity: 0, originalBg: 0 } },
    { id: 'warm', title: '暖黄重点', note: '突出中文译文', style: { translatedColor: '#FFE19A', originalColor: '#F2F4F8', edge: 'shadow', edgeColor: '#0B1024', bgOpacity: 0.5, originalBg: 0 } },
    { id: 'soft', title: '柔和底条', note: '信息密集时易读', style: { translatedColor: '#FFFFFF', originalColor: '#D7DAE3', edge: 'none', edgeColor: '#000000', bgOpacity: 0.78, originalBg: 0.35 } }
  ];
  WDub.subtitlePresetId = (subtitle) => WDub.SUBTITLE_PRESETS.find(({ style }) =>
    Object.entries(style).every(([key, value]) => typeof value === 'number'
      ? Math.abs(Number(subtitle?.[key]) - value) < 0.01
      : String(subtitle?.[key] || '').toUpperCase() === value.toUpperCase()))?.id || '';

  // 说话人编号转成好认的名字：字幕里的人名原样；AI 认出的 A、B 去掉前缀；语音识别、>> 换人的编号写成「说话人1」
  // 只用于显示。配音和保存都用原始编号，spk:0、asr:0、S1 是三个人。
  WDub.speakerLabel = function (id) {
    const s = String(id ?? '');
    let m;
    if (s.startsWith('ai:')) return s.slice(3);
    if ((m = s.match(/^spk:(\d+)$/))) return `说话人${Number(m[1]) + 1}`;
    if ((m = s.match(/^asr:(\d+)$/))) return `说话人${Number(m[1]) + 1}`;
    if ((m = s.match(/^S([01])$/))) return `说话人${m[1] === '1' ? 1 : 2}`;
    return s;
  };

  // spk:、asr:、S0、S1 每个视频都从头编号，所以声音只对当前视频生效。
  const LOCAL_SPEAKER = /^(?:spk:\d+|asr:\d+|s[01])$/i;
  function speakerIdIsLocal(id) {
    return LOCAL_SPEAKER.test(String(id ?? '').replace(/\s+/g, ''));
  }
  function sameSpeakerId(a, b) {
    const k = (x) => String(x ?? '').toLowerCase().replace(/\s+/g, '');
    return !!k(a) && k(a) === k(b);
  }
  function personId(person) {
    if (!person || typeof person !== 'object') return '';
    if (person.id) return person.id;
    if (person.name != null) return person.name;
    return '';
  }

  WDub.enabledPackIds = function (settings) {
    const raw = Array.isArray(settings?.rules?.packs) ? settings.rules.packs : [];
    return WDub.TERM_PACKS.map((p) => p.id).filter((id) => raw.includes(id));
  };

  WDub.termFingerprint = function (settings, suggested = []) {
    const rows = (settings?.rules?.glossary || []).filter((row) => row).map((row) => [row.on === false ? 0 : 1, row.src || '', row.dst || '']);
    return WDub.hash(JSON.stringify([settings?.rules?.enabled ? 1 : 0, settings?.rules?.packMode || 'manual', WDub.activePackIds(settings, suggested), rows]));
  };

  // 缓存的命名空间和提示词版本：提示词或缓存格式变了就改版本号，旧译文自动失效，不需要手动清缓存
  WDub.PROMPT_VERSION = 'v3';
  WDub.CACHE_NAMESPACE = 'tr:v3:';

  // 影响「同一句会翻成什么」的全部配置。声音和外观不在里面，改字号、换音色不会触发整片重翻。
  WDub.translationFingerprint = function (settings) {
    const rules = settings?.rules || {};
    const rows = (rules.glossary || []).filter((row) => row).map((row) => [row.on === false ? 0 : 1, row.src || '', row.dst || '']);
    const packs = rules.packMode === 'manual' ? WDub.enabledPackIds(settings) : [];
    const replaces = (list) => (list || []).filter((r) => r && r.find && r.on !== false).map((r) => [r.find, r.repl ?? '']);
    return WDub.hash(JSON.stringify([
      WDub.PROMPT_VERSION,
      settings?.sourceLang || 'auto',
      settings?.targetLang || '',
      settings?.translator || '',
      settings?.llm?.provider || '', settings?.llm?.baseUrl || '', settings?.llm?.model || '',
      settings?.llm?.domainHint || '', settings?.llm?.detectSpeakers ? 1 : 0,
      rules.enabled ? 1 : 0, rules.packMode || '', packs,
      rows, replaces(rules.preReplace), replaces(rules.postReplace)
    ]));
  };

  WDub.knownGender = function (value) {
    return value === 'm' || value === 'f' ? value : null;
  };

  WDub.voicePerson = function (id, voice, videoKey) {
    const raw = String(id ?? '').trim().slice(0, 80);
    if (!raw) return null;
    const person = { id: raw, voice: voice ?? '' };
    if (speakerIdIsLocal(raw) && videoKey) person.video = videoKey;
    return person;
  };

  WDub.findVoiceBinding = function (people, speakerId, videoKey) {
    const local = speakerIdIsLocal(speakerId);
    return (Array.isArray(people) ? people : []).findIndex((person) => {
      if (!sameSpeakerId(personId(person), speakerId)) return false;
      if (local) return String(person.video || '') === String(videoKey || '');
      return !person.video;
    });
  };

  // 某个配音引擎可选的声音 [[值, 显示名]]。systemVoices 来自 chrome.tts.getVoices；account 是 ElevenLabs 账号里的声音
  WDub.voiceOptions = function (engine, s, systemVoices = [], account = []) {
    if (engine === 'azure') return WDub.AZURE_VOICES;
    if (engine === 'elevenlabs') return [...account, ...WDub.ELEVENLABS_VOICES.filter(([v]) => !account.some(([x]) => x === v))];
    const base = WDub.langBase(s.targetLang);
    const match = systemVoices.filter((v) => WDub.langBase(v.lang) === base);
    return (match.length ? match : systemVoices).map((v) => [v.voiceName, `${v.voiceName}${v.remote ? ' · 在线' : ''} · ${v.lang || ''}`]);
  };

  // 用 key 读出 ElevenLabs 账号里的声音（自带的、从声音库添加的、自己克隆的），失败返回空列表
  WDub.fetchElevenVoices = async function (key) {
    if (!key) return [];
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
      if (!res.ok) return [];
      const { voices = [] } = await res.json();
      const sex = { male: '男', female: '女' };
      return voices.map((v) => [v.voice_id, [v.name, sex[v.labels?.gender], v.category === 'cloned' ? '克隆' : ''].filter(Boolean).join(' · ')]);
    } catch {
      return [];
    }
  };

  // 翻译专用模型（腾讯混元 MT 等）：只会逐句直译，不能按 JSON 返回、也不能判断说话人
  WDub.isMtModel = (model) => /hy-mt|hunyuan-mt|seed-x|nllb|madlad|opus-mt|tower/i.test(model || '');

  WDub.isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

  WDub.deepMerge = function deepMerge(base, patch) {
    if (!WDub.isPlainObject(patch)) return structuredClone(base);
    const out = structuredClone(base);
    for (const [k, v] of Object.entries(patch)) {
      out[k] = WDub.isPlainObject(v) && WDub.isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
    }
    return out;
  };

  // 旧版本的设置：key 分散在各功能里（llm.apiKey、tts.azure.key、asr.openai.baseUrl…），搬到 keys / local 里
  WDub.migrate = function (raw) {
    if (!WDub.isPlainObject(raw) || raw.v >= 3) return raw;
    const s = raw.v >= 2 ? structuredClone(raw) : migrateV2(raw);
    // v3：设置页精简了引擎，原来选的引擎不在列表里时换成保留的
    const keep = (list, v) => v == null || list.some(([x]) => x === v);
    if (s.llm && !keep(WDub.LLM_PROVIDERS, s.llm.provider)) Object.assign(s.llm, { provider: 'deepseek', model: 'deepseek-chat' });
    if (s.tts && !keep(WDub.TTS_ENGINES, s.tts.engine)) s.tts.engine = 'system';
    if (s.asr && !keep(WDub.ASR_ENGINES, s.asr.engine)) s.asr.engine = s.asr.engine === 'doubao' ? 'sensevoice' : 'local';
    s.v = 3;
    return s;
  };

  function migrateV2(raw) {
    const s = structuredClone(raw);
    const keys = (s.keys = WDub.isPlainObject(s.keys) ? s.keys : {});
    const local = (s.local = WDub.isPlainObject(s.local) ? s.local : {});
    const put = (k, v) => v && !keys[k] && (keys[k] = v);
    const host = (u) => { try { return new URL(u).host; } catch { return ''; } };
    const isLocal = (u) => /^(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(host(u));
    const providerOf = (u) => Object.keys(WDub.PROVIDERS).find((p) => WDub.PROVIDERS[p].base && host(WDub.PROVIDERS[p].base) === host(u));

    // 旧版只保存改过的项：没存地址说明用的是当时的默认地址（翻译 DeepSeek、配音 OpenAI）
    const llm = s.llm || {};
    const llmUrl = llm.baseUrl || (llm.apiKey ? WDub.PROVIDERS.deepseek.base : '');
    if (llmUrl) {
      const p = providerOf(llmUrl);
      if (p) (llm.provider = p), put(p, llm.apiKey);
      else if (/:11434/.test(llmUrl)) (llm.provider = 'ollama'), (local.ollama = llmUrl);
      else (llm.provider = 'custom'), (llm.custom = { baseUrl: llmUrl, apiKey: llm.apiKey || '' });
    }
    delete llm.baseUrl, delete llm.apiKey;

    const tts = s.tts || {};
    if (tts.azure) {
      keys.azure = { key: keys.azure?.key || tts.azure.key || '', region: tts.azure.region || keys.azure?.region || 'eastasia' };
      delete tts.azure.key, delete tts.azure.region;
    }
    if (tts.elevenlabs) put('elevenlabs', tts.elevenlabs.apiKey), delete tts.elevenlabs.apiKey;
    if (tts.openai?.baseUrl || tts.openai?.apiKey) {
      const o = tts.openai;
      o.baseUrl = o.baseUrl || WDub.PROVIDERS.openai.base;
      if (providerOf(o.baseUrl) === 'openai') put('openai', o.apiKey);
      else if (/:8880|kokoro/i.test(o.baseUrl)) {
        local.kokoro = o.baseUrl;
        if (tts.engine === 'openai') tts.engine = 'kokoro';
      } else {
        tts.custom = { baseUrl: o.baseUrl, apiKey: o.apiKey || '', model: o.model || '' };
        if (tts.engine === 'openai') tts.engine = 'custom';
      }
      if (tts.engine !== 'openai') delete o.model;
      delete o.baseUrl, delete o.apiKey;
    }

    const asr = s.asr || {};
    const o = asr.openai;
    if (asr.engine === 'openai' || o) {
      const url = o?.baseUrl || 'http://127.0.0.1:8199/v1';
      let engine = 'local';
      if (isLocal(url)) (local.asr = url), (asr.local = { model: o?.model || 'mlx-community/whisper-large-v3-turbo' });
      else if (providerOf(url) === 'groq') (engine = 'groq'), put('groq', o.apiKey), (asr.groq = { model: o.model });
      else if (providerOf(url) === 'openai') (engine = 'openai'), put('openai', o.apiKey), (asr.openai = { model: o.model });
      else (engine = 'custom'), (asr.custom = { baseUrl: url, apiKey: o.apiKey || '', model: o.model || '' });
      if (asr.engine === 'openai' || !asr.engine) asr.engine = engine;
      if (engine !== 'openai') delete asr.openai;
    }
    if (asr.sensevoice) asr.sensevoice.baseUrl && isLocal(asr.sensevoice.baseUrl) && (local.asr = asr.sensevoice.baseUrl), delete asr.sensevoice;
    if (asr.elevenlabs) put('elevenlabs', asr.elevenlabs.apiKey), delete asr.elevenlabs.apiKey;
    if (asr.azure) {
      if (asr.azure.key && !keys.azure?.key) keys.azure = { key: asr.azure.key, region: asr.azure.region || 'eastasia' };
      delete asr.azure;
    }
    if (asr.doubao) {
      if (asr.doubao.appKey || asr.doubao.accessKey) keys.doubao = { appKey: asr.doubao.appKey || '', accessKey: asr.doubao.accessKey || '' };
      delete asr.doubao;
    }
    s.v = 2;
    return s;
  }

  // 由「选了哪家 + keys」推出各功能实际用的地址和 key（只在内存里，不保存）。
  // 后台、配音、识别仍然读 s.llm.baseUrl / s.tts[engine] / s.asr[engine]，不用关心 key 放在哪。
  WDub.resolve = function (s) {
    const P = WDub.PROVIDERS, k = s.keys, l = s.local;
    const llm = s.llm;
    if (llm.provider === 'custom') Object.assign(llm, { baseUrl: llm.custom.baseUrl, apiKey: llm.custom.apiKey });
    // 本地 Ollama 不需要 key，给个占位值，表示「已配置」
    else if (llm.provider === 'ollama') Object.assign(llm, { baseUrl: l.ollama, apiKey: 'ollama' });
    else Object.assign(llm, { baseUrl: P[llm.provider]?.base || '', apiKey: k[llm.provider] || '' });

    const t = s.tts;
    Object.assign(t.azure, { key: k.azure.key, region: k.azure.region });
    t.elevenlabs.apiKey = k.elevenlabs;
    Object.assign(t.openai, { baseUrl: P.openai.base, apiKey: k.openai });
    t.kokoro = { baseUrl: l.kokoro, apiKey: '', model: 'kokoro' };

    const a = s.asr;
    a.local = { ...a.local, baseUrl: l.asr, apiKey: '' };
    a.sensevoice = { baseUrl: l.asr, apiKey: '', model: 'iic/SenseVoiceSmall' };
    a.groq = { ...a.groq, baseUrl: P.groq.base, apiKey: k.groq };
    a.openai = { ...a.openai, baseUrl: P.openai.base, apiKey: k.openai };
    a.elevenlabs = { ...a.elevenlabs, apiKey: k.elevenlabs };
    a.azure = { key: k.azure.key, region: k.azure.region };
    a.doubao = { appKey: k.doubao.appKey, accessKey: k.doubao.accessKey, resourceId: 'volc.bigasr.auc_turbo' };
    return s;
  };

  // 属于「密钥」的项：导出时默认不带，也不进 Chrome 同步
  WDub.SECRET_PATHS = ['keys', 'llm.custom.apiKey', 'study.custom.apiKey', 'study.codex.token', 'tts.custom.apiKey', 'asr.custom.apiKey', 'asr.local.token'];
  const pathGet = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
  const pathSet = (o, p, v) => {
    const ks = p.split('.');
    const parent = ks.slice(0, -1).reduce((x, k) => (x[k] = WDub.isPlainObject(x[k]) ? x[k] : {}), o);
    parent[ks.at(-1)] = v;
  };
  // 去掉密钥后的设置
  WDub.stripSecrets = function (raw) {
    const s = structuredClone(raw || {});
    for (const p of WDub.SECRET_PATHS) {
      const ks = p.split('.');
      const parent = pathGet(s, ks.slice(0, -1).join('.')) ?? (ks.length === 1 ? s : null);
      if (parent) delete parent[ks.at(-1)];
    }
    return s;
  };
  // 只取密钥
  WDub.pickSecrets = (raw) => Object.fromEntries(WDub.SECRET_PATHS.map((p) => [p, pathGet(raw, p)]).filter(([, v]) => v !== undefined && v !== ''));
  // 把密钥放回设置（from 是 pickSecrets 的结果）
  WDub.putSecrets = function (raw, from) {
    const s = structuredClone(raw || {});
    for (const [p, v] of Object.entries(from || {})) if (WDub.SECRET_PATHS.includes(p)) pathSet(s, p, structuredClone(v));
    return s;
  };

  WDub.fromStored = (raw) => {
    const s = WDub.deepMerge(WDub.DEFAULTS, WDub.migrate(raw) || {});
    // 旧用户已经手选过词库时，保留原选择；新用户默认按视频自动选择。
    if (!raw?.rules?.packMode && raw?.rules?.packs?.length) s.rules.packMode = 'manual';
    if (globalThis.WDubMobile) {
      if (!raw?.tts?.engine || !WDub.TTS_ENGINES.some(([id]) => id === s.tts.engine)) s.tts.engine = 'azure';
      if (!raw?.asr?.engine || !WDub.ASR_ENGINES.some(([id]) => id === s.asr.engine)) s.asr.engine = 'elevenlabs';
      if (!raw?.asr?.elevenlabs?.model) s.asr.elevenlabs.model = 'scribe_v2';
    }
    return WDub.resolve(s);
  };

  WDub.getSettings = async function () {
    const { settings } = await chrome.storage.local.get('settings');
    return WDub.fromStored(settings);
  };

  // 按路径写入一个设置，例如 setSetting('audio.dubVolume', 0.8)。
  // 读-改-写排队执行，避免同时改两个设置时后写的覆盖先写的。
  let writeQueue = Promise.resolve();
  function writeSettings(pairs) {
    const run = async () => {
      const stored = (await chrome.storage.local.get('settings')).settings;
      const settings = WDub.migrate(stored) || { v: 3 };
      for (const [path, value] of Object.entries(pairs)) {
        const keys = path.split('.');
        let node = settings;
        for (const k of keys.slice(0, -1)) node = node[k] = WDub.isPlainObject(node[k]) ? node[k] : {};
        node[keys.at(-1)] = value;
      }
      settings.at = Date.now(); // 修改时间，Chrome 同步时用来判断哪边更新
      await chrome.storage.local.set({ settings });
    };
    writeQueue = writeQueue.then(run, run);
    return writeQueue;
  }
  WDub.setSetting = (path, value) => writeSettings({ [path]: value });
  WDub.setSettings = writeSettings;

  // 用户选定的声音就是实际引擎；缺 key 由启动入口明确提示，不能暗中换成系统声音。
  WDub.ttsEngine = (s) => s.tts.engine;

  // 某个功能还缺哪家的 key（null 表示不缺）。用于设置页和弹窗提示「去填写」
  WDub.missingKey = function (s, what) {
    const need = (p) => (p === 'azure' ? !s.keys.azure.key : p === 'doubao' ? !(s.keys.doubao.appKey && s.keys.doubao.accessKey) : !s.keys[p]);
    let p = null;
    if (what === 'llm' && s.translator === 'llm') p = WDub.PROVIDERS[s.llm.provider] ? s.llm.provider : null;
    if (what === 'tts') p = ['azure', 'elevenlabs', 'openai'].includes(s.tts.engine) ? s.tts.engine : null;
    if (what === 'asr') p = ['groq', 'openai', 'elevenlabs', 'azure', 'doubao'].includes(s.asr.engine) ? s.asr.engine : null;
    return p && need(p) ? p : null;
  };

  WDub.saveSettings = (settings) => chrome.storage.local.set({ settings: { ...settings, v: 3, at: Date.now() } });

  WDub.onSettingsChanged = function (cb) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) cb(WDub.fromStored(changes.settings.newValue));
    });
  };

  WDub.hash = function (str) {
    // FNV-1a 32 位，够用作缓存键
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  };

  // 写入扩展自己的静态模板。YouTube 开启了 Trusted Types，如果直接赋值被拦截，就改用策略对象再写一次
  let ttPolicy;
  WDub.setHTML = function (el, html) {
    try {
      el.innerHTML = html;
    } catch (e) {
      if (!globalThis.trustedTypes) throw e;
      ttPolicy = ttPolicy || trustedTypes.createPolicy('wdub', { createHTML: (s) => s });
      el.innerHTML = ttPolicy.createHTML(html);
    }
  };

  // 统一的线条图标（24×24，1.8 线宽，颜色跟随文字），弹窗、面板、设置页共用
  const svg = (d) =>
    `<svg class="wi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  WDub.ICONS = {
    // 星光滑杆：上面的滑块是一颗四角星，W 声幕专属的设置图标
    settings: svg('<path d="M4 8h6.5M17.5 8H20M4 16h3M12.5 16H20"/><path d="M14 4.6l.95 2.45 2.45.95-2.45.95L14 11.4l-.95-2.45L10.6 8l2.45-.95z" fill="currentColor" stroke-width="1.2"/><circle cx="9.8" cy="16" r="2"/>'),
    import: svg('<path d="M12 4v10M8 10l4 4 4-4"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>'),
    export: svg('<path d="M12 14V4M8 8l4-4 4 4"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>'),
    summary: svg('<path d="M12 3.5l1.6 4.2 4.2 1.6-4.2 1.6L12 15.1l-1.6-4.2-4.2-1.6 4.2-1.6z"/><path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    chevron: svg('<path d="M6 9l6 6 6-6"/>'),
    film: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M10 9.5v5l4.5-2.5z"/>')
  };

  // 外观：在根元素（扩展页面的 <html>，或视频上界面的 Shadow DOM 宿主）上标记亮色 / 暗色；跟随系统时不标记，交给媒体查询
  WDub.applyTheme = function (el, theme) {
    if (theme === 'light' || theme === 'dark') el.dataset.theme = theme;
    else delete el.dataset.theme;
  };

  // 品牌标志「格中篆」：练字方格里的 WL 连写，一点印泥金，颜色跟随文字。
  // 页面里用的是去掉刻度、线条加粗的小尺寸版本（带刻度的完整版只用在 icons/logo.svg）
  WDub.markParts = () =>
    '<rect class="wl-frame" x="4" y="4" width="40" height="40" rx="3" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".5"/>' +
    '<path class="wl-glyph" d="M12.5 13v22l6.5-8.5 6.5 8.5V13M25.5 35h11" fill="none" stroke="currentColor" stroke-width="4.6" stroke-linecap="square"/>' +
    '<circle class="wl-dot" cx="36.5" cy="14" r="2.6" style="fill:var(--accent,#f3cf7a)"/>';
  WDub.mark = (cls = 'wl') => `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true">${WDub.markParts()}</svg>`;

  // 视频上的界面（面板、按钮组、加载卡片）在 Shadow DOM 里，单独带一份主题变量；宿主元素上用 data-theme 固定亮 / 暗
  const DARK = `--bg:#0b1024;--glass:rgba(16,22,45,.86);--glass-hi:linear-gradient(160deg,rgba(223,229,247,.09),rgba(223,229,247,.015) 55%);
    --field:rgba(223,229,247,.06);--field-hi:rgba(223,229,247,.12);--line:rgba(223,229,247,.14);--line-strong:rgba(223,229,247,.32);
    --text:#dfe5f7;--muted:#a9b3d6;--faint:#6b7499;--accent:#f3cf7a;--accent-2:#ffe2a6;--primary:#dfe5f7;--primary-ink:#0b1024;
    --danger:#ffb4a8;--warn:#f3cf7a;--shadow:0 20px 50px -18px rgba(0,0,0,.8);color-scheme:dark;`;
  const LIGHT = `--bg:#f3f5fb;--glass:rgba(250,251,255,.9);--glass-hi:linear-gradient(160deg,rgba(255,255,255,.95),rgba(255,255,255,.5) 55%);
    --field:rgba(20,26,51,.05);--field-hi:rgba(20,26,51,.09);--line:rgba(20,26,51,.1);--line-strong:rgba(20,26,51,.26);
    --text:#141a33;--muted:#5a6488;--faint:#949cb8;--accent:#b07d22;--accent-2:#d9a441;--primary:#141a33;--primary-ink:#f3f5fb;
    --danger:#c4473a;--warn:#a86c12;--shadow:0 20px 50px -22px rgba(20,26,51,.45);color-scheme:light;`;
  WDub.HOST_THEME_CSS = `:host{${DARK}--radius:6px;--font:Outfit,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;--display:"ZCOOL KuaiLe","PingFang SC",sans-serif;}
    @media (prefers-color-scheme: light){:host(:not([data-theme=dark])){${LIGHT}}}
    :host([data-theme=light]){${LIGHT}}`;

  // 扩展自己的页面（弹窗、设置、本地播放器）自动应用外观设置，并在设置变化时跟着变
  if (typeof document !== 'undefined' && location.protocol === 'chrome-extension:' && chrome.storage?.local && chrome.storage?.onChanged) {
    const apply = (s) => WDub.applyTheme(document.documentElement, s.theme);
    WDub.getSettings().then(apply, () => {});
    WDub.onSettingsChanged(apply);
  }

  // 局域网 / 本机地址（只按地址字面判断，够挡住常见的内网探测）
  WDub.isPrivateHost = function (host) {
    host = String(host).replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || /^f[cd]|^fe80:/.test(host)) return true;
    const m = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
    if (!m) return false;
    const [a, b] = [+m[1], +m[2]];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  };

  WDub.langBase =(code) => (code || '').toLowerCase().split(/[-_]/)[0];
})();
