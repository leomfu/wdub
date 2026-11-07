// 下载公开词表，写成 extension/terms/<id>.json。简体转换只在这里做，扩展运行时不带转换器。
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import OpenCC from 'opencc-js';

// twp 会把台湾说法换成大陆说法。只转字形会留下「软体」「网路」，简体字幕并不这么说。
// 大陆列里有的词已经是简体，OpenCC 的词组表认不出，所以再换这几个。
const toCn = OpenCC.Converter({ from: 'twp', to: 'cn' });
function simplify(raw) {
  return toCn(String(raw ?? '')).replaceAll('网路', '网络').replaceAll('软体', '软件').replaceAll('硬体', '硬件').replaceAll('记忆体', '内存').replaceAll('数位', '数字');
}

// 一个格子里常常并列好几个义项，字幕只能强制用一个译法。
function cleanDst(raw) {
  let s = simplify(raw).replace(/\u00a0/g, ' ').replace(/【[^】]*】/g, '');
  s = s.replace(/\[([^\]]*)\]/g, '$1');
  s = s.replace(/\s+/g, ' ').trim();
  const piece = s.split(/[;；]/).map((part) => part.trim()).find(Boolean) || '';
  return piece.replace(/^[,，、]+|[,，、]+$/g, '').trim();
}

if (cleanDst('解壓[縮]【動】') !== '解压缩' || simplify('网路') !== '网络' || simplify('軟體') !== '软件') {
  throw new Error('简体转换或括号清理不对');
}

const EXTENSION_PROGRAMMING = `
function	函数
variable	变量
commit	提交
pull request	拉取请求
branch	分支
container	容器
model	模型
machine learning	机器学习
neural network	神经网络
token	词元
prompt	提示词
cache	缓存
thread	线程
deploy	部署
frontend	前端
backend	后端
API	接口
GPU	显卡
Git	Git
JSON	JSON
React	React
repository	仓库
merge	合并
bug	缺陷
debug	调试
compile	编译
runtime	运行时
framework	框架
library	库
dependency	依赖
array	数组
string	字符串
boolean	布尔值
class	类
method	方法
parameter	参数
return	返回值
loop	循环
exception	异常
stack	栈
memory	内存
database	数据库
query	查询
server	服务器
client	客户端
request	请求
response	响应
latency	延迟
algorithm	算法
asynchronous	异步
callback	回调
component	组件
compiler	编译器
open source	开源
refactor	重构
unit test	单元测试
process	进程
log	日志
module	模块
import	导入
export	导出
build	构建
diff	差异
conflict	冲突
embedding	嵌入
inference	推理
fine-tuning	微调
dataset	数据集
deep learning	深度学习
large language model	大语言模型
context window	上下文窗口
CPU	处理器
endpoint	端点
authentication	认证
hash	哈希
session	会话
virtual machine	虚拟机
code review	代码评审
object	对象
type	类型
error	错误
test	测试
push	推送
pull	拉取
clone	克隆
release	发布
render	渲染
package	软件包
cloud	云
training	训练
HTTP	HTTP
URL	网址
Docker	Docker
Promise	Promise
Transformer	Transformer
SDK	SDK
`.trim().split('\n').map((line) => {
  const [src, dst] = line.split('\t');
  return { src, dst };
});

if (EXTENSION_PROGRAMMING.length < 75 || EXTENSION_PROGRAMMING.length > 100) {
  throw new Error(`编程扩展词应大约 80 条，现在是 ${EXTENSION_PROGRAMMING.length}`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => value.trim()));
}

function column(header, names) {
  const norm = header.map((name) => name.replace(/\s/g, ''));
  for (const name of names) {
    const index = norm.findIndex((item) => item.includes(name));
    if (index >= 0) return index;
  }
  return -1;
}

function dedupe(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const src = String(row.src ?? '').replace(/\s+/g, ' ').trim();
    const dst = cleanDst(row.dst ?? '');
    if (!src || !dst) continue;
    const key = src.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ src, dst });
  }
  return out;
}

const naer = (file) => `https://opendata.naer.edu.tw/${['學術名詞', file].map(encodeURIComponent).join('/')}`;
const bankUrl = `https://www.cbc.gov.tw/Public/Data/${['資訊處', 'glossary.csv'].map(encodeURIComponent).join('/')}`;

const sources = [
  {
    id: 'learning',
    parts: [{ dataset: '15367', url: naer('國家教育研究院-教育學學術名詞.csv'), dst: 'traditional' }]
  },
  {
    id: 'programming',
    parts: [
      { dataset: '15275', url: naer('國家教育研究院-兩岸對照名詞-計算機學術名詞.csv'), dst: 'mainland' },
      { dataset: '15406', url: naer('國家教育研究院-資訊名詞-兩岸中小學教科書學術名詞.csv'), dst: 'mainland' },
      { license: 'extension', note: 'The rows were written for this extension.', rows: EXTENSION_PROGRAMMING }
    ]
  },
  {
    id: 'business',
    parts: [
      { dataset: '15440', url: naer('國家教育研究院-管理學學術名詞.csv'), dst: 'mainland-or-traditional' },
      { dataset: '15212', url: naer('國家教育研究院-市場學學術名詞.csv'), dst: 'traditional' }
    ]
  },
  {
    id: 'investing',
    parts: [
      { dataset: '15405', url: naer('國家教育研究院-經濟學學術名詞.csv'), dst: 'traditional' },
      { dataset: '170729', url: bankUrl, encoding: 'big5', dst: 'bank' }
    ]
  }
];

async function fetchText(url, encoding) {
  const res = await fetch(url, { headers: { 'User-Agent': 'WDub term pack build' } });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new TextDecoder(encoding || 'utf-8').decode(bytes);
}

function rowsFromTable(text, mode) {
  const table = parseCsv(text);
  const header = table[0] || [];
  const en = column(header, ['英文名稱', '英文名詞', '英文']);
  const zh = column(header, ['中文名稱', '中文名詞', '中文']);
  const mainland = column(header, ['中國大陸譯名', '中国大陆译名']);
  if (en < 0) throw new Error(`找不到英文列：${header.join(' | ')}`);
  if (mode !== 'bank' && mode !== 'traditional' && mainland < 0) throw new Error(`找不到大陆译名列：${header.join(' | ')}`);
  if ((mode === 'traditional' || mode === 'bank' || mode === 'mainland-or-traditional') && zh < 0) {
    throw new Error(`找不到中文列：${header.join(' | ')}`);
  }
  const out = [];
  for (const line of table.slice(1)) {
    const src = line[en] ?? '';
    let dst = '';
    if (mode === 'bank') dst = line[zh] ?? '';
    else if (mode === 'mainland') dst = line[mainland] ?? '';
    else if (mode === 'mainland-or-traditional') dst = (line[mainland] || '').trim() ? line[mainland] : (line[zh] ?? '');
    else dst = line[zh] ?? '';
    if (mode !== 'bank' && !String(src).trim()) continue;
    if (mode === 'bank' && !String(src).trim()) continue;
    out.push({ src, dst });
  }
  return dedupe(out);
}

const files = [];
for (const source of sources) {
  const parts = [];
  for (const part of source.parts) {
    const rows = part.rows ? dedupe(part.rows) : rowsFromTable(await fetchText(part.url, part.encoding), part.dst);
    if (!rows.length) throw new Error(`${source.id} ${part.dataset || 'extension'} 没有词条`);
    const body = { license: part.license || 'ogdi-tw-1.0', rows };
    if (part.dataset) body.dataset = part.dataset;
    if (part.note) body.note = part.note;
    parts.push(body);
    console.log(`${source.id} ${part.dataset || 'extension'} ${rows.length}`);
  }
  files.push({ id: source.id, parts });
}

const context = {};
vm.createContext(context);
vm.runInContext(readFileSync(new URL('../extension/shared/defaults.js', import.meta.url), 'utf8'), context);
const expected = context.WDub.TERM_PACKS.map((pack) => pack.id);
const written = files.map((file) => file.id);
if (written.join('\n') !== expected.join('\n')) {
  throw new Error(`写出的 id 是 ${written.join(',')}，TERM_PACKS 是 ${expected.join(',')}`);
}

const dir = new URL('../extension/terms/', import.meta.url);
await mkdir(dir, { recursive: true });
for (const file of files) {
  await writeFile(new URL(`${file.id}.json`, dir), JSON.stringify(file));
}
await writeFile(
  new URL('LICENSE.txt', dir),
  '政府資料開放授權條款第1版。資料集 15367、15275、15406、15440、15212、15405、170729。\n'
);
console.log('wrote', written.join(', '));
