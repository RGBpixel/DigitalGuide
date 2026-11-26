import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, KeyRound } from 'lucide-react';
import type { MemoryPerson, MemoryView, ReceptionSession, RecoveryIssue } from '@digitalguide/contracts';
import { api } from '../api.js';

function downloadCredential(data: RecoveryIssue) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), link = document.createElement('a');
  link.href = url; link.download = 'DigitalGuide-本人偏好恢复凭证.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function RecoveryControls({ person, session, csrfToken }: { person: MemoryPerson; session: ReceptionSession; csrfToken: string }) {
  const client = useQueryClient(), [confirmed, setConfirmed] = useState(false), [credential, setCredential] = useState<RecoveryIssue | null>(null), [revealed, setRevealed] = useState(false), [notice, setNotice] = useState('');
  const base = '/guest/sessions/' + session.id + '/memory/recovery', enabled = session.status === 'active';
  const issue = useMutation({ mutationFn: () => api<RecoveryIssue>(base, { version: person.version, focusVersion: session.focusVersion, confirmed: true }, 'POST', csrfToken), onSuccess: data => { setCredential(data); setRevealed(false); setNotice(''); setConfirmed(false); void client.invalidateQueries({ queryKey: ['guest-memory', session.id] });void client.invalidateQueries({queryKey:['guest-session',session.id]}); } });
  const revoke = useMutation({ mutationFn: () => api(base + '/revoke', { version: person.version, focusVersion: session.focusVersion, confirmed: true }, 'POST', csrfToken), onSuccess: () => { setCredential(null); setRevealed(false); setNotice('未使用的恢复凭证已撤销。'); } });
  async function copy() { try { await navigator.clipboard.writeText(credential!.recoveryCode); setNotice('已复制，请保存到本人设备。'); } catch { setNotice('复制不可用，您可以下载凭证到本人设备。'); } }
  return <div className="memory-section memory-recovery" aria-label="下次来访恢复"><div className="memory-section-title"><h3><KeyRound size={17}/>下次来访恢复</h3><span>自愿生成 · 一次使用 · 同工作空间</span></div><p className="form-help">凭证可恢复本人的偏好与仍有效的记录，请仅保存到本人设备。它不授予员工、付款或后台权限；原会话须先结束，恢复时需再次同意用途。</p>
    <label className="checkbox-line"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>我需要恢复凭证，并理解重新生成会使旧凭证失效</label><div className="memory-actions"><button className="button secondary" disabled={!enabled || !confirmed || issue.isPending} onClick={() => issue.mutate()}>生成本人恢复凭证</button><button className="text-button danger" disabled={!enabled || revoke.isPending} onClick={() => revoke.mutate()}>撤销未使用的恢复凭证</button></div>
    {credential && <div className="memory-credential"><label>恢复凭证（仅本次生成时显示）<input readOnly type={revealed ? 'text' : 'password'} value={credential.recoveryCode} autoComplete="off"/></label><div className="memory-actions"><button className="text-button" onClick={() => setRevealed(!revealed)}>{revealed ? '隐藏凭证' : '显示凭证'}</button><button className="text-button" onClick={() => void copy()}><Copy size={14}/>复制凭证</button><button className="text-button" onClick={() => downloadCredential(credential)}><Download size={14}/>下载到本人设备</button></div><small>有效至 {new Date(credential.expiresAt).toLocaleString('zh-CN')}。使用后失效；恢复成功后可另行生成下一次凭证。</small></div>}
    {notice && <p className="form-help" role="status">{notice}</p>}{[issue.error, revoke.error].filter(Boolean).map((error, i) => <div className="error" role="alert" key={i}>{error instanceof Error ? error.message : '凭证操作失败，请刷新资料后重试。'}</div>)}
  </div>;
}
export function RestoreMemoryForm({ session, csrfToken, restored }: { session: ReceptionSession; csrfToken: string; restored: (view: MemoryView) => void }) {
  const [code, setCode] = useState(''), [consent, setConsent] = useState(false);
  const restore = useMutation({ mutationFn: () => api<MemoryView>('/guest/sessions/' + session.id + '/memory/restore', { recoveryCode: code.trim(), focusVersion: session.focusVersion, consent: true, noticeVersion: 'memory-v1' }, 'POST', csrfToken), onSuccess: data => { setCode(''); setConsent(false); restored(data); } });
  return <details className="memory-restore"><summary><KeyRound size={16}/>恢复已有偏好</summary><form onSubmit={e => { e.preventDefault(); restore.mutate(); }}><p className="form-help">请使用本人上次主动生成的有效凭证。同名不会自动关联；原会话未结束、凭证过期或已使用时无法恢复。</p><label>粘贴本人恢复凭证<input type="password" required maxLength={100} autoComplete="off" value={code} onChange={e => setCode(e.target.value)}/></label><label className="checkbox-line"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>我同意在当前会话接续本人的偏好及记录，原有效期不延长</label><button className="button secondary" disabled={session.status !== 'active' || !code.trim() || !consent || restore.isPending}>校验凭证并恢复偏好</button>{restore.error && <div className="error" role="alert">{restore.error.message}</div>}</form></details>;
}

