// Build a mobile browser extension into a new directory. Never overwrites an existing build.
import { cp, mkdtemp, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(fileURLToPath(new URL('../extension/', import.meta.url)));
const target = process.argv[2];
if (!['safari', 'firefox'].includes(target)) {
  throw new Error('用法：node tools/build-mobile.mjs safari|firefox [--out 新目录]');
}
const outIndex = process.argv.indexOf('--out');
const out = outIndex < 0 ? await mkdtemp(join(tmpdir(), `wdub-${target}-`)) : resolve(process.argv[outIndex + 1]);
if (outIndex >= 0) {
  if (!process.argv[outIndex + 1]) throw new Error('--out 后面需要新目录');
  try { await stat(out); throw new Error(`输出目录已存在：${out}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(out, { recursive: true });
}
await cp(source, out, {
  recursive: true,
  filter: (path) => !['offscreen'].some((skip) => path === join(source, skip) || path.startsWith(join(source, skip) + '/'))
});

const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
manifest.name = `W 声幕 · 手机${target === 'safari' ? ' Safari' : ' Firefox'}`;
manifest.description = '手机网页视频双语字幕与中文配音；无字幕时可用自备 ElevenLabs key 识别。';
manifest.permissions = ['storage', 'unlimitedStorage'];
delete manifest.commands;
delete manifest.content_security_policy;
manifest.content_scripts[1].js.unshift('mobile/flag.js');
manifest.content_scripts[1].js.splice(manifest.content_scripts[1].js.indexOf('content/main.js'), 0, 'mobile/audio.js');

if (target === 'safari') {
  manifest.background = { service_worker: 'mobile-safari-worker.js' };
  await writeFile(join(out, 'mobile-safari-worker.js'), "importScripts('mobile/flag.js', 'background.js');\n");
} else {
  manifest.manifest_version = 2;
  manifest.browser_action = manifest.action;
  delete manifest.action;
  manifest.permissions.push('<all_urls>');
  delete manifest.host_permissions;
  manifest.background = {
    scripts: ['mobile/flag.js', 'shared/defaults.js', 'shared/subtitles.js', 'shared/study.js', 'shared/term-match.js', 'mobile/cloud.js', 'background.js'],
    persistent: false
  };
  manifest.browser_specific_settings = {
    gecko: {
      id: 'wdub-mobile@wdub.invalid', strict_min_version: '140.0',
      data_collection_permissions: { required: ['authenticationInfo', 'websiteActivity', 'websiteContent'] }
    },
    gecko_android: { strict_min_version: '142.0' }
  };
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

async function inject(file, before, insertion) {
  const path = join(out, file);
  const html = await readFile(path, 'utf8');
  if (!html.includes(before)) throw new Error(`${file} 找不到插入位置：${before}`);
  await writeFile(path, html.replace(before, insertion + before));
}
for (const file of ['popup/popup.html', 'options/options.html', 'player/player.html']) {
  await inject(file, '<script src="../shared/defaults.js"></script>', '    <script src="../mobile/flag.js"></script>\n    ');
}
for (const file of ['popup/popup.html', 'options/options.html', 'player/player.html']) {
  const script = file.startsWith('popup/') ? 'popup.js' : file.startsWith('options/') ? 'options.js' : 'player.js';
  await inject(file, `<script src="${script}"></script>`, '    <script src="../mobile/audio.js"></script>\n    ');
}
// 独立分发的产物必须带齐许可和第三方说明（文档 I）
const repoRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  try {
    await cp(join(repoRoot, file), join(out, file));
  } catch {
    throw new Error(`打包缺少 ${file}：独立分发必须带齐许可与第三方说明`);
  }
}
await inject('player/player.html', '<script src="../shared/asr.js"></script>', '    <script src="../mobile/cloud.js"></script>\n    ');
const playerPath = join(out, 'player/player.html');
await writeFile(playerPath, (await readFile(playerPath, 'utf8'))
  .replace('<video id="video" controls hidden>', '<video id="video" controls playsinline hidden>'));
for (const file of ['popup/popup.html', 'options/options.html']) {
  const path = join(out, file);
  const html = await readFile(path, 'utf8');
  await writeFile(path, html.replace('<head>', '<head>\n    <meta name="viewport" content="width=device-width, initial-scale=1" />'));
}
console.log(`${target} 手机扩展已生成：${out}`);
