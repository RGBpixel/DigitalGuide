import { createHash } from 'node:crypto';
import { AppError, canonical } from '@digitalguide/domain';
export interface NotificationRequest { deliveryId: string; recipientRef: string; visitRef: string; visitorName: string; company: string; purpose: string; scenario: 'normal' | 'failed' | 'unknown' }
export interface NotificationReceipt { remoteId: string; status: 'submitted'; simulated: true }
export interface NotificationProvider { id: string; environment: string; send(input: NotificationRequest): Promise<NotificationReceipt>; lookup(deliveryId: string): Promise<NotificationReceipt | null> }
export interface NotificationReceiptStore { get(id: string): { hash: string; remoteId: string } | undefined; put(id: string, hash: string, remoteId: string): void }
export class NotificationFailure extends Error { constructor(public code: string, public unknown: boolean) { super(code); } }
export function selectNotificationProvider(mode: string, store: NotificationReceiptStore): NotificationProvider {
  if (mode !== 'mock') throw new AppError('PROVIDER_NOT_CONFIGURED', '通知渠道尚未配置，请交由人工前台处理；不会退回模拟通知。', 409);
  return {
    id: 'mock-notification', environment: 'mock',
    async send(input) {
      const hash = createHash('sha256').update(canonical(input)).digest('hex');
      const existing = store.get(input.deliveryId);
      if (existing) {
        if (existing.hash !== hash) throw new NotificationFailure('NOTIFICATION_INPUT_CONFLICT', false);
        return { status: 'submitted', remoteId: existing.remoteId, simulated: true };
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      if (input.scenario === 'failed') throw new NotificationFailure('MOCK_NOTIFICATION_FAILED', false);
      if (input.scenario === 'unknown') throw new NotificationFailure('NOTIFICATION_RESULT_UNKNOWN', true);
      const remoteId = 'mock-notification:' + input.deliveryId;
      store.put(input.deliveryId, hash, remoteId);
      return { status: 'submitted', remoteId, simulated: true };
    },
    async lookup(deliveryId) { const receipt = store.get(deliveryId); return receipt ? { status: 'submitted', remoteId: receipt.remoteId, simulated: true } : null; }
  };
}
