import { randomUUID } from 'node:crypto';
import { AppError } from '@digitalguide/domain';
import type { DisplayState } from '@digitalguide/contracts';
export function selectExhibitDeviceProvider(id: string, environment: string, appEnv: string) {
  if (id !== 'mock-display' || environment !== 'mock' || appEnv === 'production') throw new AppError('PROVIDER_NOT_CONFIGURED', '此展屏服务尚未连接，不会以模拟回执代替真实硬件结果。', 409);
  return { id, environment: 'mock' as const, apply(state: DisplayState, fixture: 'success' | 'failure' | 'unknown') {
    if (fixture === 'failure') return { status: 'failed' as const, reason: 'mock_device_failure', receiptId: null, state: null };
    if (fixture === 'unknown') return { status: 'unknown' as const, reason: 'mock_acknowledgement_unknown', receiptId: null, state: null };
    return { status: 'succeeded' as const, reason: 'mock_confirmed', receiptId: 'mock-display:' + randomUUID(), state };
  } };
}
