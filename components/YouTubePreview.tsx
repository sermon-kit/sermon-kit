'use client';

import type { Candidate } from './CandidateCard';

export default function YouTubePreview({ videoId, candidate }: { videoId: string; candidate: Candidate }) {
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?start=${candidate.start}&end=${candidate.end}&rel=0&modestbranding=1`;
  return (
    <div className="preview-wrap">
      <iframe
        src={src}
        title={`${candidate.title} 미리보기`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}
