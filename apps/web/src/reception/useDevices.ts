import { useCallback, useEffect, useRef, useState } from 'react';
export type Device = 'camera' | 'microphone' | 'screen';
type DeviceState = 'off' | 'requesting' | 'on' | 'denied' | 'unavailable';

export function useDevices(enabled: boolean, contextKey = '') {
  const [states, setStates] = useState<Record<Device, DeviceState>>({ camera: 'off', microphone: 'off', screen: 'off' });
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null), screenVideo = useRef<HTMLVideoElement>(null), streams = useRef<Partial<Record<Device, MediaStream>>>({});
  const versions = useRef<Record<Device, number>>({ camera: 0, microphone: 0, screen: 0 }), alive = useRef(true);
  const close = useCallback((device: Device) => {
    versions.current[device]++;
    streams.current[device]?.getTracks().forEach(track => track.stop()); delete streams.current[device];
    if (device === 'camera' && video.current) video.current.srcObject = null;
    if (device === 'screen' && screenVideo.current) screenVideo.current.srcObject = null;
    if (alive.current) setStates(previous => ({ ...previous, [device]: 'off' }));
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; close('camera'); close('microphone'); close('screen'); };
  }, [close]);
  useEffect(() => { close('camera'); close('microphone'); close('screen'); }, [enabled, contextKey, close]);
  async function open(device: Device) {
    if (!enabled || streams.current[device]) return;
    const version = ++versions.current[device]; setError('');
    if (!navigator.mediaDevices || !(device === 'screen' ? navigator.mediaDevices.getDisplayMedia : navigator.mediaDevices.getUserMedia)) { setStates(previous => ({ ...previous, [device]: 'unavailable' })); setError('此浏览器没有可用的设备接口，请继续使用文字接待。'); return; }
    setStates(previous => ({ ...previous, [device]: 'requesting' }));
    try {
      const stream = device === 'screen' ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }) : await navigator.mediaDevices.getUserMedia(device === 'camera' ? { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false } : { video: false, audio: { echoCancellation: true, noiseSuppression: true } });
      if (!alive.current || versions.current[device] !== version) { stream.getTracks().forEach(track => track.stop()); return; }
      streams.current[device] = stream;
      if (device === 'camera' && video.current) video.current.srcObject = stream;
      if (device === 'screen' && screenVideo.current) screenVideo.current.srcObject = stream;
      stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (versions.current[device] === version) close(device); }, { once: true }));
      setStates(previous => ({ ...previous, [device]: 'on' }));
    } catch (error) {
      if (!alive.current || versions.current[device] !== version) return;
      const denied = error instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
      setStates(previous => ({ ...previous, [device]: denied ? 'denied' : 'unavailable' }));
      setError(denied ? '设备权限已拒绝。文字接待仍可使用；需要设备时可在浏览器权限中重新允许。' : '设备不可用或被其他程序占用，请检查连接，或继续使用文字接待。');
    }
  }
  function capture(source: 'camera' | 'screen') {
    const element = source === 'camera' ? video.current : screenVideo.current, current = versions.current[source];
    if (!enabled || !streams.current[source] || !element || element.readyState < 2 || !element.videoWidth || !element.videoHeight) throw new Error('画面尚未就绪，请先开启并检查本机预览。');
    const canvas = document.createElement('canvas'), scale = Math.min(1, 960 / element.videoWidth, 720 / element.videoHeight);
    canvas.width = Math.max(1, Math.floor(element.videoWidth * scale)); canvas.height = Math.max(1, Math.floor(element.videoHeight * scale));
    try {
      const context = canvas.getContext('2d'); if (!context) throw new Error('此浏览器无法截取画面，请继续文字接待。');
      context.drawImage(element, 0, 0, canvas.width, canvas.height); const frameBase64 = canvas.toDataURL('image/png').split(',')[1];
      if (versions.current[source] !== current || !streams.current[source]) throw new Error('画面来源已关闭，请重新选择。');
      if (frameBase64.length > 1_398_104) throw new Error('当前画面过大，请缩小共享区域后重试。');
      return { frameBase64, capturedAt: new Date().toISOString() };
    } finally { canvas.width = 1; canvas.height = 1; }
  }
  return { states, error, video, screenVideo, open, close, capture };
}
