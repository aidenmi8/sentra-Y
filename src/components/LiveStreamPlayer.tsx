'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';

export type LiveFeedMode = 'iframe' | 'hls' | 'video' | 'external';

interface LiveStreamPlayerProps {
  url: string;
  title: string;
  mode: LiveFeedMode;
  externalUrl: string;
}

export default function LiveStreamPlayer({ url, title, mode, externalUrl }: LiveStreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'hls' && mode !== 'video') return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let hlsInstance: { destroy: () => void } | null = null;
    setError(null);
    video.removeAttribute('src');
    video.load();

    if (mode === 'video') {
      video.src = url;
      video.load();
      return () => {
        video.removeAttribute('src');
        video.load();
      };
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.load();
      return () => {
        video.removeAttribute('src');
        video.load();
      };
    }

    import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setError('HLS playback is not supported in this browser.');
          return;
        }
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90,
        });
        hlsInstance = hls;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data?.fatal) setError('The stream is blocked, expired, or unavailable.');
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      })
      .catch(() => setError('Unable to load the HLS player.'));

    return () => {
      cancelled = true;
      hlsInstance?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [mode, url]);

  if (mode === 'iframe') {
    return (
      <div className="w-full aspect-video relative bg-black">
        <iframe
          title={title}
          src={url}
          className="w-full h-full absolute inset-0"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      </div>
    );
  }

  if (mode === 'external') {
    return <ExternalFallback title={title} externalUrl={externalUrl} reason="DIRECT STREAM" />;
  }

  return (
    <div className="w-full aspect-video relative bg-black">
      <video
        ref={videoRef}
        className="w-full h-full absolute inset-0 bg-black"
        controls
        autoPlay
        muted
        playsInline
      />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90">
          <div className="text-center px-8">
            <AlertTriangle className="w-8 h-8 text-[var(--gold-primary)] mx-auto mb-3" />
            <p className="text-[12px] font-mono font-bold text-white tracking-widest mb-2">STREAM UNAVAILABLE</p>
            <p className="text-[11px] font-mono text-white/50 mb-5 max-w-xs">{error}</p>
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2 rounded border border-[#39FF14]/40 text-[#39FF14] font-mono text-[11px] hover:bg-[#39FF14]/10 transition-colors tracking-wider"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              OPEN STREAM
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function ExternalFallback({ title, externalUrl, reason }: { title: string; externalUrl: string; reason: string }) {
  return (
    <div className="w-full aspect-video flex items-center justify-center bg-black/95">
      <div className="text-center px-8">
        <div className="w-14 h-14 rounded-full bg-[#39FF14]/10 border border-[#39FF14]/20 flex items-center justify-center mx-auto mb-4">
          <ExternalLink className="w-6 h-6 text-[#39FF14]" />
        </div>
        <p className="text-[13px] font-mono font-bold text-white tracking-widest mb-2">{reason}</p>
        <p className="text-[11px] font-mono text-white/50 mb-6 max-w-xs">
          {title} cannot be embedded directly. Open the stream externally.
        </p>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded border border-[#39FF14]/40 text-[#39FF14] font-mono text-[12px] hover:bg-[#39FF14]/10 transition-colors tracking-wider"
        >
          <ExternalLink className="w-4 h-4" />
          OPEN STREAM
        </a>
      </div>
    </div>
  );
}
