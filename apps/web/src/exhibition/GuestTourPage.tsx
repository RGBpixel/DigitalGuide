import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers3 } from 'lucide-react';
import type { TourView } from '@digitalguide/contracts';
import { api } from '../api.js';
import '../reception/reception.css';
import { TourPlayer } from './TourPlayer.js';
export function GuestTourPage({ tourId }: { tourId: string }) {
  const client = useQueryClient(), key = ['guest-tour', tourId], base = '/guest/tours/' + tourId;
  const query = useQuery({ queryKey: key, queryFn: () => api<TourView>(base), retry: false, refetchInterval: q => q.state.data && !['ended', 'invalidated'].includes(q.state.data.status) ? 800 : false }), tour = query.data;
  const action = useMutation({ mutationFn: ({ path, body }: { path: string; body: Record<string, unknown> }) => api<TourView>(base + path, { version: tour?.version, focusVersion: tour?.focusVersion, ...body }, 'POST', tour?.csrfToken), onSuccess: data => client.setQueryData(key, data) });
  return <main className="guest-shell tour-terminal"><header className="guest-header"><Link className="brand" to="/exhibition"><span className="brand-symbol"><Layers3 size={22}/></span>DigitalGuide</Link><span className="badge amber">独立导览终端 · 模拟</span><Link className="text-link" to="/exhibition">返回展厅中心</Link></header>{query.isPending ? <p role="status">正在载入本次导览…</p> : !tour ? <section className="panel exhibition-panel"><h1>本次导览暂不可用</h1><p>请工作人员从展厅中心重新打开导览终端。</p></section> : <><div className="guest-heading"><span className="eyebrow">YOUR EXHIBITION GUIDE</span><h1>欢迎参观{tour.hallName}</h1><p>{tour.profileName}为本次导览角色；当前展示文本、计时与模拟展屏，未连接真人驱动或人声播报。</p></div><TourPlayer tour={tour} busy={action.isPending} control={(value, extra) => action.mutate({ path: '/control', body: { action: value, ...extra } })} question={async (audienceLabel, text) => { try { await action.mutateAsync({ path: '/questions', body: { audienceLabel, text, source: 'typed' } }); return true; } catch { return false; } }} cancelQuestion={id => action.mutate({ path: '/questions/cancel', body: { questionId: id } })}/></>}{[query.error, action.error].filter(Boolean).map((e, i) => <div className="error" role="alert" key={i}>{e instanceof Error ? e.message : '请求失败，请重新载入。'}</div>)}<footer className="guest-footer">本次凭证仅访问此导览，不授予组织后台、门禁或支付权限。</footer></main>;
}
