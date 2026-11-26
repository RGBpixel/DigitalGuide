import fs from 'node:fs';
import {createHmac,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import cookie from '@fastify/cookie';
export function sharePreviewAccess(state:{ids:Record<string,string>}){
 const secret=fs.readFileSync('storage/.session-secret','utf8').trim(),db=new DatabaseSync('storage/digitalguide.sqlite',{readOnly:true});
 try{
  const s=db.prepare('SELECT id,link_id,nonce,token_hash,expires_at,consent,position_ms,event_count,version FROM studio_share_sessions WHERE id=?').get(state.ids.viewer) as {id:string;link_id:string;nonce:string;token_hash:string;expires_at:string;consent:number;position_ms:number;event_count:number;version:number}|undefined;
  assert.ok(s&&s.link_id===state.ids.link,'Only the owned original synthetic viewer is allowed.');
  const token=createHmac('sha256',secret).update('digitalguide-share-session-v1|'+s.id+'|'+s.nonce).digest('hex');assert.equal(createHash('sha256').update(token).digest('hex'),s.token_hash);
  return{cookie:'dg_share='+encodeURIComponent(cookie.sign(token,secret)),value:cookie.sign(token,secret),path:'/api/v1/external/shares/'+s.link_id,expiresAt:s.expires_at,state:{version:s.version,consent:!!s.consent,positionMs:s.position_ms,eventCount:s.event_count}};
 }finally{db.close();}
}
