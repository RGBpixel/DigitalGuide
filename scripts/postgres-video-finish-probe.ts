import {loadNativeRuntimeConfig} from '../packages/postgres/src/runtime-config.js';
import {NativePostgresDatabase} from '../packages/postgres/src/runtime-database.js';
import {NativeCoreRepository} from '../packages/postgres/src/runtime-repository.js';
import {NativePackageWorker} from '../packages/postgres/src/runtime-package-worker.js';
const root=process.argv[3]??process.cwd(),db=await NativePostgresDatabase.open(loadNativeRuntimeConfig(process.argv[2]),'worker',root),repo=new NativeCoreRepository(db),original=repo.event.bind(repo);
repo.event=async(...args)=>{
 await original(...args);if(args[3]!=='media.video_ready')throw new Error('Unexpected video completion event');const transferId=args[2],r=(await db.query<{status:string;asset_id:string}>('SELECT status,asset_id FROM media_transfers WHERE id=$1',[transferId])).rows[0],a=(await db.query<{upload_id:string;storage_key:string;poster_key:string;preview_key:string|null}>('SELECT a.upload_id,u.storage_key,v.poster_key,p.storage_key AS preview_key FROM assets a JOIN uploads u ON u.id=a.upload_id JOIN video_sources v ON v.asset_id=a.id LEFT JOIN alpha_video_previews p ON p.asset_id=a.id WHERE a.id=$1',[r.asset_id])).rows[0];
 if(r.status!=='ready'||!a)throw new Error('Actual video not staged');console.log(JSON.stringify({phase:'native_video_finish_staged',transferId,assetId:r.asset_id,uploadId:a.upload_id,storageKeys:[a.storage_key,a.poster_key,...(a.preview_key?[a.preview_key]:[])]}));await new Promise<void>(()=>{/* Parent SIGKILL before COMMIT. Prior committed 90-second lease remains unchanged. */});
};
try{await new NativePackageWorker(repo,undefined,root).runOne();}finally{await db.close();}
