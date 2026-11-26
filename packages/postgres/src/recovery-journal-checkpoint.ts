import {createHash} from 'node:crypto';
import type pg from 'pg';
import {identifier} from './config.js';
import {RecoveryError} from '../../recovery/src/guard.js';
import {checkCancelled,type RecoveryLimits} from '../../recovery/src/files.js';
import {recoveryJournalCheckpointSchema,type RecoveryJournalCheckpoint} from './recovery-journal-format.js';

export async function nativeRecoveryJournalCheckpoint(client:pg.Client,schema:string,cap:RecoveryLimits,signal?:AbortSignal):Promise<RecoveryJournalCheckpoint|undefined>{
 if(!(await client.query('SELECT to_regclass($1) value',[identifier(schema)+'._dg_native_recovery_journal_control'])).rows[0].value)return undefined;
 const c=(await client.query('SELECT stream_id,public_key,coverage_sha256,jsonb_array_length(coverage)::int tracked FROM '+identifier(schema)+'._dg_native_recovery_journal_control WHERE id=1')).rows[0];if(!c)throw new RecoveryError('PG_JOURNAL_UNAVAILABLE','此原生实例缺少恢复日志信任根，不能声称覆盖恢复后的变化。');
 const hash=createHash('sha256');let count=0;await client.query('DECLARE dg_journal_checkpoint NO SCROLL CURSOR FOR SELECT id,event_hash FROM '+identifier(schema)+'._dg_native_recovery_journal_events ORDER BY id COLLATE "C"');
 try{for(;;){checkCancelled(signal);const page=await client.query<{id:string;event_hash:string}>('FETCH FORWARD 512 FROM dg_journal_checkpoint');if(!page.rows.length)break;for(const row of page.rows){if(++count>cap.maxRows)throw new RecoveryError('PG_JOURNAL_LIMIT_EXCEEDED','恢复日志数量超过备份容量。');hash.update(row.id+':'+row.event_hash+'\n');}}}finally{await client.query('CLOSE dg_journal_checkpoint');}
 return recoveryJournalCheckpointSchema.parse({version:1,streamId:c.stream_id,publicKey:c.public_key,coverageSHA256:c.coverage_sha256,eventCount:count,eventSetSHA256:hash.digest('hex'),trackedTables:c.tracked});
}
