import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root='docs/evidence/T20/postgres-media-processing/source-pre-listing';
fs.mkdirSync(root,{recursive:false});
const sourceSHA256={};for(const file of ['packages/postgres/src/runtime-assets.ts','packages/postgres/src/runtime-library.ts','apps/api/src/postgres-asset-routes.ts','tests/integration/postgres-processing.test.ts']){const buffer=fs.readFileSync(file),saved=root+'/'+file.replaceAll('/','__')+'.txt';fs.writeFileSync(saved,buffer,{flag:'wx'});sourceSHA256[file]={saved,sha256:createHash('sha256').update(buffer).digest('hex')};}
fs.writeFileSync(root+'/snapshot.json',JSON.stringify({createdAt:new Date().toISOString(),sourceSHA256,reason:'Actual compiled observation found revoked derived source blocked both asset lists. Preserve pre-fix source and original successful/failed observations.'},null,2)+'\n',{flag:'wx'});
