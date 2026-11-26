import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Code2, KeyRound, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { developerViewSchema, developerMutationResultSchema, type DeveloperView, type Me } from '@digitalguide/contracts';
import { api, ApiError } from '../api.js';
import './developer-access.css';
type App = DeveloperView['apps'][number];
type Scope = App['scopes'][number];
type Draft = { action: 'create' | 'control' | 'issue' | 'revoke'; app?: App; credential?: App['credentials'][number] };
const labels: Record<Scope, string> = { 'projects.read': '读取制作工程信息', 'exports.read': '读取制作导出状态' };
const when = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
export function DeveloperAccessPage({ user, workspaceId }: { user: Me; workspaceId: string }) {
  if (user.role !== 'admin') return <section className="panel"><h1>开发者接入</h1><p role="alert">此页面需要企业管理员权限。</p><Link to="/">返回工作空间</Link></section>;
  if (!user.developerAccessAvailable) return <section className="panel"><h1>开发者接入</h1><p role="status">当前服务尚未开放开发者接入，请使用已更新的独立服务实例。</p></section>;
  return <DeveloperDashboard key={[user.id, user.tenantId, user.environment, workspaceId].join(':')} user={user} workspaceId={workspaceId}/>;
}
function DeveloperDashboard({ user, workspaceId }: { user: Me; workspaceId: string }) {
  const client = useQueryClient(), queryKey = ['developer-access', user.id, user.tenantId, user.environment, workspaceId];
  const mounted = useRef(true), blocked = useRef(false), disclosure = useRef(0);
  const [draft, setDraft] = useState<Draft | null>(null), [notice, setNotice] = useState(''), [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const clearSensitive = () => { disclosure.current++; setSecret(null); setDraft(null); };
  const denied = (error: unknown) => {
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) { blocked.current = true; clearSensitive(); void client.invalidateQueries({ queryKey: ['me'] }); }
  };
  const validate = (raw: unknown) => { const view = developerViewSchema.parse(raw); if (view.tenantId !== user.tenantId || view.workspaceId !== workspaceId || view.environment !== user.environment) throw new Error('开发者状态的空间或环境不符，请刷新。'); return view; };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; disclosure.current++; }; }, []);
  const query = useQuery({ queryKey, enabled: !!workspaceId, retry: false, refetchOnWindowFocus: 'always', queryFn: async ({ signal }) => {
    try { const view = validate(await api('/enterprise/developers?' + new URLSearchParams({ workspaceId }), undefined, 'GET', undefined, signal)); if (blocked.current) throw new Error('权限状态已变化，请重新进入工作空间。'); return view; } catch (error) { denied(error); throw error; }
  } });
  const mutation = useMutation({ mutationFn: async (input: { action: Draft['action']; body: object }) => {
    const ticket = disclosure.current;
    try {
      const result = developerMutationResultSchema.parse(await api('/enterprise/developers/' + input.action, input.body)), view = validate(result.view);
      const oneTimeDisplayed = mounted.current && !blocked.current && ticket === disclosure.current && !!result.issuedCredential?.oneTimeToken;
      if (oneTimeDisplayed) setSecret({ id: result.issuedCredential!.id, value: result.issuedCredential!.oneTimeToken! });
      // Mutation/query caches retain metadata only. The raw credential stays in this mounted view until dismissed.
      return { action: input.action, receiptId: result.receiptId, view, oneTimeDisplayed };
    } catch (error) { denied(error); throw error; }
  }, onSuccess: result => {
    if (!mounted.current || blocked.current) return;
    client.setQueryData(queryKey, result.view); setDraft(null);
    setNotice(result.action === 'issue' ? result.oneTimeDisplayed ? '新凭证已签发，请立即安全保存本次显示的完整密钥。' : '此操作已处理，完整密钥不会重复显示；若未保存，请撤销后重新签发。' : '变更已保存，当前应用与凭证状态已更新。');
  }, onError: () => { clearSensitive(); if (!blocked.current) void query.refetch(); } });
  const view = !query.isError && !blocked.current ? query.data : undefined, busy = mutation.isPending || query.isFetching;
  const open = (next: Draft) => { clearSensitive(); setNotice(''); setDraft(next); };
  return <div className="developer-page">
    <div className="page-heading"><div><span className="eyebrow">DEVELOPER ACCESS</span><h1>开发者接入</h1><p>让你的服务读取获授权的制作工程与导出状态。</p></div><div className="heading-actions"><button disabled={busy} onClick={() => { clearSensitive(); void query.refetch(); }}><RefreshCw size={16}/>刷新状态</button>{view?.canManageOrganization && <button className="primary" disabled={busy} onClick={() => open({ action: 'create' })}><Plus size={16}/>创建应用</button>}</div></div>
    <div className="developer-notice"><ShieldCheck size={20}/><div><strong>组织应用 · 仅服务端使用</strong><p>每个应用限定当前空间和环境。凭证不会授予员工身份，完整密钥仅显示一次；每份凭证每分钟最多60次请求。</p><p>当前开放工程信息和制作导出状态读取。{view?.writesSupported&&user.developerStudioAvailable&&<>正文编辑、导出提交与文件下载可单独授权。<Link to="/enterprise/developer-studio">管理应用制作授权</Link>。</>}{view?.webhooksSupported&&user.developerWebhooksAvailable?<>事件回调已开放配置。<Link to="/enterprise/webhooks">管理事件回调</Link>；品牌嵌入仍在建设。</>:<>其他业务接入与品牌嵌入仍在建设。</>}</p></div></div>
    {notice && <p role="status" className="developer-success">{notice}</p>}
    {secret && <section className="panel developer-secret" aria-label="本次签发密钥"><div className="developer-row"><h2><KeyRound size={18}/>保存新密钥</h2><button aria-label="关闭密钥显示" onClick={() => { disclosure.current++; setSecret(null); }}><X size={16}/></button></div><p>关闭、刷新或离开此空间后将不再显示。请存入你自己服务端的私有配置，勿放入网页或移动端代码。</p><textarea aria-label="新签发的应用密钥" readOnly spellCheck={false} autoComplete="off" value={secret.value} rows={3}/><button onClick={() => { void navigator.clipboard.writeText(secret.value).then(() => setNotice('密钥已复制，请保存到服务端私有配置。')).catch(() => setNotice('无法自动复制，请选中密钥并手动保存。')); }}>复制密钥</button></section>}
    {mutation.error && <p role="alert" className="developer-error">{mutation.error instanceof Error ? mutation.error.message : '操作未确认，请刷新后重新核对。'}</p>}
    {query.isPending && <p role="status">正在读取开发者应用…</p>}
    {query.error && <section className="panel"><h2>暂时无法读取开发者应用</h2><p role="alert">{query.error instanceof Error ? query.error.message : '请刷新后重试。'}</p></section>}
    {view && <>{!view.canManageOrganization && <p role="status">你可以核对当前空间的应用；变更需要具有全部组织空间权限的管理员。</p>}
      <section className="developer-grid" aria-label="当前空间开发者应用">{view.apps.map(app => <article className="panel developer-app" key={app.id} data-developer-app-id={app.id}>
        <div className="developer-row"><h2><Code2 size={20}/>{app.name}</h2><span className={app.enabled ? 'developer-tag' : 'developer-tag muted'}>{app.enabled ? '已启用' : '已停用'}</span></div>
        <p>{app.scopes.map(scope => labels[scope]).join(' · ')}</p><code className="developer-id">应用编号 {app.id}</code>
        <div className="developer-actions">{view.canManageOrganization && <><button disabled={busy} onClick={() => open({ action: 'control', app })}>配置应用</button><button disabled={busy || !app.enabled || app.credentials.filter(k => k.status === 'active').length >= 2} onClick={() => open({ action: 'issue', app })}>签发凭证</button></>}</div>
        {!app.enabled && <p>重新启用后需要签发新凭证，已撤销凭证不会恢复。</p>}
        <h3>访问凭证</h3>{!app.credentials.length && <p className="muted">尚未签发访问凭证。</p>}
        {app.credentials.map(key => <div className="developer-credential" key={key.id} data-developer-credential-id={key.id}><div><code>{key.prefix}</code><span>{key.status === 'active' ? '有效' : key.status === 'expired' ? '已到期' : '已撤销'}</span><small>有效至 {when(key.expiresAt)}</small></div>{view.canManageOrganization && key.status !== 'revoked' && <button disabled={busy} onClick={() => open({ action: 'revoke', app, credential: key })}>撤销凭证</button>}</div>)}
        {app.credentialHistoryTruncated && <p>仅显示最近30份凭证。完整变更记录保留在后台。</p>}
      </article>)}</section>
      {!view.apps.length && <section className="panel developer-empty"><Code2 size={28}/><h2>连接你的业务系统</h2><p>创建应用、勾选读取范围，再签发有期限的服务端凭证。</p></section>}
      <section className="panel developer-reference"><h2>接入方式</h2><p>使用请求头 <code>Authorization: Bearer &lt;应用密钥&gt;</code> 调用以下只读接口；应用空间自动限定，不能用查询参数扩大范围。</p><ul><li><code>GET /api/open/v1/context</code> 核对当前应用与授权</li><li><code>GET /api/open/v1/projects</code> / <code>/projects/工程编号</code></li><li><code>GET /api/open/v1/exports</code> / <code>/exports/导出编号</code></li></ul><p>列表支持 <code>limit</code> 与 <code>cursor</code>。响应不包含脚本、导出文件、私人资料或密钥。</p></section>
      <section className="panel"><h2>近期变更</h2>{!view.recentChanges.length && <p>暂无变更记录。</p>}{view.recentChanges.map(event => <p key={event.id}>{({ 'app.created': '创建应用', 'app.updated': '更新应用', 'credential.issued': '签发凭证', 'credential.revoked': '撤销凭证' })[event.action]} · {when(event.createdAt)}</p>)}</section>
    </>}
    {view && draft && <DeveloperDialog key={draft.action + ':' + (draft.app?.id ?? 'new') + ':' + (draft.credential?.id ?? '')} draft={draft} busy={mutation.isPending} cancel={clearSensitive} submit={body => mutation.mutate({ action: draft.action, body: { workspaceId, ...body } })}/>}
  </div>;
}
function DeveloperDialog({ draft, busy, cancel, submit }: { draft: Draft; busy: boolean; cancel: () => void; submit: (body: object) => void }) {
  const ref = useRef<HTMLDialogElement>(null), [name, setName] = useState(draft.app?.name ?? ''), [scopes, setScopes] = useState<Scope[]>(draft.app?.scopes ?? ['projects.read']), [enabled, setEnabled] = useState(draft.app?.enabled ?? true), [days, setDays] = useState<7 | 30 | 90>(30), [confirmed, setConfirmed] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const heading = { create: '创建开发者应用', control: '配置开发者应用', issue: '签发应用凭证', revoke: '撤销应用凭证' }[draft.action];
  const valid = confirmed && !busy && ((draft.action === 'create' || draft.action === 'control') ? !!name.trim() && scopes.length > 0 : true);
  const save = (event: FormEvent) => {
    event.preventDefault(); if (!valid) return;
    const base = { confirmed: true, ...(draft.app ? { appId: draft.app.id, expectedVersion: draft.app.version } : {}) };
    submit(draft.action === 'create' ? { ...base, name, scopes } : draft.action === 'control' ? { ...base, name, scopes, enabled } : draft.action === 'issue' ? { ...base, termDays: days } : { ...base, credentialId: draft.credential!.id });
  };
  return <dialog ref={ref} className="developer-dialog" aria-label={heading} onCancel={event => { event.preventDefault(); cancel(); }}><form onSubmit={save}><div className="developer-row"><h2>{heading}</h2><button type="button" aria-label="关闭操作" onClick={cancel}><X size={18}/></button></div>
    {(draft.action === 'create' || draft.action === 'control') && <><label>应用名称<input aria-label="应用名称" value={name} maxLength={80} onChange={e => { setName(e.target.value); setConfirmed(false); }}/></label><fieldset><legend>允许读取</legend>{(['projects.read', 'exports.read'] as const).map(scope => <label className="developer-check" key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={e => { setScopes(e.target.checked ? [...scopes, scope] : scopes.filter(s => s !== scope)); setConfirmed(false); }}/>{labels[scope]}</label>)}</fieldset></>}
    {draft.action === 'control' && <><label className="developer-check"><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setConfirmed(false); }}/>启用此应用</label><p>变更读取范围或停用应用，会立即撤销它的现有凭证。重新启用不会恢复旧凭证。</p></>}
    {draft.action === 'issue' && <><p>为「{draft.app?.name}」签发凭证，读取范围：{draft.app?.scopes.map(scope => labels[scope]).join('、')}。</p><label>有效期<select aria-label="凭证有效期" value={days} onChange={e => { setDays(Number(e.target.value) as 7 | 30 | 90); setConfirmed(false); }}><option value={7}>7天</option><option value={30}>30天</option><option value={90}>90天</option></select></label><p>完整密钥只在本次签发后显示一次。每个应用最多两份有效凭证，可用于轮换。</p></>}
    {draft.action === 'revoke' && <p>确认撤销「{draft.app?.name}」的凭证 <code>{draft.credential?.prefix}</code>。撤销后立即失效，不能恢复。</p>}
    <label className="developer-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>我已核对当前空间、应用和操作范围</label><footer><button type="button" onClick={cancel}>取消</button><button type="submit" className="primary" disabled={!valid}>{busy ? '正在保存…' : '确认' + ({ create: '创建应用', control: '保存配置', issue: '签发凭证', revoke: '撤销凭证' })[draft.action]}</button></footer>
  </form></dialog>;
}
