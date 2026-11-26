import { createHash } from 'node:crypto';
import { AppError, canonical } from '@digitalguide/domain';
export interface OfficeDeliveryRequest { notificationId: string; recipientId: string; sourceId: string; revision: number; kind: string; title: string; body: string; scenario: 'normal' | 'failed' | 'unknown' }
export interface OfficeDeliveryReceipt { remoteId: string; status: 'submitted_mock' }
export interface OfficeDeliveryProvider { send(input: OfficeDeliveryRequest): Promise<OfficeDeliveryReceipt>; lookup(notificationId: string): Promise<OfficeDeliveryReceipt | null> }
export interface OfficeReceiptStore { get(id: string): { hash: string; remoteId: string } | undefined; put(id: string, hash: string, remoteId: string): void }
export class OfficeDeliveryError extends Error { constructor(public code: string, public unknown: boolean) { super(code); } }
export function selectOfficeProvider(mode: string, appEnv: string, store: OfficeReceiptStore): OfficeDeliveryProvider {
  if (mode !== 'mock' || appEnv === 'production') throw new AppError('PROVIDER_NOT_CONFIGURED', '员工消息的真实渠道尚未接通，请使用本地收件箱。', 409);
  return {
    async send(input) {
      const hash = createHash('sha256').update(canonical(input)).digest('hex'), previous = store.get(input.notificationId);
      if (previous) { if (previous.hash !== hash) throw new OfficeDeliveryError('INPUT_CONFLICT', false); return { remoteId: previous.remoteId, status: 'submitted_mock' }; }
      await new Promise(resolve => setTimeout(resolve, 10));
      if (input.scenario === 'failed') throw new OfficeDeliveryError('MOCK_REJECTED', false);
      if (input.scenario === 'unknown') throw new OfficeDeliveryError('CHANNEL_RESULT_UNKNOWN', true);
      const remoteId = 'mock-office:' + input.notificationId; store.put(input.notificationId, hash, remoteId); return { remoteId, status: 'submitted_mock' };
    },
    async lookup(notificationId) { const row = store.get(notificationId); return row ? { remoteId: row.remoteId, status: 'submitted_mock' } : null; }
  };
}
