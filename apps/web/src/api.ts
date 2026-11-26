import type { ApiResponse } from '@digitalguide/contracts';
export class ApiError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }
export let csrfToken = '';
export function setCsrf(value: string) { csrfToken = value; }
export async function api<T>(url: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', csrfOverride?: string,signal?: AbortSignal,idempotencyKey?:string): Promise<T> {
  const result = await fetch('/api/v1' + url, { method, credentials: 'same-origin',signal, headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfOverride ?? csrfToken, 'Idempotency-Key': idempotencyKey??crypto.randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = await result.json().catch(() => { throw new ApiError('INVALID_RESPONSE', result.ok ? '服务返回的内容暂时无法读取，请刷新重试；若仍失败，请联系管理员。' : '服务暂时不可用，请稍后刷新页面；若仍失败，请联系管理员。', result.status); });
  if (!result.ok) {
    if(result.status===401&&url.split('?')[0]!=='/me'&&!/^\/(auth|guest|external)(\/|$)/.test(url)&&typeof window!=='undefined')window.dispatchEvent(new Event('digitalguide:auth-required'));
    throw new ApiError(json.error?.code || 'REQUEST_FAILED', json.error?.message || '请求失败，请稍后重试。', result.status);
  }
  return (json as ApiResponse<T>).data;
}
