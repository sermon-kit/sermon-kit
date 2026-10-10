'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FFmpeg as FFmpegInstance } from '@ffmpeg/ffmpeg';
import type { Candidate } from '@/components/CandidateCard';

type Caption = { start: number; duration: number; text: string };
type EditCaption = { id: string; start: number; end: number; text: string };

type Props = {
  selected: Candidate;
  transcript: Caption[];
  voiceBlob: Blob | null;
  openingCaption?: string;
  onApplyNarration: (text: string) => void;
};

function srtTime(total: number) {
  const ms = Math.max(0, Math.round(total * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) line = test;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

async function captionPng(text: string, width: number, isOpening = false) {
  const canvas = document.createElement('canvas');
  const height = isOpening ? Math.round(width * 0.30) : Math.round(width * 0.26);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('자막 이미지를 만들 수 없습니다.');

  const fontSize = Math.round(width * (isOpening ? 0.058 : 0.052));
  const lineHeight = Math.round(fontSize * 1.35);
  ctx.font = `800 ${fontSize}px Arial, "Noto Sans KR", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapText(ctx, text, width * 0.88);
  const blockHeight = Math.max(lineHeight, lines.length * lineHeight);
  const y0 = (height - blockHeight) / 2 + lineHeight / 2;

  ctx.fillStyle = isOpening ? 'rgba(10,8,4,0.78)' : 'rgba(0,0,0,0.60)';
  const boxY = Math.max(4, y0 - lineHeight * 0.72);
  const boxH = Math.min(height - 8, blockHeight + lineHeight * 0.55);
  const radius = Math.round(width * 0.025);
  ctx.beginPath();
  ctx.roundRect(width * 0.035, boxY, width * 0.93, boxH, radius);
  ctx.fill();

  lines.forEach((line, i) => {
    const y = y0 + i * lineHeight;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.95)';
    ctx.lineWidth = Math.max(5, Math.round(fontSize * 0.14));
    ctx.strokeText(line, width / 2, y);
    ctx.fillStyle = isOpening ? '#ffd33d' : '#ffffff';
    ctx.fillText(line, width / 2, y);
  });

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('자막 이미지를 만들지 못했습니다.')), 'image/png');
  });
}

function atempoChain(factor: number) {
  const parts: number[] = [];
  let f = factor;
  while (f > 2) { parts.push(2); f /= 2; }
  while (f < 0.5) { parts.push(0.5); f /= 0.5; }
  parts.push(f);
  return parts.map(x => `atempo=${x.toFixed(5)}`).join(',');
}

async function getAudioDuration(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error('AI 음성 길이를 확인하지 못했습니다.'));
      audio.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function SubtitleMp4Editor({ selected, transcript, voiceBlob, openingCaption, onApplyNarration }: Props) {
  const clipDuration = Math.max(1, selected.end - selected.start);
  const [captions, setCaptions] = useState<EditCaption[]>([]);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [audioMode, setAudioMode] = useState<'original' | 'ai'>('original');
  const [layout, setLayout] = useState<'crop' | 'blur'>('blur');
  const [resolution, setResolution] = useState<'720' | '1080'>('720');
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [renderError, setRenderError] = useState('');
  const [renderedBlob, setRenderedBlob] = useState<Blob | null>(null);
  const [renderedUrl, setRenderedUrl] = useState('');
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ffmpegRef = useRef<FFmpegInstance | null>(null);

  useEffect(() => {
    const rows = transcript.map((x, i) => {
      const start = Math.max(0, x.start - selected.start);
      const end = Math.max(start + 0.25, Math.min(clipDuration, x.start + x.duration - selected.start));
      return { id: `${selected.id}-${i}-${x.start}`, start: round2(start), end: round2(end), text: x.text };
    }).filter(x => x.start < clipDuration);
    setCaptions(rows);
    setCurrentTime(0);
  }, [selected.id, selected.start, selected.end, transcript, clipDuration]);

  useEffect(() => {
    if (!sourceFile) {
      setSourceUrl('');
      return;
    }
    const url = URL.createObjectURL(sourceFile);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [sourceFile]);

  const activeCaption = useMemo(() => captions.find(c => currentTime >= c.start && currentTime <= c.end), [captions, currentTime]);

  useEffect(() => () => {
    if (renderedUrl) URL.revokeObjectURL(renderedUrl);
  }, [renderedUrl]);

  function clearRendered() {
    if (renderedUrl) URL.revokeObjectURL(renderedUrl);
    setRenderedUrl('');
    setRenderedBlob(null);
  }

  function updateCaption(id: string, patch: Partial<EditCaption>) {
    clearRendered();
    setCaptions(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }

  function addCaption() {
    clearRendered();
    const lastEnd = captions.length ? captions[captions.length - 1].end : 0;
    const start = Math.min(clipDuration - 0.5, Math.max(0, lastEnd));
    const end = Math.min(clipDuration, start + 2.5);
    setCaptions(prev => [...prev, { id: `manual-${Date.now()}`, start: round2(start), end: round2(end), text: '새 자막을 입력하세요' }]);
  }

  function removeCaption(id: string) {
    clearRendered();
    setCaptions(prev => prev.filter(c => c.id !== id));
  }

  function normalizeCaptions() {
    clearRendered();
    setCaptions(prev => [...prev]
      .map(c => ({ ...c, start: Math.max(0, Math.min(clipDuration, c.start)), end: Math.max(0, Math.min(clipDuration, c.end)) }))
      .map(c => c.end <= c.start ? { ...c, end: Math.min(clipDuration, c.start + 0.8) } : c)
      .sort((a, b) => a.start - b.start));
  }

  function downloadEditedSrt() {
    normalizeCaptions();
    const ordered = [...captions].sort((a, b) => a.start - b.start);
    const srt = ordered.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text.trim()}\n`).join('\n');
    downloadBlob(new Blob([srt], { type: 'text/plain;charset=utf-8' }), `sermon-short-${selected.id}-edited.srt`);
  }

  function applyToNarration() {
    const text = [...captions].sort((a, b) => a.start - b.start).map(c => c.text.trim()).filter(Boolean).join(' ');
    onApplyNarration(text);
    document.getElementById('voice-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function seekToSegmentStart() {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = selected.start;
    setCurrentTime(0);
    void v.play();
  }

  async function loadFfmpeg() {
    if (ffmpegRef.current && ffmpegReady) return ffmpegRef.current;
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');
    const ffmpeg: FFmpegInstance = ffmpegRef.current ?? new FFmpeg();
    if (!ffmpegRef.current) {
      ffmpeg.on('progress', ({ progress }) => setProgress(Math.max(1, Math.min(99, Math.round(progress * 100)))));
      ffmpegRef.current = ffmpeg;
    }
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    setFfmpegReady(true);
    return ffmpeg;
  }

  async function renderMp4() {
    if (!sourceFile) {
      setRenderError('먼저 본인이 사용 권한을 가진 원본 MP4 파일을 선택해 주세요.');
      return;
    }
    if (sourceFile.size > 900 * 1024 * 1024) {
      setRenderError('무료 브라우저 렌더링은 메모리를 많이 사용합니다. 원본 파일을 900MB 이하로 줄인 뒤 다시 시도해 주세요.');
      return;
    }
    if (!captions.length) {
      setRenderError('편집할 자막이 없습니다.');
      return;
    }
    if (audioMode === 'ai' && !voiceBlob) {
      setRenderError('AI 음성을 먼저 만들어 주세요.');
      return;
    }

    clearRendered();
    setRendering(true);
    setProgress(1);
    setRenderError('');
    try {
      const ffmpeg = await loadFfmpeg();
      const { fetchFile } = await import('@ffmpeg/util');
      const stamp = Date.now();
      const sourceName = `source-${stamp}.mp4`;
      const voiceName = `voice-${stamp}.wav`;
      const outputName = `sermon-short-${stamp}.mp4`;
      await ffmpeg.writeFile(sourceName, await fetchFile(sourceFile));
      if (audioMode === 'ai' && voiceBlob) await ffmpeg.writeFile(voiceName, await fetchFile(voiceBlob));

      const width = resolution === '1080' ? 1080 : 720;
      const height = resolution === '1080' ? 1920 : 1280;
      const clean = captions
        .map(c => ({ ...c, start: Math.max(0, Math.min(clipDuration, Number(c.start) || 0)), end: Math.max(0, Math.min(clipDuration, Number(c.end) || 0)), text: c.text.trim() }))
        .filter(c => c.text && c.end > c.start)
        .sort((a, b) => a.start - b.start)
        .slice(0, 36);

      const opening = (openingCaption || selected.hook || '').trim();
      const overlayFiles: { name: string; start: number; end: number; opening: boolean }[] = [];
      if (opening) {
        const name = `opening-${stamp}.png`;
        const png = await captionPng(opening, Math.round(width * 0.92), true);
        await ffmpeg.writeFile(name, await fetchFile(png));
        overlayFiles.push({ name, start: 0, end: Math.min(3.5, clipDuration), opening: true });
      }
      for (let i = 0; i < clean.length; i++) {
        const name = `cap-${stamp}-${i}.png`;
        const png = await captionPng(clean[i].text, Math.round(width * 0.92));
        await ffmpeg.writeFile(name, await fetchFile(png));
        overlayFiles.push({ name, start: clean[i].start, end: clean[i].end, opening: false });
      }

      const args: string[] = ['-ss', String(selected.start), '-t', String(clipDuration), '-i', sourceName];
      let nextInput = 1;
      const voiceInputIndex = audioMode === 'ai' ? nextInput++ : -1;
      if (audioMode === 'ai') args.push('-i', voiceName);
      const overlayStartIndex = nextInput;
      for (const item of overlayFiles) args.push('-loop', '1', '-i', item.name);

      const vf: string[] = [];
      if (layout === 'crop') {
        vf.push(`[0:v]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[base]`);
      } else {
        vf.push(`[0:v]setpts=PTS-STARTPTS,split=2[bgsrc][fgsrc]`);
        vf.push(`[bgsrc]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=28:2[bg]`);
        vf.push(`[fgsrc]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg]`);
        vf.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2[base]`);
      }

      let prev = 'base';
      overlayFiles.forEach((item, i) => {
        const inputIndex = overlayStartIndex + i;
        const out = `v${i}`;
        const y = item.opening ? Math.round(height * 0.12) : Math.round(height * 0.68);
        vf.push(`[${prev}][${inputIndex}:v]overlay=(W-w)/2:${y}:enable='between(t,${item.start.toFixed(2)},${item.end.toFixed(2)})'[${out}]`);
        prev = out;
      });

      let audioMap: string[];
      if (audioMode === 'ai' && voiceBlob) {
        const voiceDuration = await getAudioDuration(voiceBlob);
        const factor = voiceDuration > 0 ? voiceDuration / clipDuration : 1;
        vf.push(`[${voiceInputIndex}:a]${atempoChain(Math.max(0.05, factor))},apad,atrim=0:${clipDuration.toFixed(3)}[aout]`);
        audioMap = ['-map', '[aout]'];
      } else {
        audioMap = ['-map', '0:a?'];
      }

      args.push(
        '-filter_complex', vf.join(';'),
        '-map', `[${prev}]`,
        ...audioMap,
        '-t', String(clipDuration),
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', resolution === '1080' ? '25' : '27',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputName
      );

      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile(outputName);
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      setRenderedBlob(blob);
      setRenderedUrl(url);
      setProgress(100);

      const cleanup = [sourceName, outputName, ...(audioMode === 'ai' ? [voiceName] : []), ...overlayFiles.map(x => x.name)];
      for (const name of cleanup) {
        try { await ffmpeg.deleteFile(name); } catch {}
      }
    } catch (e: any) {
      setRenderError(e?.message || 'MP4 렌더링 중 오류가 발생했습니다.');
    } finally {
      setRendering(false);
    }
  }


  function downloadRenderedMp4() {
    if (!renderedBlob) return;
    downloadBlob(renderedBlob, `sermon-short-${selected.id}.mp4`);
  }

  return (
    <div className="mp4-editor">
      <div className="editor-title-row">
        <div>
          <span className="eyebrow">자막 편집기 + 무료 MP4 렌더링</span>
          <h3>자막을 고친 뒤 세로 쇼츠 MP4로 저장합니다</h3>
        </div>
        <button className="mini-btn" onClick={addCaption}>+ 자막 추가</button>
      </div>

      <div className="caption-editor-list">
        {captions.map((c, i) => (
          <div className="caption-row" key={c.id}>
            <div className="caption-no">{i + 1}</div>
            <div className="caption-times">
              <label>시작<input type="number" min="0" max={clipDuration} step="0.1" value={c.start} onChange={e => updateCaption(c.id, { start: Number(e.target.value) })}/></label>
              <label>끝<input type="number" min="0" max={clipDuration} step="0.1" value={c.end} onChange={e => updateCaption(c.id, { end: Number(e.target.value) })}/></label>
            </div>
            <textarea value={c.text} onChange={e => updateCaption(c.id, { text: e.target.value })}/>
            <button className="delete-caption" onClick={() => removeCaption(c.id)} aria-label="자막 삭제">×</button>
          </div>
        ))}
      </div>

      <div className="editor-toolbar">
        <button className="outline-cta" onClick={normalizeCaptions}>시간순 정리</button>
        <button className="outline-cta" onClick={downloadEditedSrt}>편집한 SRT 다운로드</button>
        <button className="outline-cta" onClick={applyToNarration}>편집 자막을 AI 음성 원고에 반영</button>
      </div>

      <div className="mp4-grid">
        <div className="vertical-preview">
          {sourceUrl ? (
            <div className="phone-preview">
              <video
                ref={videoRef}
                src={sourceUrl}
                controls
                onLoadedMetadata={() => {
                  if (videoRef.current) videoRef.current.currentTime = selected.start;
                }}
                onTimeUpdate={e => {
                  const absolute = e.currentTarget.currentTime;
                  setCurrentTime(Math.max(0, absolute - selected.start));
                  if (absolute >= selected.end) e.currentTarget.pause();
                }}
              />
              {activeCaption && <div className="live-caption">{activeCaption.text}</div>}
            </div>
          ) : (
            <div className="preview-empty">원본 MP4를 선택하면<br/>세로 미리보기가 나타납니다.</div>
          )}
          {sourceUrl && <button className="mini-btn full" onClick={seekToSegmentStart}>선택 구간부터 미리보기</button>}
        </div>

        <div className="render-controls">
          <label className="upload-label">원본 설교 MP4
            <input type="file" accept="video/mp4,video/quicktime,video/*" onChange={e => { clearRendered(); setSourceFile(e.target.files?.[0] || null); }}/>
          </label>
          <p className="render-note">파일은 서버로 업로드하지 않고 현재 브라우저에서만 처리합니다. 긴 원본은 PC 메모리를 많이 사용할 수 있습니다.</p>

          <div className="option-block">
            <strong>세로 화면</strong>
            <div className="segmented"><button className={layout === 'blur' ? 'active' : ''} onClick={() => { clearRendered(); setLayout('blur'); }}>원본 유지 + 흐린 배경</button><button className={layout === 'crop' ? 'active' : ''} onClick={() => { clearRendered(); setLayout('crop'); }}>화면 꽉 채우기</button></div>
          </div>

          <div className="option-block">
            <strong>음성</strong>
            <div className="segmented"><button className={audioMode === 'original' ? 'active' : ''} onClick={() => { clearRendered(); setAudioMode('original'); }}>원본 설교 음성</button><button disabled={!voiceBlob} className={audioMode === 'ai' ? 'active' : ''} onClick={() => { clearRendered(); setAudioMode('ai'); }}>AI 음성{!voiceBlob ? ' (먼저 생성)' : ''}</button></div>
          </div>

          <div className="option-block">
            <strong>해상도</strong>
            <div className="segmented"><button className={resolution === '720' ? 'active' : ''} onClick={() => { clearRendered(); setResolution('720'); }}>720×1280 · 추천</button><button className={resolution === '1080' ? 'active' : ''} onClick={() => { clearRendered(); setResolution('1080'); }}>1080×1920 · 느림</button></div>
          </div>

          <div className="mp4-action-grid">
            <button className="cta render-button" disabled={rendering || !sourceFile} onClick={renderMp4}>{rendering ? `MP4 만드는 중… ${progress}%` : '1. 9:16 쇼츠 MP4 만들기'}</button>
            <button className="download-cta" disabled={!renderedBlob || rendering} onClick={downloadRenderedMp4}>2. 완성 MP4 다운로드</button>
          </div>
          {rendering && <div className="progress-track"><div style={{ width: `${progress}%` }}/></div>}
          {renderError && <div className="error compact-error">{renderError}</div>}
          {renderedUrl && <div className="rendered-result"><strong>완성된 쇼츠</strong><video src={renderedUrl} controls playsInline/><button className="download-cta ready" onClick={downloadRenderedMp4}>MP4 파일 다운로드</button></div>}
          <p className="render-note">첫 실행 때 FFmpeg 엔진을 한 번 내려받습니다. 완성되면 위의 ‘완성 MP4 다운로드’ 버튼이 활성화됩니다.</p>
        </div>
      </div>
    </div>
  );
}
