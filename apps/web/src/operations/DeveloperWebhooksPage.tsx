import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BellRing, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { webhookViewSchema, webhookDeliveryPageSchema, webhookMutationResultSchema, type WebhookView, type WebhookDeliveryView, type Me } from '@digitalguide/contracts';
import { api, ApiError } from '../api.js';
import './developer-access.css';
import './developer-webhooks.css';
type Subscription = WebhookView['subscriptions'][number];
type Topic = Subscription['topics'][number];
type Action = 'create' | 'control' | 'disable' | 'test' | 'retry';
type Draft = { action: Action; view: WebhookView; subscription?: Subscription; delivery?: WebhookDeliveryView; ticket: number };
const topicName: Record<Topic | 'webhook.test', string> = { 'projects.changed': '制作工程变更', 'exports.changed': '制作导出状态', 'webhook.test': '接收端测试' };
const statusName: Record<WebhookDeliveryView['status'], string> = { queued: '等待发送', sending: '正在发送', retrying: '等待重试', delivered: '接收端已确认', failed: '投递失败', unknown: '结果不确定', blocked: '发送受阻', cancelled: '已取消' };
const actionName = { created: '创建订阅', configured: '调整订阅', test_queued: '排队测试事件', retry_queued: '人工重试', policy_disabled: '应用变更后停用' };
const when = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
function reason(code: WebhookDeliveryView['code']) {
  return code ? ({ HTTP_ACCEPTED: '接收端返回了成功HTTP回执。', HTTP_REJECTED: '接收端拒绝请求，请核对接收端设置后重试。', HTTP_RETRYABLE: '接收端暂不可用或请求过多，将按间隔重试。', REDIRECT_BLOCKED: '接收端要求跳转，请联系管理员配置最终地址。', TRANSPORT_UNCERTAIN: '未收到确定回执，接收端可能已处理；重试前请核对接收记录。', CONFIG_REQUIRED: '接收端私有配置不可用，请联系部署管理员。', CONFIG_CHANGED: '接收地址或签名配置已变化，请重新核对订阅。', EXTERNAL_NOT_AUTHORIZED: '真实外发尚未启用，请联系部署管理员。', SCOPE_WITHDRAWN: '应用、订阅或事件授权已撤回，请重新核对当前配置。', LEASE_EXPIRED: '发送进程未在期限内确认结果，接收端可能已处理。', PAYLOAD_INVALID: '事件内容未通过校验，请联系管理员检查。' })[code] : '';
}
export function DeveloperWebhooksPage({ user, workspaceId }: { user: Me; workspaceId: string }) {
  if (user.role !== 'admin') return <section className="panel"><h1>事件回调</h1><p role="alert">此页面需要企业管理员权限。</p><Link to="/">返回工作空间</Link></section>;
  if (!user.developerWebhooksAvailable) return <section className="panel"><h1>事件回调</h1><p role="status">当前服务尚未开放事件回调，请使用已更新的独立服务实例。</p></section>;
  return <WebhooksDashboard key={[user.id, user.tenantId, user.environment, workspaceId].join(':')} user={user} workspaceId={workspaceId}/>;
}
function WebhooksDashboard({ user, workspaceId }: { user: Me; workspaceId: string }) {
  const client = useQueryClient(), identity = [user.id, user.tenantId, user.environment, workspaceId], queryKey = ['developer-webhooks', ...identity], deliveryKey = ['webhook-deliveries', ...identity];
  const mounted = useRef(true), blocked = useRef(false), ticket = useRef(0);
  const [draft, setDraft] = useState<Draft | null>(null), [notice, setNotice] = useState(''), [subscriptionId, setSubscriptionId] = useState(''), [cursor, setCursor] = useState('');
  const cancel = () => { ticket.current++; setDraft(null); };
  const denied = (error: unknown) => { if (error instanceof ApiError && [401, 403, 404].includes(error.status)) { blocked.current = true; cancel(); void client.invalidateQueries({ queryKey: ['me'] }); } };
  const validate = (raw: unknown) => { const value = webhookViewSchema.parse(raw); if (value.tenantId !== user.tenantId || value.workspaceId !== workspaceId || value.environment !== user.environment) throw new Error('回调状态的空间或环境不符，请刷新。'); return value; };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ticket.current++; }; }, []);
  const query = useQuery({ queryKey, retry: false, refetchOnWindowFocus: 'always', refetchInterval: 10000, queryFn: async ({ signal }) => {
    try { const value = validate(await api('/enterprise/webhooks?' + new URLSearchParams({ workspaceId }), undefined, 'GET', undefined, signal)); if (blocked.current) throw new Error('权限状态已变化，请重新进入工作空间。'); return value; } catch (error) { denied(error); throw error; }
  } });
  const view = !query.isError && !blocked.current ? query.data : undefined;
  const deliveries = useQuery<{items: WebhookDeliveryView[]; nextCursor: string | null}>({ queryKey: [...deliveryKey, subscriptionId, cursor], enabled: !!view && !blocked.current, retry: false, refetchOnWindowFocus: 'always', refetchInterval: state => state.state.data?.items.some(row => ['queued', 'sending', 'retrying'].includes(row.status)) ? 2500 : 10000, queryFn: async ({ signal }) => {
    try { const result = webhookDeliveryPageSchema.parse(await api('/enterprise/webhooks/deliveries?' + new URLSearchParams({ workspaceId, limit: '20', ...(subscriptionId ? { subscriptionId } : {}), ...(cursor ? { cursor } : {}) }), undefined, 'GET', undefined, signal)); if (blocked.current) throw new Error('权限状态已变化，请重新进入工作空间。'); return result; } catch (error) { denied(error); throw error; }
  } });
  const mutation = useMutation({ mutationFn: async (input: { action: Action; body: object; key: string; ticket: number }) => {
    try { const result = webhookMutationResultSchema.parse(await api('/enterprise/webhooks/' + (input.action === 'disable' ? 'control' : input.action), input.body, 'POST', undefined, undefined, input.key)); return { ...result, view: validate(result.view), ticket: input.ticket, action: input.action }; } catch (error) { denied(error); throw error; }
  }, onSuccess: result => {
    if (!mounted.current || blocked.current) return;
    client.setQueryData(queryKey, result.view); void client.invalidateQueries({ queryKey: deliveryKey });
    if (result.ticket !== ticket.current) return;
    setDraft(null); setCursor(''); setSubscriptionId(result.subscriptionId);
    setNotice(result.action === 'test' ? '测试事件已进入发送队列，请在投递记录中查看回执。' : result.action === 'retry' ? '此条投递已重新排队，投递编号和事件正文保持一致。' : result.action === 'disable' ? '订阅已停用，尚未完成的旧投递已取消。' : '订阅已保存，将按当前配置接收之后发生的事件。');
  }, onError: error => { if (!blocked.current) { void query.refetch(); void client.invalidateQueries({ queryKey: deliveryKey }); if (error instanceof ApiError && [400, 409].includes(error.status)) cancel(); } } });
  const open = (action: Action, subscription?: Subscription, delivery?: WebhookDeliveryView) => { if (!view) return; mutation.reset(); setNotice(''); setDraft({ action, subscription, delivery, view, ticket: ++ticket.current }); };
  const refresh = () => { cancel(); setCursor(''); void query.refetch(); void client.invalidateQueries({ queryKey: deliveryKey }); };
  const list = !deliveries.isError && !blocked.current ? deliveries.data : undefined;
  return <div className="developer-page webhook-page">
    <div className="page-heading"><div><span className="eyebrow">EVENT WEBHOOKS</span><h1>事件回调</h1><p>将获授权的工程和导出状态变化通知你的服务。</p></div><div className="heading-actions"><Link className="webhook-back" to="/enterprise/developers"><ArrowLeft size={15}/>开发者接入</Link><button disabled={mutation.isPending || query.isFetching} onClick={refresh}><RefreshCw size={16}/>刷新状态</button>{view?.canManageOrganization && <button className="primary" disabled={mutation.isPending || !view.destinations.length || !view.apps.some(a => a.enabled)} onClick={() => open('create')}><Plus size={16}/>创建订阅</button>}</div></div>
    <div className="developer-notice"><ShieldCheck size={21}/><div><strong>限定应用与空间 · 签名发送</strong><p>接收端由部署管理员登记。每条投递携带签名，接收端应验证原始正文并按投递编号去重；重复或重试不会更换该编号。</p><p>成功HTTP回执表示接收端已受理，最终业务处理结果请在你的服务中核对。接收端地址和签名密钥在服务端私有配置中管理。</p></div></div>
    {notice && <p role="status" className="developer-success">{notice}</p>}
    {mutation.error && <p role="alert" className="developer-error">{mutation.error instanceof ApiError ? mutation.error.message : '未能确认操作结果。请刷新核对；重试当前操作会沿用操作编号。'}</p>}
    {query.isPending && <p role="status">正在读取事件订阅…</p>}
    {query.error && <section className="panel"><h2>暂时无法读取事件回调</h2><p role="alert">{query.error instanceof Error ? query.error.message : '请刷新后重试。'}</p></section>}
    {view && <>
      <div className="webhook-overview"><div><span className="webhook-overview-value">{view.subscriptions.filter(s => s.enabled).length}</span><span>已启用订阅</span></div><div><span className="webhook-overview-value">{view.destinations.length}</span><span>当前空间接收端</span></div><div><strong>{view.environment === 'mock' ? '本机测试' : view.environment === 'sandbox' ? '供应商沙箱' : '真实服务'}</strong><span>{view.appEnv === 'development' ? '开发环境' : view.appEnv === 'sandbox' ? '沙箱环境' : '生产环境'}</span></div></div>
      {view.configIssue && <section className="panel webhook-config-issue"><h2>接收端配置需要处理</h2><p>{view.configIssue}</p><p>已有订阅和投递记录仍可查看，管理员也可以停用订阅。</p></section>}
      {!view.canManageOrganization && <p role="status">你可以核对当前空间记录；变更需要具有全部组织空间权限的管理员。</p>}
      {!view.apps.length && <section className="panel developer-empty"><BellRing size={27}/><h2>先连接你的应用</h2><p>在开发者接入中创建应用并授权读取范围，再选择接收端和事件。</p><Link to="/enterprise/developers">前往开发者接入</Link></section>}
      <section className="developer-grid" aria-label="当前空间事件订阅">{view.subscriptions.map(sub => {
        const application = view.apps.find(a => a.id === sub.appId), ready = sub.enabled && sub.configurationCurrent && application?.enabled;
        return <article className="panel webhook-subscription" data-webhook-subscription-id={sub.id} key={sub.id}><div className="developer-row"><h2><BellRing size={19}/>{sub.destinationName}</h2><span className={'developer-tag' + (ready ? '' : ' muted')}>{!sub.enabled ? '已停用' : !sub.configurationCurrent ? '需重新核对' : '已启用'}</span></div><p className="webhook-app-name">{application?.name ?? '应用暂不可用'}</p><div className="webhook-topics">{sub.topics.map(topic => <span key={topic}>{topicName[topic]}</span>)}</div><p className="muted">{sub.mode === 'local_test' ? '本机测试接收端' : sub.mode === 'https' ? 'HTTPS接收端' : '接收端配置不可用'}</p><code className="developer-id">订阅编号 {sub.id}</code>
          <div className="developer-actions"><button onClick={() => { setSubscriptionId(sub.id); setCursor(''); }}>查看投递</button>{view.canManageOrganization && <><button disabled={mutation.isPending || !ready} onClick={() => open('test', sub)}>发送测试</button><button disabled={mutation.isPending} onClick={() => open('control', sub)}>调整订阅</button>{sub.enabled && <button disabled={mutation.isPending} onClick={() => open('disable', sub)}>停用订阅</button>}</>}</div></article>;
      })}</section>
      {!!view.apps.length && !view.subscriptions.length && <section className="panel developer-empty"><BellRing size={26}/><h2>让制作状态主动到达你的服务</h2><p>选择已登记接收端，订阅工程变更或制作导出状态。创建订阅后可排队发送测试事件。</p></section>}
      <section className="panel webhook-deliveries" aria-label="事件投递记录"><div className="developer-row webhook-list-heading"><div><h2>投递记录</h2><p className="muted">发送失败和结果不确定都会保留记录。</p></div><label>选择订阅<select aria-label="筛选事件订阅" value={subscriptionId} onChange={e => { setSubscriptionId(e.target.value); setCursor(''); }}><option value="">全部订阅</option>{view.subscriptions.map(sub => <option value={sub.id} key={sub.id}>{view.apps.find(a => a.id === sub.appId)?.name} · {sub.destinationName}</option>)}</select></label></div>
        {deliveries.isPending && <p role="status">正在读取投递记录…</p>}{deliveries.error && <p role="alert" className="developer-error">{deliveries.error instanceof Error ? deliveries.error.message : '暂时无法读取投递记录，请刷新。'}</p>}
        {list && !list.items.length && <p className="webhook-no-deliveries">暂无投递记录。创建订阅后，后续事件或测试事件会显示在这里。</p>}
        {list?.items.map(row => { const sub = view.subscriptions.find(s => s.id === row.subscriptionId); return <article className="webhook-delivery" data-webhook-delivery-id={row.id} key={row.id}><div className="developer-row"><h3>{topicName[row.type]}</h3><span className={'webhook-status webhook-status-' + row.status}>{statusName[row.status]}</span></div><p>{sub?.destinationName ?? '原接收端'} · {when(row.createdAt)} · 第{row.sequence}次源事件</p><code className="developer-id">投递编号 {row.id}</code><p className="webhook-reason">{reason(row.code) || (row.status === 'queued' ? '已加入队列。若持续等待，请联系部署管理员检查派发服务。' : row.status === 'sending' ? '正在等待接收端回执。' : '等待下一次发送。')}</p><div className="webhook-delivery-bottom"><span>已尝试 {row.attempts} / 当前上限 {row.maxAttempts} 次{row.httpStatus !== null ? ' · HTTP ' + row.httpStatus : ''}</span>{view.canManageOrganization && row.canRetry && sub && <button disabled={mutation.isPending} onClick={() => open('retry', sub, row)}>重试此条投递</button>}</div>
          {!!row.recentAttempts.length && <details><summary>展开发送尝试（{row.recentAttempts.length}）</summary><ol>{row.recentAttempts.map(attempt => <li key={attempt.attempt}>第{attempt.attempt}次 · {when(attempt.startedAt)} · {attempt.outcome === 'sending' ? '等待回执' : attempt.outcome === 'accepted' ? '接收端受理' : attempt.outcome === 'unknown' ? '结果不确定' : attempt.outcome === 'retryable' ? '暂时失败' : attempt.outcome === 'blocked' ? '发送受阻' : '接收端拒绝'}{attempt.httpStatus ? ' · HTTP ' + attempt.httpStatus : ''}{attempt.scopeWithdrawn ? ' · 此次尝试期间授权已撤回' : ''}</li>)}</ol></details>}</article>; })}
        {list && <div className="webhook-pagination"><button disabled={!cursor || deliveries.isFetching} onClick={() => setCursor('')}><ArrowLeft size={15}/>返回最新</button><button disabled={!list.nextCursor || deliveries.isFetching} onClick={() => setCursor(list.nextCursor!)}>更早记录<ArrowRight size={15}/></button></div>}
      </section>
      <section className="panel"><h2>近期配置变更</h2>{!view.recentChanges.length && <p className="muted">暂无变更记录。</p>}{view.recentChanges.map(change => <p className="webhook-change" key={change.id}><span>{actionName[change.action]}</span><time>{when(change.createdAt)}</time></p>)}</section>
    </>}
    {draft && view && <WebhookDialog key={draft.ticket} draft={draft} busy={mutation.isPending} cancel={cancel} submit={(body, key) => mutation.mutate({ action: draft.action, body: { workspaceId, ...body }, key, ticket: draft.ticket })}/>}
  </div>;
}
function WebhookDialog({ draft, busy, cancel, submit }: { draft: Draft; busy: boolean; cancel: () => void; submit: (body: object, key: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null), requestKey = useRef(crypto.randomUUID()), { view, action, subscription: sub } = draft;
  const [appId, setAppId] = useState(sub?.appId ?? view.apps.find(a => a.enabled)?.id ?? ''), [destinationId, setDestinationId] = useState(sub?.destinationId ?? view.destinations[0]?.id ?? ''), [topics, setTopics] = useState<Topic[]>(sub?.topics ?? []), [enabled, setEnabled] = useState(action === 'disable' ? false : sub?.enabled ?? true), [confirmed, setConfirmed] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const app = view.apps.find(a => a.id === appId), destination = view.destinations.find(d => d.id === destinationId), heading = { create: '创建事件订阅', control: '调整事件订阅', disable: '停用事件订阅', test: '排队测试事件', retry: '重试此条投递' }[action];
  const edit = () => { setConfirmed(false); requestKey.current = crypto.randomUUID(); };
  const configurable = action === 'create' || action === 'control', valid = confirmed && !busy && !!app && (!configurable || topics.length > 0 && (!enabled || !!destination && app.enabled && topics.every(topic => app.scopes.includes(topic === 'projects.changed' ? 'projects.read' : 'exports.read'))));
  const save = (event: FormEvent) => { event.preventDefault(); if (!valid || !app) return; const base = { appId: app.id, expectedAppVersion: app.version, confirmed: true, ...(sub ? { subscriptionId: sub.id, expectedVersion: sub.version } : {}) }; submit(action === 'create' ? { ...base, destinationId, configurationToken: destination!.configurationToken, topics } : action === 'control' || action === 'disable' ? { ...base, enabled, topics, ...(enabled && destination ? { configurationToken: destination.configurationToken } : {}) } : { ...base, ...(action === 'retry' ? { deliveryId: draft.delivery!.id } : {}) }, requestKey.current); };
  return <dialog ref={ref} className="developer-dialog webhook-dialog" aria-label={heading} onCancel={event => { event.preventDefault(); cancel(); }}><form onSubmit={save}><div className="developer-row"><h2>{heading}</h2><button type="button" aria-label="关闭回调操作" onClick={cancel}><X size={18}/></button></div>
    {action === 'create' ? <><label>开发者应用<select aria-label="开发者应用" value={appId} disabled={busy} onChange={e => { setAppId(e.target.value); setTopics([]); edit(); }}>{view.apps.filter(a => a.enabled).map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label><label>已登记接收端<select aria-label="已登记接收端" value={destinationId} disabled={busy} onChange={e => { setDestinationId(e.target.value); edit(); }}>{view.destinations.map(d => <option value={d.id} key={d.id}>{d.name} · {d.mode === 'local_test' ? '本机测试' : 'HTTPS'}</option>)}</select></label></> : <p>应用：{app?.name ?? '应用不可用'}<br/>接收端：{sub?.destinationName}</p>}
    {configurable && <fieldset disabled={busy}><legend>订阅事件</legend>{(['projects.changed', 'exports.changed'] as const).map(topic => { const allowed = app?.scopes.includes(topic === 'projects.changed' ? 'projects.read' : 'exports.read'); return <label className="developer-check" key={topic}><input type="checkbox" disabled={!allowed && enabled} checked={topics.includes(topic)} onChange={e => { setTopics(e.target.checked ? [...topics, topic] : topics.filter(t => t !== topic)); edit(); }}/>{topicName[topic]}{!allowed && <small>需先在应用中授权读取范围</small>}</label>; })}</fieldset>}
    {action === 'control' && <label className="developer-check"><input type="checkbox" disabled={busy} checked={enabled} onChange={e => { setEnabled(e.target.checked); edit(); }}/>启用此订阅</label>}
    {(action === 'control' || action === 'disable') && <p>保存配置会取消尚未完成的旧投递；启用后只发送之后发生的事件。已经发出的HTTP请求无法撤回，回执仍会保存。</p>}
    {action === 'create' && <p>仅通知所选事件的基本制作信息，不发送讲稿、导出文件或私人资料。测试接收端后，再由部署管理员安排真实接入。</p>}
    {action === 'test' && <p>测试事件只包含连接测试信息，会进入发送队列。若持续排队，请联系部署管理员检查派发服务。</p>}
    {action === 'retry' && <><p>将重用此投递的编号和完整事件正文。接收端可能已处理过原请求，请先核对接收记录并确保接收端按投递编号去重。</p><code className="developer-id">{draft.delivery?.id}</code><p>每条投递累计最多尝试20次，人工重试不会清零已用次数。</p></>}
    <label className="developer-check"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>我已核对当前空间、应用、接收端和操作范围</label><footer><button type="button" onClick={cancel}>取消</button><button type="submit" className="primary" disabled={!valid}>{busy ? '正在保存…' : ({ create: '确认创建订阅', control: '确认保存订阅', disable: '确认停用订阅', test: '确认排队测试', retry: '确认重试投递' })[action]}</button></footer>
  </form></dialog>;
}
