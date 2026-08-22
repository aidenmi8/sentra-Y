'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, RefreshCw, MapPin, Camera, Maximize2, Play } from 'lucide-react';
import Hls from 'hls.js';

interface CameraViewerProps {
  camera: any | null;
  onClose: () => void;
  onLocate?: (lat: number, lng: number) => void;
}

function isFl511Camera(camera: any): boolean {
  if (!camera) return false;
  if (camera.source === 'FDOT FL511') return true;
  return String(camera.id || '').startsWith('fl511-');
}

export default function CameraViewer({ camera, onClose, onLocate }: CameraViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hlsFailed, setHlsFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [fl511ProxyUrl, setFl511ProxyUrl] = useState<string | null>(null);
  const [fl511Resolving, setFl511Resolving] = useState(false);
  const [fl511LiveError, setFl511LiveError] = useState(false);
  const [fl511Retry, setFl511Retry] = useState(0);
  const [videoNode, setVideoNode] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date();
      setCurrentTime(now.toISOString().split('T')[1].slice(0, 8) + 'Z');
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // A previous camera's dead stream must not mark the next one as failed.
  useEffect(() => {
    setHlsFailed(false);
    setFl511ProxyUrl(null);
    setFl511LiveError(false);
    setFl511Resolving(false);
  }, [camera?.id]);

  const camId = camera ? `CAM-${Math.abs(camera.lat * 10000).toFixed(0).padStart(4, '0').slice(-4)}-${Math.abs(camera.lng * 10000).toFixed(0).padStart(4, '0').slice(-4)}` : 'UNKNOWN';

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const fl511 = isFl511Camera(camera);
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    setVideoNode(el);
  }, []);

  useEffect(() => {
    if (!camera || !fl511) return;
    let cancelled = false;
    setFl511Resolving(true);
    setFl511LiveError(false);
    const params = new URLSearchParams({ id: String(camera.id) });
    if (camera.video_url) params.set('videoUrl', String(camera.video_url));
    if (camera.feed_url) params.set('feedUrl', String(camera.feed_url));
    if (camera.name) params.set('name', String(camera.name));
    fetch(`/api/cctv/fl511-live?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.proxy_url) throw new Error(data.error || 'FL511 live stream unavailable');
        return data.proxy_url as string;
      })
      .then((url) => {
        if (cancelled) return;
        setFl511ProxyUrl(url);
        setFl511Resolving(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFl511LiveError(true);
        setFl511Resolving(false);
      });
    return () => { cancelled = true; };
  }, [camera?.id, fl511, fl511Retry]);

  const resolvedStreamUrl = fl511ProxyUrl || camera?.stream_url;
  const rawStreamType = fl511ProxyUrl ? 'hls' : (camera?.stream_type || 'jpg');
  // A camera whose HLS died is rendered as its still image instead.
  const streamType = hlsFailed ? 'jpg' : rawStreamType;
  const externalFeedUrl = camera?.external_url || camera?.feed_url;
  const externalOnly = Boolean(camera?.external_url && !camera?.feed_url && !camera?.stream_url && !fl511ProxyUrl);

  useEffect(() => {
    if (!camera) return;
    setError(false);

    if (externalOnly) {
      setLoading(false);
      return;
    }

    if ((streamType === 'iframe' || streamType === 'mp4') && camera.stream_url) {
      setLoading(false);
      return;
    }

    if (camera.feed_url) {
      const url = camera.feed_url.includes('?') ? `${camera.feed_url}&_t=${Date.now()}` : `${camera.feed_url}?_t=${Date.now()}`;
      setImageUrl(url);
      // Still is the poster while FL511 HLS is minting/attaching.
      setLoading(streamType === 'hls');
      return;
    }

    if (streamType === 'hls' && resolvedStreamUrl) return;

    setError(true);
    setLoading(false);
  }, [camera, refreshKey, streamType, externalOnly, resolvedStreamUrl]);

  useEffect(() => {
    if (streamType !== 'hls' || !resolvedStreamUrl || !videoNode) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false });
      hlsRef.current = hls;
      hls.loadSource(resolvedStreamUrl);
      hls.attachMedia(videoNode);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        videoNode.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        hls.destroy();
        hlsRef.current = null;
        if (camera?.feed_url) {
          setHlsFailed(true);
          setLoading(false);
        } else {
          setError(true);
        }
      });
      return () => {
        hls.destroy();
        if (hlsRef.current === hls) hlsRef.current = null;
      };
    }

    if (videoNode.canPlayType('application/vnd.apple.mpegurl')) {
      videoNode.src = resolvedStreamUrl;
      const onLoaded = () => {
        setLoading(false);
        videoNode.play().catch(() => {});
      };
      videoNode.addEventListener('loadedmetadata', onLoaded);
      return () => videoNode.removeEventListener('loadedmetadata', onLoaded);
    }

    if (camera?.feed_url) {
      setHlsFailed(true);
      setLoading(false);
    } else {
      setError(true);
    }
  }, [streamType, resolvedStreamUrl, videoNode, camera?.feed_url]);

  // Auto-refresh for JPGs.
  // Providers publish very different cadences — FDOT snapshots only change once
  // a minute (their own player uses data-refresh-rate="60000"), so polling every
  // 5s was 12 identical fetches per new frame. A camera can declare its own rate.
  useEffect(() => {
    if (streamType !== 'jpg' || !camera?.feed_url) return;
    const intervalMs = Math.max(2000, Number(camera.refresh_ms) || 5000);
    const iv = setInterval(() => setRefreshKey(k => k + 1), intervalMs);
    return () => clearInterval(iv);
  }, [camera?.feed_url, camera?.refresh_ms, streamType]);

  if (!camera) return null;

  return (
    <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.3, type: "spring", bounce: 0 }}
          className={`fixed z-[500] ${
            fullscreen 
              ? 'inset-2 md:inset-4' 
              : 'bottom-[70px] left-2 right-2 md:bottom-6 md:right-6 md:left-auto md:w-[480px]'
          }`}
        >
          <div className="overflow-hidden h-full flex flex-col bg-black/85 backdrop-blur-xl border border-[var(--border-primary)]" style={{ boxShadow: '0 20px 50px rgba(0,0,0,0.9), inset 0 0 30px rgba(0,0,0,0.8)' }}>
            
            {/* Tactical Grid Overlay on background */}
            <div className="absolute inset-0 pointer-events-none opacity-20" style={{
              backgroundImage: 'linear-gradient(var(--border-secondary) 1px, transparent 1px), linear-gradient(90deg, var(--border-secondary) 1px, transparent 1px)',
              backgroundSize: '20px 20px'
            }} />

            {/* Tactical Header */}
            <div className="flex flex-col border-b border-[var(--border-primary)] bg-black/60 relative z-10">
              {/* Top Meta Bar */}
              <div className="flex items-center justify-between px-3 py-1 border-b border-white/5 text-[7px] font-mono tracking-[0.2em] text-[var(--text-muted)] bg-[var(--hover-accent)]">
                <div className="flex items-center gap-3">
                  <span className="text-[var(--gold-primary)] font-bold">{camId}</span>
                  <span>{camera.lat?.toFixed(4)}, {camera.lng?.toFixed(4)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span>{currentTime}</span>
                  <span className="text-[var(--gold-primary)]">SECURE UPLINK</span>
                </div>
              </div>

              {/* Main Title Bar */}
              <div className="flex items-center justify-between px-3 md:px-4 py-2 md:py-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="relative flex items-center justify-center w-6 h-6 border border-[var(--gold-primary)] bg-[var(--gold-primary)]/10 rounded-sm">
                    <Camera className="w-3.5 h-3.5 text-[var(--gold-primary)]" />
                    <div className="absolute top-0 left-0 w-1 h-1 border-t border-l border-[var(--gold-primary)]" />
                    <div className="absolute bottom-0 right-0 w-1 h-1 border-b border-r border-[var(--gold-primary)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[12px] md:text-[13px] font-mono font-bold tracking-widest truncate text-white uppercase" style={{ textShadow: '0 0 10px rgba(255,255,255,0.3)' }}>{camera.name}</h3>
                    <p className="text-[7px] md:text-[8px] font-mono text-[var(--gold-primary)] uppercase tracking-wider opacity-80">{camera.city}, {camera.country} • SOURCE: {camera.source}</p>
                  </div>
                </div>
                
                {/* Controls */}
                <div className="flex items-center gap-1 flex-shrink-0 ml-3">
                  {streamType === 'jpg' && (
                    <button onClick={() => setRefreshKey(k => k + 1)} className="p-1.5 rounded-sm bg-white/5 border border-white/10 hover:bg-[var(--gold-primary)]/20 hover:border-[var(--gold-primary)] transition-all" title="Refresh feed">
                      <RefreshCw className="w-3 h-3 text-[var(--text-secondary)] hover:text-[var(--gold-primary)]" />
                    </button>
                  )}
                  {camera.lat && camera.lng && (
                    <button onClick={() => onLocate?.(camera.lat, camera.lng)} className="p-1.5 rounded-sm bg-white/5 border border-white/10 hover:bg-[var(--gold-primary)]/20 hover:border-[var(--gold-primary)] transition-all" title="Fly to location">
                      <MapPin className="w-3 h-3 text-[var(--text-secondary)] hover:text-[var(--gold-primary)]" />
                    </button>
                  )}
                  <button onClick={() => setFullscreen(!fullscreen)} className="hidden md:block p-1.5 rounded-sm bg-white/5 border border-white/10 hover:bg-[var(--text-primary)]/20 hover:border-[var(--text-primary)] transition-all" title="Toggle fullscreen">
                    <Maximize2 className="w-3 h-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" />
                  </button>
                  <button onClick={onClose} className="p-1.5 rounded-sm bg-red-900/30 border border-red-500/30 hover:bg-red-500/30 hover:border-red-500 transition-all ml-2">
                    <X className="w-4 h-4 md:w-3 md:h-3 text-red-400 hover:text-red-200" />
                  </button>
                </div>
              </div>
            </div>

          {/* Camera Feed */}
          <div className={`relative bg-[#020202] ${fullscreen ? 'flex-1' : 'aspect-video max-h-[35vh] md:max-h-none'}`}>
            {/* Tactical CRT Overlay */}
            <div className="absolute inset-0 pointer-events-none z-20" style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.02) 2px, rgba(255,255,255,0.02) 2px)',
              backgroundSize: '100% 4px',
            }} />
            <div className="absolute inset-0 pointer-events-none z-20 shadow-[inset_0_0_50px_rgba(0,0,0,0.8)]" />

            {loading && !error && !externalOnly && !imageUrl && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-30 backdrop-blur-sm">
                <div className="text-center">
                  <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--gold-dim)', borderTopColor: 'transparent' }} />
                  <span className="text-[9px] font-mono tracking-[0.25em]" style={{ color: 'var(--gold-primary)' }}>DECRYPTING FEED...</span>
                </div>
              </div>
            )}

            {externalOnly ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-30 backdrop-blur-sm p-4 text-center">
                <ExternalLink className="w-6 h-6 mb-3 opacity-50" style={{ color: 'var(--gold-primary)' }} />
                <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: 'var(--gold-primary)' }}>SECURE FEED ENCRYPTED</p>
                <p className="text-[8px] font-mono text-[var(--text-muted)] mt-2 max-w-[80%] uppercase">This feed requires external clearance</p>
                <a 
                  href={externalFeedUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="mt-4 px-4 py-2 rounded text-[9px] font-mono font-bold tracking-widest transition-all hover:bg-white/10"
                  style={{ border: '1px solid var(--border-primary)', color: 'var(--gold-primary)' }}
                >
                  ACCESS TERMINAL
                </a>
              </div>
            ) : error ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/90">
                <div className="text-center">
                  <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center mb-2 mx-auto"><Camera className="w-4 h-4 text-red-400" /></div>
                  <span className="text-[9px] font-mono text-red-400 tracking-widest block mb-1">FEED UNAVAILABLE</span>
                  <span className="text-[7px] font-mono text-[var(--text-muted)]">Camera may be offline or restricted</span>
                  <button onClick={() => { setError(false); setRefreshKey(k => k + 1); }} className="block mx-auto mt-3 px-3 py-1 text-[8px] font-mono text-[#7E57C2] border border-[#7E57C2]/30 rounded hover:bg-[#7E57C2]/10 transition-colors tracking-wider">
                    RETRY
                  </button>
                </div>
              </div>
            ) : streamType === 'hls' ? (
              <>
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt=""
                    className={`absolute inset-0 w-full ${fullscreen ? 'h-full object-contain' : 'h-full object-cover'} ${loading ? 'opacity-100' : 'opacity-0'} pointer-events-none`}
                  />
                )}
                <video
                  ref={setVideoRef}
                  className={`w-full ${fullscreen ? 'h-full object-contain' : 'h-full object-cover'} ${loading ? 'opacity-0' : 'opacity-100'}`}
                  autoPlay
                  muted
                  playsInline
                />
              </>
            ) : streamType === 'mp4' && camera.stream_url ? (
              <video
                src={camera.stream_url}
                className={`w-full ${fullscreen ? 'h-full object-contain' : 'h-full object-cover'}`}
                autoPlay
                muted
                playsInline
                loop
              />
            ) : streamType === 'iframe' && camera.stream_url ? (
              <iframe
                src={camera.stream_url}
                className="w-full h-full border-0"
                allow="autoplay; fullscreen"
                allowFullScreen
              />
            ) : imageUrl ? (
              <img
                key={refreshKey}
                src={imageUrl}
                alt={camera.name}
                className={`w-full ${fullscreen ? 'h-full object-contain' : 'h-full object-cover'}`}
                onLoad={() => setLoading(false)}
                onError={() => { setLoading(false); setError(true); }}
              />
            ) : null}

            {/* Live indicator */}
            {!error && !loading && !externalOnly && (
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/80 border border-[var(--gold-primary)]/50 px-2 py-1 shadow-[0_0_10px_rgba(0,0,0,0.8)]">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_#ef4444]" />
                <span className="text-[8px] font-mono text-white tracking-[0.2em]">
                  {streamType === 'hls' && !loading ? 'LIVE VIDEO' : streamType === 'jpg' ? (fl511Resolving ? 'STILL · STARTING VIDEO' : 'LIVE SAT-LINK') : 'LIVE FEED'}
                </span>
              </div>
            )}

            {/* Tactical Crosshairs */}
            <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
              <div className="w-[80%] h-[1px] bg-white/5 absolute top-1/2 -translate-y-1/2" />
              <div className="h-[80%] w-[1px] bg-white/5 absolute left-1/2 -translate-x-1/2" />
              <div className="w-16 h-16 border border-white/10 rounded-full" />
              <div className="w-1 h-1 bg-[var(--gold-primary)]/50 absolute" />
            </div>
          </div>

          {/* Advanced Tactical Footer */}
          <div className="bg-black border-t border-[var(--border-primary)] relative z-10">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
              <div className="flex gap-4">
                <div className="flex flex-col">
                  <span className="text-[6px] text-[var(--text-muted)] font-mono tracking-widest">FEED TYPE</span>
                  <span className="text-[8px] text-white font-mono tracking-widest uppercase">{streamType}</span>
                </div>
                <div className="flex flex-col border-l border-white/10 pl-4">
                  <span className="text-[6px] text-[var(--text-muted)] font-mono tracking-widest">STATUS</span>
                  <span className="text-[8px] text-[var(--alert-green)] font-mono tracking-widest">ACTIVE / RECORDING</span>
                </div>
              </div>
              <div className="flex gap-3">
                {fl511 && !(streamType === 'hls' && !loading && !hlsFailed && !fl511LiveError) && (
                  <button onClick={() => {
                    setHlsFailed(false);
                    setFl511ProxyUrl(null);
                    setFl511Retry((n) => n + 1);
                  }}
                    title="Play the live FDOT stream in this viewer."
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--alert-green)]/15 hover:bg-[var(--alert-green)]/25 border border-[var(--alert-green)]/50 transition-colors text-[8px] font-mono text-[var(--alert-green)] tracking-widest font-bold">
                    <Play className="w-2.5 h-2.5" /> SHOW VIDEO
                  </button>
                )}
                {(camera.feed_url || camera.external_url || (streamType === 'iframe' && camera.stream_url)) && (
                  <a href={camera.external_url || camera.feed_url || (streamType === 'iframe' ? camera.stream_url : undefined)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-[8px] font-mono text-[var(--gold-primary)] tracking-widest">
                    <ExternalLink className="w-2.5 h-2.5" /> RAW FEED
                  </a>
                )}
                <a href={`https://www.google.com/maps/@${camera.lat},${camera.lng},17z`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-[8px] font-mono text-[var(--cyan-primary)] tracking-widest">
                  <MapPin className="w-2.5 h-2.5" /> MAP TARGET
                </a>
              </div>
            </div>
            {/* Animated data stream bar */}
            <div className="h-[2px] w-full bg-[var(--border-primary)] overflow-hidden relative">
              <div className="absolute top-0 bottom-0 left-0 bg-[var(--gold-primary)] shadow-[0_0_8px_var(--gold-primary)] w-1/3 animate-pulse" style={{ animation: 'progress-glow-slide 2s cubic-bezier(0.4, 0, 0.2, 1) infinite' }} />
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
