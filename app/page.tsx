'use client';

import { useEffect, useMemo, useState } from 'react';
import CandidateCard, { Candidate } from '@/components/CandidateCard';
import YouTubePreview from '@/components/YouTubePreview';
import { secondsToClock } from '@/lib/youtube';

const durations = [30, 60, 180];

type Caption = { start: number; duration: number; text: string };

type SocialPack = {
  titleOptions: string[];
  description: string;
  hashtags: string[];
  thumbnailText: string;
  openingCaption: string;
};

const voices = [
  { id: 'Gacrux', label: '성숙하고 안정적인 음성' },
  { id: 'Charon', label: '또렷한 설명형 음성' },
  { id: 'Sulafat', label: '따뜻한 음성' },
  { id: 'Kore', label: '단단하고 힘 있는 음성' },
  { id: 'Achird', label: '친근한 음성' },
  { id: 'Schedar', label: '고른 톤의 음성' },
];

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
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [duration, setDuration] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoId, setVideoId] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [transcript, setTranscript] = useState<Caption[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [socialLoading, setSocialLoading] = useState(false);
  const [social, setSocial] = useState<SocialPack | null>(null);
  const [captionLoading, setCaptionLoading] = useState(false);
  const [voice, setVoice] = useState('Gacrux');
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceUrl, setVoiceUrl] = useState('');
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [narrationText, setNarrationText] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('sermon-shorts-gemini-key');
    if (saved) setApiKey(saved);
  }, []);

  useEffect(() => {
    if (apiKey) localStorage.setItem('sermon-shorts-gemini-key', apiKey);
  }, [apiKey]);

  useEffect(() => () => {
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
  }, [voiceUrl]);

  const canAnalyze = useMemo(() => Boolean(apiKey.trim() && youtubeUrl.trim()), [apiKey, youtubeUrl]);

  function chooseCandidate(candidate: Candidate) {
    setSelected(candidate);
    setTranscript([]);
    setNarrationText('');
    setSocial(null);
    setVoiceBlob(null);
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    setVoiceUrl('');
    setTimeout(() => document.getElementById('studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  async function analyze() {
    setLoading(true);
    setError('');
    setCandidates([]);
    setSelected(null);
    setSocial(null);
    setTranscript([]);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), youtubeUrl: youtubeUrl.trim(), duration })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ? `${data.error} · ${data.detail}` : (data.error || '분석에 실패했습니다.'));
      setVideoId(data.videoId);
      setCandidates(data.candidates || []);
    } catch (e: any) {
      setError(e.message || '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function createSocialPack() {
    if (!selected) return;
    setSocialLoading(true);
    setError('');
    try {
      const res = await fetch('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), candidate: selected })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ? `${data.error} · ${data.detail}` : (data.error || 'SNS 문구 생성에 실패했습니다.'));
      setSocial(data);
    } catch (e: any) {
      setError(e.message || 'SNS 문구 생성 오류가 발생했습니다.');
    } finally {
      setSocialLoading(false);
    }
  }

  async function ensureCaptions(): Promise<Caption[]> {
    if (!selected) throw new Error('먼저 쇼츠 후보를 선택해 주세요.');
    if (transcript.length) return transcript;
    setCaptionLoading(true);
    setError('');
    try {
      const captionRes = await fetch('/api/captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), youtubeUrl: youtubeUrl.trim(), candidate: selected })
      });
      const captionData = await captionRes.json();
      if (!captionRes.ok) throw new Error(captionData.detail ? `${captionData.error} · ${captionData.detail}` : (captionData.error || '자막 생성에 실패했습니다.'));
      const next = (captionData.transcript || []) as Caption[];
      if (!next.length) throw new Error('선택 구간의 자막을 만들지 못했습니다.');
      setTranscript(next);
      setNarrationText(next.map(x => x.text).join(' '));
      return next;
    } finally {
      setCaptionLoading(false);
    }
  }

  async function prepareCaptions() {
    try {
      await ensureCaptions();
    } catch (e: any) {
      setError(e.message || '자막 생성 중 오류가 발생했습니다.');
    }
  }

  async function createVoice() {
    if (!selected) return;
    setVoiceLoading(true);
    setError('');
    try {
      const caps = await ensureCaptions();
      const text = narrationText.trim() || caps.map(x => x.text).join(' ');
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          text,
          voice,
          style: '차분하고 따뜻하며 또렷한 한국어 설교 쇼츠 내레이션. 문장을 자연스럽게 연결하고 과장된 연기는 피한다.'
        })
      });
      if (!res.ok) {
        let message = 'AI 음성 생성에 실패했습니다.';
        try {
          const data = await res.json();
          message = data.detail ? `${data.error} · ${data.detail}` : (data.error || message);
        } catch {}
        throw new Error(message);
      }
      const blob = await res.blob();
      if (voiceUrl) URL.revokeObjectURL(voiceUrl);
      const url = URL.createObjectURL(blob);
      setVoiceBlob(blob);
      setVoiceUrl(url);
    } catch (e: any) {
      setError(e.message || 'AI 음성 생성 중 오류가 발생했습니다.');
    } finally {
      setVoiceLoading(false);
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
  }

  async function downloadSrt() {
    if (!selected) return;
    try {
      const caps = await ensureCaptions();
      const srt = caps.map((x, i) => {
        const start = Math.max(0, x.start - selected.start);
        const end = Math.max(start + 0.8, Math.min(selected.end - selected.start, x.start + x.duration - selected.start));
        return `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${x.text}\n`;
      }).join('\n');
      downloadBlob(new Blob([srt], { type: 'text/plain;charset=utf-8' }), `sermon-short-${selected.id}.srt`);
    } catch (e: any) {
      setError(e.message || 'SRT 생성 중 오류가 발생했습니다.');
    }
  }

  function downloadVoice() {
    if (voiceBlob && selected) downloadBlob(voiceBlob, `sermon-short-${selected.id}-ai-voice.wav`);
  }

  function copySegmentLink() {
    if (!selected || !videoId) return;
    copy(`https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(selected.start))}s`);
  }

  return (
    <main>
      <section className="hero">
        <div className="badge">✦ AI 설교 미디어 도구 · 무료 구성</div>
        <h1>설교 한 편에서<br/><em>사람들이 멈춰 볼 1분을</em></h1>
        <p>공개 설교 YouTube 링크를 AI가 분석하고, 쇼츠 후보·자막·게시 문구·AI 음성을 만듭니다.</p>
      </section>

      <section className="free-box">
        <strong>이 버전에 포함된 무료 기능</strong>
        <div className="free-chips"><span>쇼츠 후보 5개</span><span>구간 미리보기</span><span>SNS 문구</span><span>SRT 자막</span><span>AI 음성 WAV</span></div>
        <p>AI 이미지 자동 생성, YouTube 원본 자동 다운로드, 서버 MP4 렌더링은 비용·서비스 정책이 필요한 기능이라 이 무료판에서는 제외했습니다.</p>
      </section>

      <section className="panel">
        <div className="step">
          <div className="number">1</div>
          <div className="step-body">
            <div className="label-row"><label>Gemini API 키</label>{apiKey ? <span className="saved">✓ 브라우저 저장됨</span> : <span className="hint">미입력</span>}</div>
            <div className="input-wrap"><span>🔑</span><input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e)=>setApiKey(e.target.value)} placeholder="AIza..."/><button onClick={()=>setShowKey(v=>!v)}>{showKey ? '숨김' : '보기'}</button></div>
            <p className="hint">API 키는 이 브라우저에만 저장됩니다. 무료 등급의 사용량 한도는 Google 정책을 따릅니다.</p>
          </div>
        </div>

        <div className="step">
          <div className="number">2</div>
          <div className="step-body">
            <label>설교 YouTube 링크</label>
            <div className="input-wrap"><span>🔗</span><input value={youtubeUrl} onChange={(e)=>setYoutubeUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..."/></div>
            <p className="hint">Gemini의 YouTube URL 분석은 공개(Public) 영상에서 사용합니다.</p>
          </div>
        </div>

        <div className="step">
          <div className="number">3</div>
          <div className="step-body">
            <label>쇼츠 길이</label>
            <div className="duration-grid">
              {durations.map(d => <button key={d} className={duration===d ? 'duration active':'duration'} onClick={()=>setDuration(d)}>
                {d===60 ? '1분' : d===180 ? '3분' : '30초'}
                {d===60 && <small>추천</small>}
              </button>)}
            </div>
          </div>
        </div>

        <button className="cta" disabled={!canAnalyze || loading} onClick={analyze}>{loading ? '설교 전체 분석 중…' : '✦ 쇼츠 후보 5개 찾기'}</button>
        {error && <div className="error">{error}</div>}
      </section>

      {candidates.length > 0 && <section className="results">
        <div className="section-title"><span>AI 분석 결과</span><h2>이번 설교의 쇼츠 후보</h2><p>원문 문맥, 메시지 완결성, 첫 3초 후킹을 함께 평가합니다.</p></div>
        <div className="cards">{candidates.map(c => <CandidateCard key={c.id} candidate={c} videoId={videoId} selected={selected?.id===c.id} onSelect={chooseCandidate}/>)}</div>
      </section>}

      {selected && <section className="studio" id="studio">
        <div className="section-title"><span>쇼츠 제작실</span><h2>{selected.title}</h2><p>{secondsToClock(selected.start)} ~ {secondsToClock(selected.end)} · {selected.end-selected.start}초</p></div>

        <div className="studio-grid">
          <div>
            <YouTubePreview videoId={videoId} candidate={selected}/>
            <div className="mini-note">선택한 원본 구간을 바로 확인할 수 있습니다. 영상 소유권과 사용 권한은 사용자가 확인해 주세요.</div>
          </div>

          <div className="studio-side">
            <div className="info-card">
              <span className="eyebrow">첫 3초</span>
              <strong>{social?.openingCaption || selected.hook}</strong>
              <p>{selected.summary}</p>
            </div>
            <button className="outline-cta" onClick={copySegmentLink}>선택 구간 YouTube 주소 복사</button>
            <button className="outline-cta" onClick={createSocialPack} disabled={socialLoading}>{socialLoading ? '게시 문구 생성 중…' : 'AI 제목 · 설명 · 태그 만들기'}</button>
          </div>
        </div>

        {social && <div className="social-box">
          <div className="social-head"><div><span className="eyebrow">SNS 게시 패키지</span><h3>그대로 복사해 사용할 수 있습니다</h3></div></div>
          <div className="social-section">
            <h4>추천 제목 5개</h4>
            <div className="title-options">{social.titleOptions?.map((t, i)=><button key={i} onClick={()=>copy(t)}>{i+1}. {t}<small>복사</small></button>)}</div>
          </div>
          <div className="social-section two-col">
            <div><h4>썸네일 문구</h4><button className="copy-card" onClick={()=>copy(social.thumbnailText)}>{social.thumbnailText}<small>복사</small></button></div>
            <div><h4>첫 화면 문구</h4><button className="copy-card" onClick={()=>copy(social.openingCaption)}>{social.openingCaption}<small>복사</small></button></div>
          </div>
          <div className="social-section"><h4>설명</h4><button className="copy-card left" onClick={()=>copy(social.description)}>{social.description}<small>복사</small></button></div>
          <div className="social-section"><h4>해시태그</h4><button className="copy-card left" onClick={()=>copy((social.hashtags || []).join(' '))}>{(social.hashtags || []).join(' ')}<small>복사</small></button></div>
        </div>}

        <div className="render-panel">
          <div className="render-top"><div><span className="eyebrow">무료 편집 자료</span><h3>자막과 AI 음성을 바로 만듭니다</h3></div></div>
          <div className="free-editor">
            <div className="editor-actions">
              <button className="outline-cta" onClick={prepareCaptions} disabled={captionLoading}>{captionLoading ? '선택 구간 듣는 중…' : transcript.length ? '✓ 자막 준비됨' : '1. 선택 구간 자막 만들기'}</button>
              <button className="outline-cta" onClick={downloadSrt} disabled={captionLoading}>{captionLoading ? '자막 준비 중…' : 'SRT 자막 다운로드'}</button>
            </div>

            {transcript.length > 0 && <>
              <div className="transcript-preview">
                <strong>AI가 들은 원문</strong>
                <p>{transcript.map(x=>x.text).join(' ')}</p>
              </div>
              <label className="editor-label">AI 음성이 읽을 문장</label>
              <textarea className="narration" value={narrationText} onChange={(e)=>setNarrationText(e.target.value)} />

              <div className="voice-row">
                <div>
                  <label className="editor-label">AI 음성</label>
                  <select value={voice} onChange={(e)=>setVoice(e.target.value)}>
                    {voices.map(v => <option key={v.id} value={v.id}>{v.label} · {v.id}</option>)}
                  </select>
                </div>
                <button className="cta compact" onClick={createVoice} disabled={voiceLoading || !narrationText.trim()}>{voiceLoading ? 'AI 음성 생성 중…' : '2. AI 음성 만들기'}</button>
              </div>
            </>}

            {voiceUrl && <div className="audio-card">
              <strong>AI 음성 완성</strong>
              <audio controls src={voiceUrl}/>
              <button className="outline-cta" onClick={downloadVoice}>WAV 음성 다운로드</button>
              <p>이 WAV와 SRT를 CapCut·Premiere 등 무료/보유 편집기에 넣으면 원본 영상 대신 AI 음성을 사용하는 쇼츠로 편집할 수 있습니다.</p>
            </div>}
          </div>
        </div>
      </section>}

      <footer>무료판은 Gemini 무료 등급의 범위 안에서 분석·텍스트·자막·TTS를 사용하도록 구성했습니다.</footer>
    </main>
  );
}
