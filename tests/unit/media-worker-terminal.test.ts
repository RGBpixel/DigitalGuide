import { afterEach,describe,it,expect,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { fork } from 'node:child_process';
import { blankStudioDocument } from '@digitalguide/contracts';
import { runDelivery } from '../../packages/media/src/run-delivery.js';
import { runTimelineRender } from '../../packages/media/src/run-timeline-render.js';
import { runVideoInspection } from '../../packages/media/src/run-video-inspection.js';
vi.mock('node:child_process',() => ({ fork: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); });
const common = { document: blankStudioDocument(),images: {},audio: {},objects: 'objects',directory: 'work',root: process.cwd(),startMs: 0,durationMs: 100 },cases = [
  { name: '正式成片',start: (signal: AbortSignal) => runDelivery({ ...common,kind: 'video',delivery: { preset: 'hd',fps: 25,transparent: false,omitBackground: false,burnSubtitles: true } },signal,() => {}) },
  { name: '时间线预览',start: (signal: AbortSignal) => runTimelineRender(common,signal,() => {}) },
  { name: '视频检查',start: (signal: AbortSignal) => runVideoInspection({ file: 'source.mp4',directory: 'work',root: process.cwd() },signal,() => {}) }
];
for (const c of cases) describe(c.name+'子进程终态',() => {
  it('退出事件到达后仍接纳关闭前已在通道中的结果，不误报失败',async () => { const child = Object.assign(new EventEmitter(),{ connected: true,send: vi.fn(),kill: vi.fn() });vi.mocked(fork).mockReturnValue(child as unknown as ChildProcess);const result = { marker: 'verified-by-parent-next' },promise = c.start(new AbortController().signal);let settled = false;promise.then(() => { settled = true; },() => { settled = true; });child.emit('exit',0,null);await Promise.resolve();expect(settled).toBe(false);child.emit('message',{ result });child.emit('close',0,null);expect(await promise).toEqual(result); });
  it('通道完整关闭后确无结果则失败并保留退出代码，不伪造媒体成功',async () => { const child = Object.assign(new EventEmitter(),{ connected: true,send: vi.fn(),kill: vi.fn() });vi.mocked(fork).mockReturnValue(child as unknown as ChildProcess);const promise = c.start(new AbortController().signal),check = expect(promise).rejects.toThrow('代码17');child.emit('exit',17,null);child.emit('close',17,null);await check; });
});
