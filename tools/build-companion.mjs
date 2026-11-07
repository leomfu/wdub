// Export the standalone mobile player as static files for HTTPS hosting or native app bundling.
import { cp, mkdtemp, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const outIndex = process.argv.indexOf('--out');
const out = outIndex < 0 ? await mkdtemp(join(tmpdir(), 'wdub-companion-')) : resolve(process.argv[outIndex + 1]);
if (outIndex >= 0) {
  if (!process.argv[outIndex + 1]) throw new Error('--out 后面需要新目录');
  try { await stat(out); throw new Error(`输出目录已存在：${out}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(out, { recursive: true });
}
await cp(join(root, 'mobile/companion'), out, { recursive: true });
await mkdir(join(out, 'scripts'));
await mkdir(join(out, 'assets'));
const scripts = {
  'flag.js': 'extension/mobile/flag.js',
  'defaults.js': 'extension/shared/defaults.js',
  'subtitles.js': 'extension/shared/subtitles.js',
  'overlay.js': 'extension/content/overlay.js',
  'engine.js': 'extension/content/engine.js',
  'cloud.js': 'extension/mobile/cloud.js',
  'audio.js': 'extension/mobile/audio.js'
};
for (const [name, source] of Object.entries(scripts)) await cp(join(root, source), join(out, 'scripts', name));
await cp(join(root, 'extension/icons/logo.svg'), join(out, 'assets/logo.svg'));
for (const name of Object.keys(scripts)) {
  const file = join(out, 'scripts', name);
  if (!(await readFile(file, 'utf8')).length) throw new Error(`脚本为空：${name}`);
}
// 独立分发的产物必须带齐许可和第三方说明（文档 I）
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  try {
    await cp(join(root, file), join(out, file));
  } catch {
    throw new Error(`打包缺少 ${file}：独立分发必须带齐许可与第三方说明`);
  }
}
console.log(`手机分享播放器已生成：${out}`);
