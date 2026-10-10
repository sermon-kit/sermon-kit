'use client';

import { useEffect, useRef, useState } from 'react';

const CONSENT_TEXT = '나는 이 음성의 소유자이며 구글이 이 음성을 사용하여 음성 합성 모델을 생성할 것을 허용합니다.';
const SAMPLE_TEXT = '오늘 우리가 말씀 앞에 서는 이유는 모든 문제를 단번에 해결하기 위해서가 아닙니다. 하나님께서 우리를 어떻게 바라보시는지 다시 듣고, 그 말씀을 따라 한 걸음 순종하기 위해서입니다.';

type Kind = 'source' | 'consent';

type Props = {
  apiKey: string;
  existingVoiceKey?: string;
  existingExpiresAt?: number;
  onVoiceKey: (voiceKey: string, expiresAt: number) => void;
  onClearVoiceKey: () => void;
};

function writeString(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function audioBufferToWav(buffer: AudioBuffer) {
  const samples = buffer.getChannelData(0);
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 24000 * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

async function mediaBlobTo24kMonoWav(blob: Blob) {
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('이 브라우저에서 음성 변환을 지원하지 않습니다.');
  const context: AudioContext = new AudioContextCtor();
  try {
    const decoded = await context.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const frameCount = Math.max(1, Math.ceil(decoded.duration * 24000));
    const offline = new OfflineAudioContext(1, frameCount, 24000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return audioBufferToWav(rendered);
  } finally {
    await context.close().catch(() => undefined);
  }
}

function AudioPreview({ blob }: { blob: Blob | null }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) { setUrl(''); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  if (!url) return null;
  return <audio controls src={url} />;
}

export default function VoiceCloneRecorder({ apiKey, existingVoiceKey, existingExpiresAt, onVoiceKey, onClearVoiceKey }: Props) {
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [consentBlob, setConsentBlob] = useState<Blob | null>(null);
  const [sourceSeconds, setSourceSeconds] = useState(0);
  const [consentSeconds, setConsentSeconds] = useState(0);
  const [recording, setRecording] = useState<Kind | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startAtRef = useRef(0);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  async function startRecording(kind: Kind) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('이 브라우저에서는 마이크 녹음을 지원하지 않습니다. Chrome/Edge/Samsung Internet 최신 버전을 사용해 주세요.');
      return;
    }
    setError('');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      stream.getTracks().forEach(t => t.stop());
      setRecording(null);
      try {
        const raw = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const wav = await mediaBlobTo24kMonoWav(raw);
        const seconds = Math.max(1, Math.round((Date.now() - startAtRef.current) / 100) / 10);
        if (kind === 'source') { setSourceBlob(wav); setSourceSeconds(seconds); }
        else { setConsentBlob(wav); setConsentSeconds(seconds); }
      } catch (e: any) {
        setError(e?.message || '녹음 파일을 WAV로 변환하지 못했습니다.');
      }
    };
    startAtRef.current = Date.now();
    setElapsed(0);
    setRecording(kind);
    recorder.start(250);
    timerRef.current = window.setInterval(() => setElapsed(Math.round((Date.now() - startAtRef.current) / 100) / 10), 100);
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  async function createClone() {
    if (!apiKey.trim()) { setError('Gemini API 키를 먼저 입력해 주세요.'); return; }
    if (!sourceBlob || !consentBlob) { setError('참조 음성과 동의 음성을 모두 녹음해 주세요.'); return; }
    if (sourceSeconds < 8 || sourceSeconds > 35) { setError('참조 음성은 10~30초가 가장 좋습니다. 현재 녹음을 다시 확인해 주세요.'); return; }
    setCreating(true);
    setError('');
    try {
      const form = new FormData();
      form.append('apiKey', apiKey.trim());
      form.append('source', sourceBlob, 'reference.wav');
      form.append('consent', consentBlob, 'consent.wav');
      const res = await fetch('/api/voice/replicate', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ? `${data.error} · ${data.detail}` : (data.error || '내 목소리 만들기에 실패했습니다.'));
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      onVoiceKey(data.voiceKey, expiresAt);
    } catch (e: any) {
      setError(e?.message || '내 목소리 만들기 중 오류가 발생했습니다.');
    } finally {
      setCreating(false);
    }
  }

  const remaining = existingExpiresAt ? Math.max(0, Math.ceil((existingExpiresAt - Date.now()) / 86400000)) : 0;

  return (
    <div className="clone-box">
      <div className="clone-head">
        <div>
          <span className="eyebrow">내 목소리 AI</span>
          <h4>짧게 녹음하고 내 음색으로 자막을 읽습니다</h4>
        </div>
        {existingVoiceKey && <span className="clone-ready">✓ 사용 가능 · 약 {remaining}일</span>}
      </div>

      <div className="clone-grid">
        <div className="record-card">
          <strong>1. 참조 음성 10~30초</strong>
          <p>{SAMPLE_TEXT}</p>
          <div className="record-actions">
            {recording !== 'source' ? <button className="mini-btn" disabled={Boolean(recording)} onClick={() => startRecording('source')}>● 참조 음성 녹음</button> : <button className="stop-btn" onClick={stopRecording}>■ 녹음 끝내기 · {elapsed.toFixed(1)}초</button>}
            {sourceBlob && <span>✓ {sourceSeconds.toFixed(1)}초</span>}
          </div>
          <AudioPreview blob={sourceBlob} />
        </div>

        <div className="record-card consent-card">
          <strong>2. 동의 문구를 정확히 읽어 주세요</strong>
          <p className="consent-text">{CONSENT_TEXT}</p>
          <div className="record-actions">
            {recording !== 'consent' ? <button className="mini-btn" disabled={Boolean(recording)} onClick={() => startRecording('consent')}>● 동의 음성 녹음</button> : <button className="stop-btn" onClick={stopRecording}>■ 녹음 끝내기 · {elapsed.toFixed(1)}초</button>}
            {consentBlob && <span>✓ {consentSeconds.toFixed(1)}초</span>}
          </div>
          <AudioPreview blob={consentBlob} />
        </div>
      </div>

      <div className="clone-actions">
        <button className="outline-cta" disabled={creating || !sourceBlob || !consentBlob} onClick={createClone}>{creating ? '내 목소리 생성 중…' : existingVoiceKey ? '내 목소리 다시 만들기' : '3. 내 목소리 만들기'}</button>
        {existingVoiceKey && <button className="ghost-danger" onClick={onClearVoiceKey}>이 브라우저에서 음성 키 지우기</button>}
      </div>
      <p className="clone-note">복제는 본인 음성만 사용하세요. 이 앱은 Google의 상태 비저장 음성 키를 사용하며, 원본 녹음 파일을 앱 서버에 저장하지 않습니다. 음성 키는 브라우저에 저장되고 약 7일 후 만료됩니다.</p>
      {error && <div className="error compact-error">{error}</div>}
    </div>
  );
}
