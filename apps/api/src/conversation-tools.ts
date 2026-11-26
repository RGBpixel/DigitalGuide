import { randomUUID } from 'node:crypto';
import type { Repository } from '@digitalguide/database';
import { AppError } from '@digitalguide/domain';
import type { SceneAppSnapshot, ToolProposal, ToolRequest } from '@digitalguide/contracts';
import type { SessionRow } from './reception-service.js';
export interface ToolRow { id: string; session_id: string; reply_id: string; app_id: string; tool_name: 'reception.handoff'|'restaurant.order_draft'|'restaurant.service_request'; status: ToolRequest['status']; focus_version: number; reply_epoch: number; expires_at: string;parameters?:string|null;preview?:string|null;source_message_id?:string|null }
export function toolView(r: ToolRow): ToolRequest { return { id: r.id, name: r.tool_name, label:r.tool_name==='restaurant.order_draft'?'保存可编辑点单草稿':r.tool_name==='restaurant.service_request'?'提交本次店员服务请求':'请求工作人员接待',...(r.preview?{preview:r.preview}:{}), status: r.status, expiresAt: r.expires_at }; }
export function cancelConversationTools(repo: Repository, sessionId: string) { repo.run("UPDATE conversation_tool_requests SET status='cancelled' WHERE session_id=? AND status='proposed'", sessionId); }
export function sweepConversationTools(repo: Repository, environment: string, appEnv: string) {
  repo.run("UPDATE conversation_tool_requests SET status='expired' WHERE status='proposed' AND (expires_at<=? OR EXISTS (SELECT 1 FROM reception_sessions s WHERE s.id=conversation_tool_requests.session_id AND (s.status<>'active' OR s.focus_version<>conversation_tool_requests.focus_version OR s.reply_epoch<>conversation_tool_requests.reply_epoch))) AND session_id IN (SELECT id FROM reception_sessions WHERE environment=? AND app_env=?)", new Date().toISOString(), environment, appEnv);
}
export function proposeConversationTools(repo: Repository, s: SessionRow, replyId: string, snapshot: SceneAppSnapshot, epoch: number, proposals: ToolProposal[]) {
  if (!proposals.length) return;
  for (const proposal of proposals.slice(0, 1)) {
    if (proposal.name !== 'reception.handoff' || !snapshot.tools.includes(proposal.name) || snapshot.scene !== 'reception') throw new AppError('TOOL_FORBIDDEN', '模型提出的工具不在当前场景白名单内，未执行。', 403);
    repo.run('INSERT INTO conversation_tool_requests(id,session_id,reply_id,app_id,tool_name,focus_version,reply_epoch,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)', randomUUID(), s.id, replyId, snapshot.id, proposal.name, s.focus_version, epoch, new Date(Math.min(Date.now() + 60000, Date.parse(s.expires_at))).toISOString(), new Date().toISOString());
  }
}
