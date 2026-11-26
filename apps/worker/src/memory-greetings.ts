import type { Repository } from '@digitalguide/database';
import { MemoryService, type PersonRow } from '../../api/src/memory-service.js';
import { ReceptionService, type SessionRow } from '../../api/src/reception-service.js';

export function processMemoryGreetings(repo: Repository, mode: string, appEnv: string, now = new Date()) {
  if (mode !== 'mock' || appEnv === 'production') return 0;
  return repo.transaction(() => {
    const rows = repo.all<{ person_id: string; session_id: string }>("SELECT p.id AS person_id,s.id AS session_id FROM people p JOIN memory_session_links l ON l.person_id=p.id JOIN reception_sessions s ON s.id=l.session_id LEFT JOIN memory_session_greetings g ON g.session_id=s.id WHERE p.environment=? AND p.app_env=? AND p.status='active' AND p.expires_at>? AND p.personalization=1 AND p.do_not_disturb=0 AND g.session_id IS NULL AND s.status='active' AND s.expires_at>? AND s.activity_at>? AND s.activity_at<=? AND s.focus_version=l.focus_version AND s.environment=p.environment AND s.app_env=p.app_env AND s.tenant_id=p.tenant_id AND s.workspace_id=p.workspace_id AND p.guest_session_id=s.id AND NOT EXISTS (SELECT 1 FROM reception_messages m WHERE m.session_id=s.id AND m.status='playing') LIMIT 10", mode, appEnv, now.toISOString(), now.toISOString(), new Date(now.getTime() - 120000).toISOString(), new Date(now.getTime() - 3000).toISOString());
    const memory = new MemoryService(repo, mode, appEnv), reception = new ReceptionService(repo, mode, appEnv); let count = 0;
    for (const item of rows) {
      const person = repo.get<PersonRow>('SELECT * FROM people WHERE id=?', item.person_id)!, session = repo.get<SessionRow>('SELECT * FROM reception_sessions WHERE id=?', item.session_id)!;
      const result = memory.greet(person, now); if (!result.allowed) continue;
      reception.cancelReplies(session); const epoch = session.reply_epoch + 1;
      repo.run('INSERT INTO memory_session_greetings VALUES (?,?,?)', session.id, person.id, now.toISOString());
      const messageId = reception.addMessage(session.id, 'assistant', '【模拟问候】' + result.text, 'ready', epoch, session.focus_version);
      repo.run('UPDATE reception_messages SET memory_person_id=? WHERE id=?', person.id, messageId);
      repo.run('UPDATE reception_sessions SET version=version+1,reply_epoch=? WHERE id=?', epoch, session.id);
      repo.event(session.tenant_id, session.workspace_id, session.id, 'session.personalized_greeting', mode); count++;
    }
    return count;
  });
}
