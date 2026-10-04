'use client';

import { useEffect, useMemo, useState } from 'react';
import CandidateCard, { Candidate } from '@/components/CandidateCard';
import YouTubePreview from '@/components/YouTubePreview';
import { secondsToClock } from '@/lib/youtube';

const durations = [30, 60, 180];

type SocialPack = {
  titleOptions: string[];
  description: string;
  hashtags: string[];
  thumbnailText: string;
  openingCaption: string;
};

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [duration, setDuration] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoId, setVideoId] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [transcript, setTranscript] = useState<Array<{start:number;duration:number;text:string}>>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [sourceVideo, setSourceVideo] = useState<File | null>(null);
  const [rendering, setRendering] = useState(false);
  const [socialLoading, setSocialLoading] = useState(false);
  const [social, setSocial] = useState<SocialPack | null>(null);
  const [layout, setLayout] = useState<'blur'|'crop'>('blur');

  useEffect(() => {
    const saved = localStorage.getItem('sermon-shorts-gemini-key');
    if (saved) setApiKey(saved);
  }, []);

  useEffect(() => {
    if (apiKey) localStorage.setItem('sermon-shorts-gemini-key', apiKey);
  }, [apiKey]);

  const canAnalyze = useMemo(() => apiKey.trim() && youtubeUrl.trim(), [apiKey, youtubeUrl]);

  function chooseCandidate(candidate: Candidate) {
    setSelected(candidate);
    setSocial(null);
    setTimeout(() => document.getElementById('studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  async function analyze() {
    setLoading(true); setError(''); setCandidates([]); setSelected(null); setSocial(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), youtubeUrl: youtubeUrl.trim(), duration })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '분석에 실패했습니다.');
      setVideoId(data.videoId);
      setTranscript(data.transcript || []);
      setCandidates(data.candidates || []);
    } catch (e: any) {
      setError(e.message || '오류가 발생했습니다.');
    } finally { setLoading(false); }
  }

  async function createSocialPack() {
    if (!selected) return;
    setSocialLoading(true); setError('');
    try {
      const res = await fetch('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), candidate: selected, transcript })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'SNS 문구 생성에 실패했습니다.');
      setSocial(data);
    } catch (e: any) {
      setError(e.message || 'SNS 문구 생성 오류가 발생했습니다.');
    } finally { setSocialLoading(false); }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
  }

  async function renderSelected() {
    if (!selected || !sourceVideo) return;
    const worker = process.env.NEXT_PUBLIC_RENDER_WORKER_URL;
    if (!worker) {
      setError('렌더 워커 주소가 설정되지 않았습니다. README의 NEXT_PUBLIC_RENDER_WORKER_URL 설정을 확인해 주세요.');
      return;
    }
    setRendering(true); setError('');
    try {
      const form = new FormData();
      form.append('video', sourceVideo);
      form.append('start', String(selected.start));
      form.append('end', String(selected.end));
      form.append('title', selected.title);
      form.append('hook', social?.openingCaption || selected.hook);
      form.append('layout', layout);
      form.append('transcript', JSON.stringify(transcript));
      const res = await fetch(`${worker.replace(/\/$/, '')}/render`, { method: 'POST', body: form });
      if (!res.ok) {
        let message = '영상 렌더링에 실패했습니다.';
        try { const detail = await res.json(); message = detail?.error || message; } catch {}
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sermon-short-${selected.id}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || '렌더링 오류가 발생했습니다.');
    } finally { setRendering(false); }
  }

  return (
    <main>
      <section className="hero">
        <div className="badge">✦ AI 설교 미디어 도구</div>
        <h1>설교 한 편에서<br/><em>사람들이 멈춰 볼 1분을</em></h1>
        <p>설교 유튜브 링크를 넣으면 AI가 핵심 구간 5개를 찾고,<br className="desktop"/> 선택한 구간을 자막이 들어간 세로 쇼츠로 만듭니다.</p>
      </section>

      <section className="panel">
        <div className="step">
          <div className="number">1</div>
          <div className="step-body">
            <div className="label-row"><label>Gemini API 키</label><span className="saved">✓ 브라우저 저장</span></div>
            <div className="input-wrap"><span>🔑</span><input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e)=>setApiKey(e.target.value)} placeholder="AIza..."/><button onClick={()=>setShowKey(v=>!v)}>{showKey ? '숨김' : '보기'}</button></div>
            <p className="hint">개인용 MVP 구조입니다. API 키는 브라우저에 저장되고 분석 요청 때만 사용됩니다.</p>
          </div>
        </div>

        <div className="step">
          <div className="number">2</div>
          <div className="step-body">
            <label>설교 유튜브 링크</label>
            <div className="input-wrap"><span>🔗</span><input value={youtubeUrl} onChange={(e)=>setYoutubeUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..."/></div>
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
            <div className="mini-note">선택 구간 미리보기입니다. 실제 MP4 렌더링은 아래에서 원본 영상을 업로드해 진행합니다.</div>
          </div>

          <div className="studio-side">
            <div className="info-card">
              <span className="eyebrow">첫 3초</span>
              <strong>{social?.openingCaption || selected.hook}</strong>
              <p>{selected.summary}</p>
            </div>

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
          <div className="render-top">
            <div><span className="eyebrow">MP4 렌더링</span><h3>원본 설교 영상으로 세로 쇼츠 만들기</h3></div>
          </div>

          <div className="upload-box">
            <strong>원본 설교 MP4 업로드</strong>
            <p>YouTube 영상을 임의 다운로드하지 않고, 사용 권한이 있는 원본 파일을 이용합니다.</p>
            <input type="file" accept="video/mp4,video/quicktime,video/x-m4v" onChange={(e)=>setSourceVideo(e.target.files?.[0] || null)} />

            <div className="layout-pick">
              <span>세로 화면 방식</span>
              <button className={layout==='blur'?'active':''} onClick={()=>setLayout('blur')}><b>추천</b> 원본 유지 + 흐린 배경</button>
              <button className={layout==='crop'?'active':''} onClick={()=>setLayout('crop')}>화면 꽉 채우기</button>
            </div>

            <button className="cta" disabled={!sourceVideo || rendering} onClick={renderSelected}>{rendering ? '9:16 MP4 렌더링 중…' : '9:16 자막 쇼츠 MP4 만들기'}</button>
          </div>
        </div>
      </section>}

      <footer>설교자의 원래 의미를 보존하고, 사용자가 최종 구간을 선택하는 구조입니다.</footer>
    </main>
  );
}
