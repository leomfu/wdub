const $ = (selector) => document.querySelector(selector);
const make = (tag, text, className = '') => {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
};
let entries = [];
let active = '';

function section(host, title, items, render) {
  if (!items?.length) return;
  host.append(make('h3', title));
  const list = make('ul', '');
  for (const item of items) {
    const row = document.createElement('li');
    if (item.at != null) row.append(make('span', WDub.Study.stamp(item.at), 'time'));
    row.append(render ? render(item) : make('span', item.text));
    list.append(row);
  }
  host.append(list);
}

async function show(entry) {
  active = entry.id;
  renderList();
  const reader = $('#reader');
  reader.replaceChildren(make('div', '正在读取纪要…', 'empty'));
  const record = (await chrome.storage.local.get(`study:record:${entry.id}`))[`study:record:${entry.id}`];
  if (active !== entry.id) return;
  if (!record?.data) return reader.replaceChildren(make('div', '这条纪要无法读取，可能已被浏览器清理。', 'empty'));
  const data = record.data;
  reader.replaceChildren(make('h2', record.title || '未命名视频'));
  reader.append(make('p', `${new Date(record.at).toLocaleString('zh-CN')} · ${record.provider || 'AI'} · ${record.model || '默认模型'}`, 'meta'));
  if (record.sourceUrl) {
    const link = make('a', '打开原视频', 'source');
    link.href = record.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    reader.append(link);
  }
  reader.append(make('p', data.oneLine || '已整理以下内容。', 'lead'));
  section(reader, '核心要点', data.keyPoints);
  section(reader, '明确决定', data.decisions);
  section(reader, '后续行动', data.actions);
  section(reader, '时间线', data.chapters, (item) => make('span', `${item.title}：${item.summary}`));
  section(reader, '关键概念', data.concepts, (item) => make('span', `${item.term}：${item.explain}`));
  if (data.questions?.length) {
    reader.append(make('h3', '自测题'));
    for (const question of data.questions) {
      const detail = document.createElement('details');
      detail.append(make('summary', question.q), make('p', question.a));
      reader.append(detail);
    }
  }
  if (record.videoId) {
    const key = `study-note:${WDub.hash(record.videoId)}`;
    const saved = (await chrome.storage.local.get(key))[key];
    if (saved && active === entry.id) reader.append(make('h3', '我的笔记'), make('div', saved, 'note'));
  }
}

function renderList() {
  const query = $('#search').value.trim().toLowerCase();
  const visible = entries.filter((item) => !query || String(item.title || '').toLowerCase().includes(query));
  $('#count').textContent = `共 ${visible.length} 条纪要`;
  const host = $('#history-list');
  host.replaceChildren();
  if (!visible.length) return host.append(make('div', entries.length ? '没有找到这个标题。' : '还没有纪要。打开视频后点 W 浮窗里的「学习纪要」即可生成。', 'empty'));
  for (const entry of visible) {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.toggle('on', active === entry.id);
    button.append(make('b', entry.title || '未命名视频'),
      make('small', `${new Date(entry.at).toLocaleDateString('zh-CN')} · ${entry.model || entry.provider || 'AI'}`));
    button.addEventListener('click', () => show(entry));
    host.append(button);
  }
}

$('#search').addEventListener('input', renderList);
(async () => {
  try {
    entries = (await chrome.storage.local.get('study:history'))['study:history'] || [];
    renderList();
    if (entries.length) show(entries[0]);
  } catch (e) { $('#reader').replaceChildren(make('div', `读取历史失败：${e.message}`, 'empty')); }
})();
