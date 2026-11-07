// Firefox 后台页面没有 importScripts，清单在 defaults.js 之后加载本文件，那时 WDubMobile 已经为真。
// 桌面内容脚本两者都没有，加载即失败，避免把整本词库打进网页。
// 必须包在函数里：后台脚本自己也声明了 WDub，顶层 const 会让服务工作线程在启动时直接退出，翻译全部失败。
if (typeof importScripts !== 'function' && !globalThis.WDubMobile) {
  throw new Error('term-match.js 只能由后台 importScripts 加载');
}

(function () {
const WDub = globalThis.WDub;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

function termNode() {
  return { kids: new Map(), hit: null };
}

function addTerm(root, src, dst, kind) {
  const key = String(src).toLowerCase();
  if (!key || !dst) return;
  let node = root;
  for (const ch of key) {
    let next = node.kids.get(ch);
    if (!next) node.kids.set(ch, (next = termNode()));
    node = next;
  }
  node.hit = { src: String(src), dst: String(dst), kind };
}

function buildTrie(packs, glossary) {
  const root = termNode();
  for (const rows of packs || []) {
    for (const row of rows || []) if (row?.src && row?.dst) addTerm(root, row.src, row.dst, 'reference');
  }
  for (const row of glossary || []) {
    if (!row || row.on === false || !row.src || !row.dst) continue;
    addTerm(root, row.src, row.dst, 'fixed');
  }
  return root;
}

function bounded(text, start, end) {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  return !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after);
}

function scanTerms(root, sentence) {
  const text = String(sentence ?? '').toLowerCase();
  const hits = [];
  for (let i = 0; i < text.length; i++) {
    let node = root;
    for (let j = i; j < text.length; j++) {
      node = node.kids.get(text[j]);
      if (!node) break;
      if (!node.hit) continue;
      if (!CJK.test(node.hit.src) && !bounded(text, i, j + 1)) continue;
      hits.push(node.hit);
    }
  }
  return hits;
}

function digestHits(hits) {
  return [...hits]
    .sort((a, b) => b.src.length - a.src.length || (a.src < b.src ? -1 : a.src > b.src ? 1 : 0))
    .map((hit) => `${hit.kind}\t${hit.src}\t${hit.dst}`)
    .join('\n');
}

WDub.matchTerms = function (sentence, packs, glossary) {
  return scanTerms(buildTrie(packs, glossary), sentence);
};

const tries = new Map();

async function packRows(id) {
  try {
    const res = await fetch(chrome.runtime.getURL(`terms/${id}.json`));
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!data || data.id !== id || !Array.isArray(data.parts)) throw new Error('shape');
    const rows = [];
    for (const part of data.parts) {
      if (!Array.isArray(part?.rows)) continue;
      for (const row of part.rows) if (row?.src && row?.dst) rows.push({ src: String(row.src), dst: String(row.dst) });
    }
    return rows;
  } catch (e) {
    console.warn(`术语包 ${id} 无法使用`, e);
    return [];
  }
}

function trieFor(settings) {
  if (!settings?.rules?.enabled) return Promise.resolve(termNode());
  const fp = WDub.termFingerprint(settings);
  const cached = tries.get(fp);
  if (cached) return cached;
  const pending = (async () => {
    const packs = [];
    for (const id of WDub.enabledPackIds(settings)) packs.push(await packRows(id));
    return buildTrie(packs, settings.rules.glossary);
  })();
  tries.set(fp, pending);
  pending.catch(() => tries.delete(fp));
  return pending;
}

// 缓存键必须能区分「哪一套配置产出的译文」，否则换语言、换模型会读到旧结果（4.1）
const SEP = '\u0001';
function keyParts(spec, to, text) {
  return [
    WDub.PROMPT_VERSION,
    spec?.provider || '', spec?.baseUrl || '', spec?.model || '', spec?.domainHint || '',
    spec?.detectSpeakers ? 1 : 0,
    spec?.from || 'auto', to, text
  ].join(SEP);
}

function llmKey(spec, to, text, hits) {
  const base = `llm${SEP}${keyParts(spec, to, text)}`;
  // 没有命中术语时沿用同一份键，已经翻过的句子不用整片重翻。
  if (!hits.length) return WDub.hash(base);
  return WDub.hash(`${base}${SEP}${digestHits(hits)}`);
}

function googleKey(spec, to, text) {
  return WDub.hash(['google', spec?.from || 'auto', to, text].join(SEP));
}

// 不带术语的计划：后台术语处理出错时用它兜底，缓存键仍与正常路径一致
WDub.translationKeys = function (spec, sentences) {
  const list = Array.isArray(sentences) ? sentences : [];
  const to = spec?.to ?? '';
  return list.map((text) => (spec?.engine === 'llm' ? llmKey(spec, to, text, []) : googleKey(spec, to, text)));
};

function usableGlossary(settings) {
  return (settings?.rules?.glossary || []).some((row) => row && row.on !== false && row.src && row.dst);
}

WDub.translationPlan = async function (settings, sentences, spec) {
  const list = Array.isArray(sentences) ? sentences : [];
  const to = spec?.to ?? '';
  if (spec?.engine !== 'llm') {
    return { hits: list.map(() => []), keys: list.map((text) => googleKey(spec, to, text)) };
  }
  const skip = !settings?.rules?.enabled || (!WDub.enabledPackIds(settings).length && !usableGlossary(settings));
  const trie = skip ? termNode() : await trieFor(settings);
  const hits = list.map((text) => {
    const found = scanTerms(trie, text);
    found.sort((a, b) => b.src.length - a.src.length);
    const kept = [];
    const seen = new Set();
    for (const hit of found) {
      const key = hit.src.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(hit);
      if (kept.length === 8) break;
    }
    return kept;
  });
  return { hits, keys: list.map((text, i) => llmKey(spec, to, text, hits[i])) };
};
})();
