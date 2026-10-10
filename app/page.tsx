'use client';

import { useEffect, useMemo, useState } from 'react';
import CandidateCard, { Candidate } from '@/components/CandidateCard';
import YouTubePreview from '@/components/YouTubePreview';
import SubtitleMp4Editor from '@/components/SubtitleMp4Editor';
import VoiceCloneRecorder from '@/components/VoiceCloneRecorder';
import { secondsToClock } from '@/lib/youtube';

const durations = [30, 60, 180];

type Caption = { start: number; duration: number; text: string };
type SocialPack = { titleOptions: string[]; description: string; hashtags: string[]; thumbnailText: string; openingCaption: string; };
type RewritePack = { title: string; hook: string; script: string; summary: string; reason: string; captionChunks: string[]; };

const voices = [
  { id: 'Gacrux', label: '성숙하고 안정적인 음성' },
  { id: 'Charon', label: '또렷한 설명형 음성' },
  { id: 'Sulafat', label: '따뜻한 음성' },
  { id: 'Kore', label: '단단하고 힘 있는 음성' },
  { id: 'Achird', label: '친근한 음성' },
  { id: 'Schedar', label: '고른 톤의 음성' },
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function chunksToCaptions(chunks: string[], selected: Candidate): Caption[] {
  const clean = chunks.map(x => x.trim()).filter(Boolean);
  if (!clean.length) return [];
  const clipDuration = Math.max(1, selected.end - selected.start);
  const weights = clean.map(x => Math.max(4, x.replace(/\s/g, '').length));
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return clean.map((text, i) => {
    const raw = clipDuration * (weights[i] / total);
    const duration = i === clean.length - 1 ? Math.max(.5, clipDuration - cursor) : Math.max(.8, raw);
    const item = { start: selected.start + cursor, duration, text };
    cursor += duration;
    return item;
  });
}

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [duration, setDuration] = useState(60);
  const [analysisStyle, setAnalysisStyle] = useState<'balanced' | 'views'>('views');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoId, setVideoId] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [transcript, setTranscript] = useState<Caption[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [socialLoading, setSocialLoading] = useState(false);
  const [social, setSocial] = useState<SocialPack | null>(null);
  const [captionLoading, setCaptionLoading] = useState(false);
  const [rewriteLoading, setRewriteLoading] = useState(false);
  const [rewrite, setRewrite] = useState<RewritePack | null>(null);
  const [voice, setVoice] = useState('Gacrux');
  const [voiceMode, setVoiceMode] = useState<'preset' | 'clone'>('preset');
  const [cloneVoiceKey, setCloneVoiceKey] = useState('');
  const [cloneExpiresAt, setCloneExpiresAt] = useState(0);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceUrl, setVoiceUrl] = useState('');
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [narrationText, setNarrationText] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('sermon-shorts-gemini-key');
    if (saved) setApiKey(saved);
    try {
      const raw = localStorage.getItem('sermon-shorts-clone-voice');
      if (raw) {
        const data = JSON.parse(raw);
        if (data?.key && Number(data?.expiresAt) > Date.now()) {
          setCloneVoiceKey(String(data.key));
          setCloneExpiresAt(Number(data.expiresAt));
        } else localStorage.removeItem('sermon-shorts-clone-voice');
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (apiKey) localStorage.setItem('sermon-shorts-gemini-key', apiKey);
  }, [apiKey]);

  useEffect(() => () => { if (voiceUrl) URL.revokeObjectURL(voiceUrl); }, [voiceUrl]);

  const canAnalyze = useMemo(() => Boolean(apiKey.trim() && youtubeUrl.trim()), [apiKey, youtubeUrl]);

  function resetVoice() {
    setVoiceBlob(null);
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    setVoiceUrl('');
  }

  function chooseCandidate(candidate: Candidate) {
    setSelected(candidate);
    setTranscript([]);
    setNarrationText('');
    setSocial(null);
    setRewrite(null);
    resetVoice();
    setTimeout(() => document.getElementById('studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  async function analyze() {
    setLoading(true);
    setError('');
    setCandidates([]);
    setSelected(null);
    setSocial(null);
    setRewrite(null);
    setTranscript([]);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), youtubeUrl: youtubeUrl.trim(), duration, analysisStyle })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ? `${data.error} · ${data.detail}` : (data.error || '분석에 실패했습니다.'));
      setVideoId(data.videoId);
      setCandidates(data.candidates || []);
    } catch (e: any) { setError(e.message || '오류가 발생했습니다.'); }
    finally { setLoading(false); }
  }

  async function createSocialPack() {
    if (!selected) return;
    setSocialLoading(true); setError('');
    try {
      const res = await fetch('/api/social', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: apiKey.trim(), candidate: rewrite ? { ...selected, title: rewrite.title, hook: rewrite.hook, summary: rewrite.summary } : selected }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ? `${data.error} · ${data.detail}` : (data.error || 'SNS 문구 생성에 실패했습니다.'));
      setSocial(data);
    } catch (e: any) { setError(e.message || 'SNS 문구 생성 오류가 발생했습니다.'); }
    finally { setSocialLoading(false); }
  }

  async function ensureCaptions(): Promise<Caption[]> {
    if (!selected) throw new Error('먼저 쇼츠 후보를 선택해 주세요.');
    if (transcript.length) return transcript;
    setCaptionLoading(true); setError('');
    try {
      const captionRes = await fetch('/api/captions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: apiKey.trim(), youtubeUrl: youtubeUrl.trim(), candidate: selected }) });
      const captionData = await captionRes.json();
      if (!captionRes.ok) throw new Error(captionData.detail ? `${captionData.error} · ${captionData.detail}` : (captionData.error || '자막 생성에 실패했습니다.'));
      const next = (captionData.transcript || []) as Caption[];
      if (!next.length) throw new Error('선택 구간의 자막을 만들지 못했습니다.');
      setTranscript(next);
      setNarrationText(next.map(x => x.text).join(' '));
      setRewrite(null);
      resetVoice();
      return next;
    } finally { setCaptionLoading(false); }
  }

  async function prepareCaptions() {
    try { await ensureCaptions(); } catch (e: any) { setError(e.message || '자막 생성 중 오류가 발생했습니다.'); }
  }

  async function createRewrite() {
    if (!selected) return;
    setRewriteLoading(true); setError('');
    try {
      const res = await fetch('/api/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: apiKey.trim(), youtubeUrl: youtubeUrl.trim(), candidate: selected, duration }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ? `${data.error} · ${data.detail}` : (data.error || '재구성에 실패했습니다.'));
      const pack = data as RewritePack;
      if (!pack.script) throw new Error('재구성 대본이 비어 있습니다.');
      setRewrite(pack);
      setNarrationText(pack.script);
      setTranscript(chunksToCaptions(pack.captionChunks?.length ? pack.captionChunks : pack.script.split(/(?<=[.!?다요])\s+/), selected));
      setSocial(null);
      resetVoice();
    } catch (e: any) { setError(e.message || '재구성 중 오류가 발생했습니다.'); }
    finally { setRewriteLoading(false); }
  }

  async function createVoice() {
    if (!selected) return;
    if (voiceMode === 'clone' && !cloneVoiceKey) { setError('먼저 아래에서 내 목소리를 만들어 주세요.'); return; }
    setVoiceLoading(true); setError('');
    try {
      let caps = transcript;
      if (!caps.length && !narrationText.trim()) caps = await ensureCaptions();
      const text = narrationText.trim() || caps.map(x => x.text).join(' ');
      const res = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), text, voice, voiceKey: voiceMode === 'clone' ? cloneVoiceKey : undefined, style: '차분하고 따뜻하며 또렷한 한국어 설교 쇼츠 내레이션. 핵심 문장에는 자연스럽게 힘을 주고 과장된 연기는 피한다.' })
      });
      if (!res.ok) {
        let message = 'AI 음성 생성에 실패했습니다.';
        try { const data = await res.json(); message = data.detail ? `${data.error} · ${data.detail}` : (data.error || message); } catch {}
        throw new Error(message);
      }
      const blob = await res.blob();
      if (voiceUrl) URL.revokeObjectURL(voiceUrl);
      const url = URL.createObjectURL(blob);
      setVoiceBlob(blob); setVoiceUrl(url);
    } catch (e: any) { setError(e.message || 'AI 음성 생성 중 오류가 발생했습니다.'); }
    finally { setVoiceLoading(false); }
  }

  async function copy(text: string) { await navigator.clipboard.writeText(text); }
  function downloadVoice() { if (voiceBlob && selected) downloadBlob(voiceBlob, `sermon-short-${selected.id}-${voiceMode === 'clone' ? 'my-voice' : 'ai-voice'}.wav`); }
  function copySegmentLink() { if (selected && videoId) copy(`https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(selected.start))}s`); }
  function saveCloneVoiceKey(key: string, expiresAt: number) {
    setCloneVoiceKey(key); setCloneExpiresAt(expiresAt); setVoiceMode('clone');
    localStorage.setItem('sermon-shorts-clone-voice', JSON.stringify({ key, expiresAt }));
  }
  function clearCloneVoiceKey() {
    setCloneVoiceKey(''); setCloneExpiresAt(0); setVoiceMode('preset');
    localStorage.removeItem('sermon-shorts-clone-voice');
  }

  return (
    <main>
      <section className="hero">
        <div className="badge">✦ AI 설교 미디어 도구 · 무료 구성</div>
        <h1>설교 한 편에서<br/><em>사람들이 멈춰 볼 1분을</em></h1>
        <p>공개 설교 YouTube 링크를 분석해 후보를 찾고, 조회수형 재구성 대본·자막·AI 음성·MP4까지 만듭니다.</p>
      </section>

      <section className="free-box">
        <strong>이번 버전에 추가된 기능</strong>
        <div className="free-chips"><span>조회수 우선 후보</span><span>쇼츠 대본 재구성</span><span>내 목소리 복제</span><span>자막 편집기</span><span>완성 MP4 미리보기</span><span>MP4 다운로드 버튼</span></div>
        <p>AI 이미지 생성과 YouTube 원본 자동 다운로드는 무료판에서 제외합니다. MP4는 사용 권한이 있는 원본 파일을 브라우저에서 처리합니다.</p>
      </section>

      <section className="panel">
        <div className="step">
          <div className="number">1</div><div className="step-body">
            <div className="label-row"><label>Gemini API 키</label>{apiKey ? <span className="saved">✓ 브라우저 저장됨</span> : <span className="hint">미입력</span>}</div>
            <div className="input-wrap"><span>🔑</span><input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e)=>setApiKey(e.target.value)} placeholder="AIza..."/><button onClick={()=>setShowKey(v=>!v)}>{showKey ? '숨김' : '보기'}</button></div>
            <p className="hint">API 키는 이 브라우저에 저장됩니다. 무료 등급의 사용량 한도는 Google 정책을 따릅니다.</p>
          </div>
        </div>
        <div className="step">
          <div className="number">2</div><div className="step-body">
            <label>설교 YouTube 링크</label><div className="input-wrap"><span>🔗</span><input value={youtubeUrl} onChange={(e)=>setYoutubeUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..."/></div>
            <p className="hint">Gemini의 YouTube URL 분석은 공개(Public) 영상에서 사용합니다.</p>
          </div>
        </div>
        <div className="step">
          <div className="number">3</div><div className="step-body">
            <label>쇼츠 길이</label>
            <div className="duration-grid">{durations.map(d => <button key={d} className={duration===d ? 'duration active':'duration'} onClick={()=>setDuration(d)}>{d===60 ? '1분' : d===180 ? '3분' : '30초'}{d===60 && <small>추천</small>}</button>)}</div>
            <label className="sub-label">후보 선정 기준</label>
            <div className="analysis-style"><button className={analysisStyle === 'balanced' ? 'active' : ''} onClick={()=>setAnalysisStyle('balanced')}>메시지 균형형</button><button className={analysisStyle === 'views' ? 'active' : ''} onClick={()=>setAnalysisStyle('views')}>조회수·시청 유지 우선</button></div>
          </div>
        </div>
        <button className="cta" disabled={!canAnalyze || loading} onClick={analyze}>{loading ? '설교 전체 분석 중…' : '✦ 쇼츠 후보 5개 찾기'}</button>
        {error && <div className="error">{error}</div>}
      </section>

      {candidates.length > 0 && <section className="results">
        <div className="section-title"><span>AI 분석 결과</span><h2>이번 설교의 쇼츠 후보</h2><p>문맥 정확성, 메시지 완결성, 첫 3초 후킹, 조회 가능성을 함께 평가합니다.</p></div>
        <div className="cards">{candidates.map(c => <CandidateCard key={c.id} candidate={c} videoId={videoId} selected={selected?.id===c.id} onSelect={chooseCandidate}/>)}</div>
      </section>}

      {selected && <section className="studio" id="studio">
        <div className="section-title"><span>쇼츠 제작실</span><h2>{rewrite?.title || selected.title}</h2><p>{secondsToClock(selected.start)} ~ {secondsToClock(selected.end)} · {selected.end-selected.start}초</p></div>
        <div className="studio-grid">
          <div><YouTubePreview videoId={videoId} candidate={selected}/><div className="mini-note">선택한 원본 구간을 확인합니다. 영상 소유권과 사용 권한은 사용자가 확인해 주세요.</div></div>
          <div className="studio-side">
            <div className="info-card"><span className="eyebrow">첫 3초</span><strong>{rewrite?.hook || social?.openingCaption || selected.hook}</strong><p>{rewrite?.summary || selected.summary}</p></div>
            <button className="outline-cta" onClick={copySegmentLink}>선택 구간 YouTube 주소 복사</button>
            <button className="outline-cta" onClick={createSocialPack} disabled={socialLoading}>{socialLoading ? '게시 문구 생성 중…' : 'AI 제목 · 설명 · 태그 만들기'}</button>
          </div>
        </div>

        <div className="recompose-box">
          <div><span className="eyebrow">조회수형 재구성</span><h3>원문을 그대로 자르지 않고 쇼츠 문법으로 다시 구성</h3><p>설교 전체와 앞뒤 문맥을 확인한 뒤, 핵심 의미를 유지하면서 후킹 → 핵심 메시지 → 적용 순서로 대본을 재구성합니다.</p></div>
          <button className="cta compact" onClick={createRewrite} disabled={rewriteLoading}>{rewriteLoading ? '대본 재구성 중…' : '조회수형 쇼츠 대본 재구성'}</button>
        </div>
        {rewrite && <div className="rewrite-result"><div className="rewrite-head"><span className="eyebrow">재구성 완료</span><strong>{rewrite.title}</strong></div><div className="rewrite-hook">{rewrite.hook}</div><p>{rewrite.script}</p><small>{rewrite.reason}</small></div>}

        {social && <div className="social-box">
          <div className="social-head"><div><span className="eyebrow">SNS 게시 패키지</span><h3>그대로 복사해 사용할 수 있습니다</h3></div></div>
          <div className="social-section"><h4>추천 제목 5개</h4><div className="title-options">{social.titleOptions?.map((t,i)=><button key={i} onClick={()=>copy(t)}>{i+1}. {t}<small>복사</small></button>)}</div></div>
          <div className="social-section two-col"><div><h4>썸네일 문구</h4><button className="copy-card" onClick={()=>copy(social.thumbnailText)}>{social.thumbnailText}<small>복사</small></button></div><div><h4>첫 화면 문구</h4><button className="copy-card" onClick={()=>copy(social.openingCaption)}>{social.openingCaption}<small>복사</small></button></div></div>
          <div className="social-section"><h4>설명</h4><button className="copy-card left" onClick={()=>copy(social.description)}>{social.description}<small>복사</small></button></div>
          <div className="social-section"><h4>해시태그</h4><button className="copy-card left" onClick={()=>copy((social.hashtags||[]).join(' '))}>{(social.hashtags||[]).join(' ')}<small>복사</small></button></div>
        </div>}

        <div className="render-panel">
          <div className="render-top"><div><span className="eyebrow">무료 편집 자료</span><h3>원문 자막 또는 재구성 대본을 음성과 영상으로 만듭니다</h3></div></div>
          <div className="free-editor">
            <div className="editor-actions two-actions">
              <button className="outline-cta" onClick={prepareCaptions} disabled={captionLoading}>{captionLoading ? '선택 구간 듣는 중…' : transcript.length && !rewrite ? '✓ 원문 자막 준비됨' : '원문 그대로 자막 만들기'}</button>
              <button className="outline-cta" onClick={createRewrite} disabled={rewriteLoading}>{rewriteLoading ? '재구성 중…' : rewrite ? '✓ 재구성 대본 준비됨' : '조회수형 대본 + 자막 만들기'}</button>
            </div>

            {transcript.length > 0 && <>
              <div className="transcript-preview"><strong>{rewrite ? 'AI 재구성 대본' : 'AI가 들은 원문'}</strong><p>{rewrite?.script || transcript.map(x=>x.text).join(' ')}</p></div>
              <label className="editor-label">AI 음성이 읽을 문장</label>
              <textarea className="narration" value={narrationText} onChange={(e)=>setNarrationText(e.target.value)} />

              <div className="voice-mode-tabs"><button className={voiceMode==='preset'?'active':''} onClick={()=>setVoiceMode('preset')}>기본 AI 음성</button><button className={voiceMode==='clone'?'active':''} onClick={()=>setVoiceMode('clone')}>내 목소리 AI {cloneVoiceKey ? '✓' : ''}</button></div>
              {voiceMode === 'preset' && <div className="voice-row" id="voice-section"><div><label className="editor-label">AI 음성</label><select value={voice} onChange={(e)=>setVoice(e.target.value)}>{voices.map(v=><option key={v.id} value={v.id}>{v.label} · {v.id}</option>)}</select></div><button className="cta compact" onClick={createVoice} disabled={voiceLoading || !narrationText.trim()}>{voiceLoading ? 'AI 음성 생성 중…' : 'AI 음성 만들기'}</button></div>}
              {voiceMode === 'clone' && <div id="voice-section"><VoiceCloneRecorder apiKey={apiKey} existingVoiceKey={cloneVoiceKey} existingExpiresAt={cloneExpiresAt} onVoiceKey={saveCloneVoiceKey} onClearVoiceKey={clearCloneVoiceKey}/><button className="cta compact clone-tts" onClick={createVoice} disabled={voiceLoading || !narrationText.trim() || !cloneVoiceKey}>{voiceLoading ? '내 목소리로 읽는 중…' : '내 목소리로 이 대본 읽기'}</button></div>}
            </>}

            {voiceUrl && <div className="audio-card"><strong>{voiceMode === 'clone' ? '내 목소리 AI 음성 완성' : 'AI 음성 완성'}</strong><audio controls src={voiceUrl}/><button className="outline-cta" onClick={downloadVoice}>WAV 음성 다운로드</button><p>최종 MP4에서 원본 설교 음성을 이 음성으로 교체할 수 있습니다.</p></div>}
          </div>

          {transcript.length > 0 && <SubtitleMp4Editor selected={selected} transcript={transcript} voiceBlob={voiceBlob} openingCaption={rewrite?.hook || social?.openingCaption || selected.hook} onApplyNarration={setNarrationText}/>}        
        </div>
      </section>}
      <footer>무료판은 Gemini 무료 등급과 브라우저 FFmpeg를 중심으로 구성했습니다. 내 목소리 기능은 본인 음성과 명시적 동의 녹음이 필요합니다.</footer>
    </main>
  );
}
