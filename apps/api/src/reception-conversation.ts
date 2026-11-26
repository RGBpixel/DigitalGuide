import { restaurantFinancialAnswer } from './restaurant-financial-context.js';
import { restaurantHospitalitySuggestion,proposeHospitalityRequest } from './restaurant-hospitality-tools.js';
import { restaurantAnswer } from './restaurant-context.js';
import { restaurantDraftSuggestion,proposeRestaurantDraft } from './restaurant-order-tools.js';
import type { Repository } from '@digitalguide/database';
import type { SceneAppSnapshot } from '@digitalguide/contracts';
import { AppError, type Principal } from '@digitalguide/domain';
import { selectRealtimeProvider } from '@digitalguide/providers';
import { ReceptionService, type SessionRow } from './reception-service.js';
import { MemoryService } from './memory-service.js';
import { SceneService } from './knowledge-service.js';
import { proposeConversationTools } from './conversation-tools.js';
import { cancelVisualRequests } from './visual-lifecycle.js';
export class ReceptionConversation {
  reception: ReceptionService;
  constructor(public repo: Repository, public environment: string, public appEnv: string) { this.reception = new ReceptionService(repo, environment, appEnv); }
  consume(row: SessionRow, text: string, requestId: string, decisionId?: string) {
    if (decisionId && !this.repo.get("SELECT id FROM speaker_segment_decisions WHERE id=? AND session_id=? AND focus_version=? AND attribution='target' AND final=1 AND accepted=1 AND simulated=1", decisionId, row.id, row.focus_version)) throw new AppError('SPEAKER_PROOF_REQUIRED', '缺少本次目标归属判定，语音未进入对话。', 409);
    if (decisionId && row.status !== 'active') throw new AppError('STATE_CONFLICT', '当前已转人工或结束，不能接收语音。', 409);
    if (this.repo.get<{ n: number }>("SELECT count(*) n FROM reception_messages WHERE session_id=? AND role='visitor' AND created_at>?", row.id, new Date(Date.now() - 60000).toISOString())!.n >= 20) throw new AppError('RATE_LIMITED', '输入过于频繁，请稍后再试或请求人工接待。', 429, true);
    if (this.repo.get<{ n: number }>('SELECT count(*) n FROM reception_messages WHERE session_id=?', row.id)!.n >= 200) throw new AppError('QUOTA_EXCEEDED', '本次会话已达到消息上限，请结束后重新开始。', 409);
    cancelVisualRequests(this.repo, row.id); this.reception.cancelReplies(row); const epoch = row.reply_epoch + 1;
    const visitorId = this.reception.addMessage(row.id, 'visitor', text, 'received', epoch, row.focus_version);
    this.repo.run('UPDATE reception_messages SET input_source=?,speaker_decision_id=? WHERE id=?', decisionId ? 'verified_mock_audio' : 'typed', decisionId || null, visitorId);
    if (row.status === 'active') {
      const memory = new MemoryService(this.repo, this.environment, this.appEnv), person = memory.guest(row), facts = row.service_scene!=='restaurant'&&person ? memory.lookup(person, '') : [];
      const scenes = new SceneService(this.repo, this.environment, this.appEnv), snapshot: SceneAppSnapshot | undefined = row.scene_app_snapshot ? JSON.parse(row.scene_app_snapshot) : undefined;
      if (snapshot) scenes.active(snapshot);
      const serviceSuggestion=restaurantHospitalitySuggestion(this.repo,row,text,snapshot),financial=!serviceSuggestion?restaurantFinancialAnswer(this.repo,row,text):null,suggestion=!serviceSuggestion&&!financial?restaurantDraftSuggestion(this.repo,row,text,snapshot):null,dining=serviceSuggestion||financial||suggestion||restaurantAnswer(this.repo,row,text);
      const memoryQuestion = /记忆|偏好|喜好|称呼|喜欢什么/.test(text), answer = !dining && snapshot && !memoryQuestion ? scenes.answer(snapshot, text) : undefined;
      const replyId = this.reception.addMessage(row.id, 'assistant', dining?.text || answer?.text || selectRealtimeProvider(this.environment).reply(text, { publicFacts: facts }), 'ready', epoch, row.focus_version);
      if(dining)this.repo.run('UPDATE reception_messages SET restaurant_context=? WHERE id=?',JSON.stringify(dining.context),replyId);
      if(serviceSuggestion&&snapshot)proposeHospitalityRequest(this.repo,row,snapshot,replyId,visitorId,epoch,serviceSuggestion);
      if(suggestion&&snapshot)proposeRestaurantDraft(this.repo,row,snapshot,replyId,visitorId,epoch,suggestion);
      if (answer) { this.repo.run('UPDATE reception_messages SET knowledge_citations=? WHERE id=?', JSON.stringify(answer.citations), replyId); if (snapshot) proposeConversationTools(this.repo, row, replyId, snapshot, epoch, answer.toolProposals); }
      if (row.service_scene!=='restaurant'&&person && memoryQuestion) this.repo.run('UPDATE reception_messages SET memory_person_id=?,memory_fact_ids=? WHERE id=?', person.id, JSON.stringify(facts.map(f => f.id)), replyId);
    }
    this.repo.run('UPDATE reception_sessions SET version=version+1,reply_epoch=?,activity_at=? WHERE id=?', epoch, new Date().toISOString(), row.id);
    const event = decisionId ? 'session.verified_mock_speech' : 'session.typed_message'; this.repo.event(row.tenant_id, row.workspace_id, row.id, event, this.environment);
    const p: Principal = { tenantId: row.tenant_id, userId: 'guest:' + row.id, role: 'viewer', workspaceIds: [row.workspace_id] }; this.repo.audit(p, row.workspace_id, event, row.id, requestId);
    return this.repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', row.id)!;
  }
}
