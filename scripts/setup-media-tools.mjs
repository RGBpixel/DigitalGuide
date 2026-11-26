import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn,spawnSync } from 'node:child_process';
import yauzl from 'yauzl';
const version = '9.0.2', hash = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba';
const url = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip';
if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('此固定安装包适用于 Windows x64；其他系统请配置独立验证的 FFMPEG_PATH 与 FFPROBE_PATH。');
const root = path.resolve('storage/tools/ffmpeg-9.0.2'), archive = path.join(root,'download.zip'); fs.mkdirSync(root,{ recursive: true });
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (!fs.existsSync(archive)) {
  await new Promise((resolve,reject) => { const child = spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',path.resolve('scripts/download-media-tools.ps1'),'-Source',url,'-Target',archive],{ windowsHide: true,stdio: 'inherit' });child.once('error',reject);child.once('exit',code => code === 0 ? resolve() : reject(Error('编码工具下载未完成，请稍后重试。'))); });
}
if (fs.statSync(archive).size > 140 * 1024 * 1024) throw Error('下载超过固定包大小限制，未执行。');
if (digest(archive) !== hash) throw Error('编码工具缓存与固定 SHA-256 不一致，未解压或执行。请检查 storage/tools/ffmpeg-9.0.2/download.zip。');
const extracted = {};
await new Promise((resolve,reject) => yauzl.open(archive,{ lazyEntries: true,validateEntrySizes: true },(error,zip) => {
  if (error || !zip) return reject(error); zip.on('error',reject); zip.on('end',resolve); let count = 0;
  zip.on('entry',entry => {
    if (++count > 100 || entry.uncompressedSize > 220 * 1024 * 1024) { zip.close(); return reject(Error('固定工具包目录异常。')); }
    const match = /^[^/]+\/(?:bin\/)?(ffmpeg\.exe|ffprobe\.exe|LICENSE|README\.txt)$/.exec(entry.fileName);
    if (!match) return zip.readEntry();
    zip.openReadStream(entry,async (err,stream) => { if (err || !stream) return reject(err); try {
      const chunks = []; for await (const chunk of stream) chunks.push(chunk); const bytes = Buffer.concat(chunks), sha256 = createHash('sha256').update(bytes).digest('hex'), file = path.join(root,match[1]);
      if (fs.existsSync(file)) { if (digest(file) !== sha256) throw Error('现有工具文件已变化，未覆盖：' + match[1]); } else fs.writeFileSync(file,bytes,{ flag: 'wx' });
      extracted[match[1]] = { sha256,bytes: bytes.length }; zip.readEntry();
    } catch (e) { zip.close(); reject(e); } });
  }); zip.readEntry();
}));
for (const name of ['ffmpeg.exe','ffprobe.exe']) { if (!extracted[name]) throw Error('工具包缺少 ' + name); const r = spawnSync(path.join(root,name),['-version'],{ encoding: 'utf8',windowsHide: true,timeout: 10000 }); if (r.status !== 0 || !r.stdout.startsWith(name.replace('.exe','') + ' version 9.0.2')) throw Error('编码工具版本检查失败。'); }
fs.writeFileSync(path.join(root,'media-tools.json'),JSON.stringify({ version,url,archiveSha256: hash,license: 'GPL-3.0-or-later build; retained LICENSE',verifiedAt: new Date().toISOString(),files: extracted },null,2)+'\n');
process.stdout.write('已校验本地 FFmpeg / ffprobe 9.0.2，未修改系统 PATH。\n');
