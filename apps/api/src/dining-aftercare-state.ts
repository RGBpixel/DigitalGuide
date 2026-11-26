import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import type { Config } from './config.js';
export function completeDiningServices(repo:Repository,partyId:string,actorId:string){
 const now=new Date().toISOString();for(const r of repo.all<{id:string}>("SELECT id FROM dining_service_requests WHERE party_id=? AND status IN ('requested','acknowledged')",partyId)){
  repo.run("UPDATE dining_service_requests SET status='cancelled',resolved_by=?,resolved_at=?,version=version+1,updated_at=? WHERE id=?",actorId,now,now,r.id);
  repo.run('INSERT INTO dining_service_events VALUES (?,?,?,?,?)',randomUUID(),r.id,actorId,'closed_with_dining',now);
 }
 repo.run('INSERT OR IGNORE INTO dining_farewells VALUES (?,?,?,?)',partyId,'感谢光临，本次就餐已由店员核对结束。祝您一路顺利；如愿意，可留下评价或单独授权本次回访。',actorId,now);
}
export function sweepDiningAftercare(repo:Repository,config:Pick<Config,'providerMode'|'appEnv'>,at=new Date()){
 const now=at.toISOString(),scope='party_id IN (SELECT p.id FROM dining_parties p JOIN restaurants r ON r.id=p.restaurant_id WHERE r.environment=? AND r.app_env=?)';
 const feedback=repo.run(`UPDATE dining_feedback SET status='expired',rating=NULL,comment='',version=version+1,updated_at=? WHERE status='active' AND expires_at<=? AND ${scope}`,now,now,config.providerMode,config.appEnv).changes;
 const consents=repo.run(`UPDATE dining_followup_consents SET status='expired',contact_cipher=NULL,contact_mask='已到期',version=version+1,updated_at=? WHERE status='active' AND expires_at<=? AND ${scope}`,now,now,config.providerMode,config.appEnv).changes;
 return {expiredFeedback:Number(feedback),expiredConsents:Number(consents)};
}
