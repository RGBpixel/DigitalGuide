import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Principal } from '@digitalguide/domain';
import { fileDigest,ownedFile } from '../../../packages/media/src/files.js';
import { writeProjectPackage } from '../../../packages/media/src/project-package.js';
import { studioPackageSnapshot } from '../../api/src/studio-package-service.js';
import type { StudioExports,ExportRow } from '../../api/src/studio-export-service.js';
export interface PreparedArtifact { id: string;kind: string;name: string;mediaType: string;storageKey: string;file: string;size: number;sha256: string }
export async function preparePackageExport(service: StudioExports,owner: Principal,row: ExportRow,directory: string,signal: AbortSignal,onProgress: (progress: number) => void) {
  const project = service.studio.project(owner,row.project_id),plan = service.plan(owner,project,service.request(row)),snapshot = studioPackageSnapshot(service.studio,owner,project);fs.mkdirSync(directory,{ recursive: true });
  const zipFile = ownedFile(directory,randomUUID()+'.zip');await writeProjectPackage({ ...snapshot,objects: path.join(service.dataDir,'objects'),file: zipFile },signal,onProgress);
  const projectFile = ownedFile(directory,randomUUID()+'.json');fs.writeFileSync(projectFile,JSON.stringify(snapshot.portable,null,2),{ flag: 'wx' });
  const artifacts: PreparedArtifact[] = [];
  for (const [kind,file,ext,mediaType] of [['package',zipFile,'.zip','application/zip'],['project',projectFile,'.json','application/json']]) artifacts.push({ id: randomUUID(),kind,file,name: project.name+(kind === 'package' ? '-project.zip' : '-project.json'),mediaType,storageKey: randomUUID()+ext,...await fileDigest(file,signal) });
  const manifestFile = ownedFile(directory,randomUUID()+'.json');fs.writeFileSync(manifestFile,JSON.stringify({ format: 'digitalguide-project-delivery',version: 1,projectVersion: row.project_version,planHash: plan.hash,assets: snapshot.portable.assets,nonPortable: snapshot.portable.nonPortable,files: artifacts.map(a => ({ kind: a.kind,name: a.name,size: a.size,sha256: a.sha256 })),createdAt: new Date().toISOString() },null,2),{ flag: 'wx' });
  artifacts.push({ id: randomUUID(),kind: 'manifest',file: manifestFile,name: project.name+'-package-manifest.json',mediaType: 'application/json',storageKey: randomUUID()+'.json',...await fileDigest(manifestFile,signal) });return { artifacts,warnings: plan.warnings };
}
