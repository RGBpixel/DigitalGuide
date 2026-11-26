import { describe,it,expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import * as yazl from 'yazl';
import { blankStudioDocument,type PortableProject } from '@digitalguide/contracts';
import { syntheticPng } from '@digitalguide/media';
import { readProjectPackage } from '../../packages/media/src/project-package.js';
function project(): PortableProject { return { format: 'digitalguide-project',version: 1,name: '原创空白工程',purpose: 'video',document: blankStudioDocument(),assets: [],nonPortable: [],createdAt: new Date().toISOString(),rightsNotice: '原创测试' }; }
async function zip(entries: {name: string;bytes: Buffer;mode?: number}[]) { const z = new yazl.ZipFile();for (const e of entries) z.addBuffer(e.bytes,e.name,{ mode: e.mode });z.end();const chunks: Buffer[] = [];for await (const b of z.outputStream) chunks.push(b as Buffer);return Buffer.concat(chunks); }
const manifest = (p: PortableProject) => ({ name: 'project.json',bytes: Buffer.from(JSON.stringify(p)) });
async function read(bytes: Buffer) { const dir = path.resolve('storage/test-runs/package-'+randomUUID());fs.mkdirSync(dir,{ recursive: true });const file = path.join(dir,'input.zip');fs.writeFileSync(file,bytes);return readProjectPackage(file,dir,new AbortController().signal,() => {}); }
describe('开放工程ZIP内容验证',() => {
  it('清单可放在末尾，合法PNG逐项解压并核对哈希',async () => { const p = project(),bytes = syntheticPng(),id = randomUUID();p.document.brand.logoAssetId = id;p.assets.push({ id,name: '原创图',category: 'reference',file: 'assets/'+id+'.png',mediaType: 'image/png',size: bytes.length,sha256: createHash('sha256').update(bytes).digest('hex'),specs: { width: 360,height: 240 },expiresAt: null });const r = await read(await zip([{ name: p.assets[0].file,bytes },manifest(p)]));expect(fs.readFileSync(r.files[id]).equals(bytes)).toBe(true); });
  it('拒绝路径穿越、绝对路径与Windows反斜杠，不向目标目录外写入',async () => {
    for (const bad of ['../evil.txt','C:/evil.txt','a\\evil.txt']) { const safe = 'x'.repeat(Buffer.byteLength(bad)),bytes = await zip([{ name: safe,bytes: Buffer.from('test') },manifest(project())]);let offset = 0;while ((offset = bytes.indexOf(safe,offset)) !== -1) { bytes.write(bad,offset,'ascii');offset += safe.length; }await expect(read(bytes)).rejects.toThrow(); }
  });
  it('拒绝重复清单、符号链接和额外文件',async () => { const p = project();await expect(read(await zip([manifest(p),manifest(p)]))).rejects.toThrow();await expect(read(await zip([{ ...manifest(p),mode: 0o120777 }]))).rejects.toThrow();await expect(read(await zip([manifest(p),{ name: 'extra.txt',bytes: Buffer.from('extra') }]))).rejects.toThrow(); });
  it('拒绝高压缩比例、加密标记与CRC破坏',async () => {
    const id = randomUUID();await expect(read(await zip([manifest(project()),{ name: 'assets/'+id+'.wav',bytes: Buffer.alloc(2*1024*1024) }]))).rejects.toThrow();
    const bytes = await zip([manifest(project())]);for (let i = 0;i+46 < bytes.length;i++) if (bytes.readUInt32LE(i) === 0x02014b50) { bytes.writeUInt16LE(bytes.readUInt16LE(i+8)|1,i+8);break; }await expect(read(bytes)).rejects.toThrow();
    const crc = await zip([manifest(project())]);for (let i = 0;i+46 < crc.length;i++) if (crc.readUInt32LE(i) === 0x02014b50) { crc.writeUInt32LE((crc.readUInt32LE(i+16)^1)>>>0,i+16);break; }await expect(read(crc)).rejects.toThrow();
  });
  it('拒绝缺失清单、非法UTF8和未知格式版本',async () => { await expect(read(await zip([]))).rejects.toThrow();await expect(read(await zip([{ name: 'project.json',bytes: Buffer.from([0xff,0xfe,0xfd]) }]))).rejects.toThrow();const p = { ...project(),version: 9 };await expect(read(await zip([{ name: 'project.json',bytes: Buffer.from(JSON.stringify(p)) }]))).rejects.toThrow(); });
  it('缺失包内素材不能回退引用本地资产，模型或文档绑定不能夹带',async () => { const p = project();p.document.brand.logoAssetId = '40000000-0000-4000-8000-000000000001';await expect(read(await zip([manifest(p)]))).rejects.toThrow();p.document.brand.logoAssetId = null;p.document.speakers[0].profileId = randomUUID();await expect(read(await zip([manifest(p)]))).rejects.toThrow(); });
  it('清单哈希错误、文件缺失及过期素材不能导入',async () => { const p = project(),id = randomUUID(),bytes = syntheticPng();p.document.brand.logoAssetId = id;p.assets.push({ id,name: '原创',category: 'reference',file: 'assets/'+id+'.png',mediaType: 'image/png',size: bytes.length,sha256: '0'.repeat(64),specs: { width: 360,height: 240 },expiresAt: null });await expect(read(await zip([manifest(p),{ name: p.assets[0].file,bytes }]))).rejects.toThrow();await expect(read(await zip([manifest(p)]))).rejects.toThrow();p.assets[0].expiresAt = '2000-01-01T00:00:00.000Z';await expect(read(await zip([manifest(p),{ name: p.assets[0].file,bytes }]))).rejects.toThrow(); });
});
