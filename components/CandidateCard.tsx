'use client';

import { secondsToClock } from '@/lib/youtube';

export type Candidate = {
  id: number;
  title: string;
  start: number;
  end: number;
  hook: string;
  reason: string;
  summary: string;
  hookScore: number;
  messageScore: number;
  viewScore?: number;
};

function Stars({ value }: { value: number }) {
  const safe = Math.min(5, Math.max(0, Math.round(value || 0)));
  return <span className="stars">{'★'.repeat(safe)}{'☆'.repeat(Math.max(0, 5 - safe))}</span>;
}

export default function CandidateCard({
  candidate,
  videoId,
  selected,
  onSelect
}: {
  candidate: Candidate;
  videoId: string;
  selected?: boolean;
  onSelect: (candidate: Candidate) => void;
}) {
  const preview = `https://www.youtube.com/watch?v=${videoId}&t=${candidate.start}s`;
  return (
    <article className={selected ? 'candidate-card selected' : 'candidate-card'}>
      <div className="candidate-head">
        <div className="candidate-index">{candidate.id}</div>
        <div>
          <h3>{candidate.title}</h3>
          <p className="time">{secondsToClock(candidate.start)} – {secondsToClock(candidate.end)} · {candidate.end - candidate.start}초</p>
        </div>
      </div>
      <div className="hook">“{candidate.hook}”</div>
      <p className="summary">{candidate.summary}</p>
      <p className="reason">{candidate.reason}</p>
      <div className="scores">
        <span>후킹 <Stars value={candidate.hookScore} /></span>
        <span>메시지 <Stars value={candidate.messageScore} /></span>
        <span>조회 가능성 <Stars value={candidate.viewScore || 3} /></span>
      </div>
      <div className="candidate-actions">
        <a className="secondary-btn" href={preview} target="_blank" rel="noreferrer">원본에서 보기</a>
        <button className="primary-small" onClick={() => onSelect(candidate)}>
          {selected ? '선택됨' : '이 구간으로 제작'}
        </button>
      </div>
    </article>
  );
}
