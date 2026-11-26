import fs from 'node:fs';
const edit=(f,a,b)=>{const s=fs.readFileSync(f,'utf8');if(!s.includes(a))throw Error('Missing '+f);fs.writeFileSync(f,s.replace(a,b));};
edit('packages/postgres/src/runtime-database.ts','manifest.version!==28','manifest.version!==29');
edit('scripts/native-ae-render-init.ts',"file='migrations/postgres/032-native-ae-render-media.sql',cluster", "file='migrations/postgres/032-native-ae-render-media.sql',label=process.argv[2]??'first',cluster");
edit('scripts/native-ae-render-init.ts',"root+'/init-first.json'","root+'/init-'+label+'.json'");
edit('scripts/native-ae-render-checks.mjs',"['--import','tsx','scripts/native-ae-render-init.ts']","['--import','tsx','scripts/native-ae-render-init.ts',label]");
