'use client';

import { useMemo, useState, memo } from 'react';
import { motion } from 'framer-motion';
import { Camera, MapPin, Play, Search, RefreshCw, X, Globe2, CameraOff } from 'lucide-react';
import type { CameraRecord } from '@/lib/cameras/types';

interface CameraBrowserProps {
  cameras: CameraRecord[];
  loading?: boolean;
  error?: string | null;
  onSelect: (camera: CameraRecord) => void;
  onLocate: (lat: number, lng: number) => void;
  onClose?: () => void;
  onRefresh?: () => void;
}

type KindFilter = 'all' | 'stream' | 'location';

/**
 * Worldwide camera browser.
 *
 * The visual distinction between a watchable feed and a mapped position is the
 * load-bearing part of this component: OpenStreetMap contributes camera
 * locations with no video, and presenting those as playable would promise
 * something that does not exist.
 */
function CameraBrowser({ cameras, loading, error, onSelect, onLocate, onClose, onRefresh }: CameraBrowserProps) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [provider, setProvider] = useState<string>('all');
  const [failedThumbs, setFailedThumbs] = useState<Record<string, boolean>>({});

  const providers = useMemo(() => {
    const names = new Set<string>();
    for (const c of cameras) names.add(c.provider_label);
    return [...names].sort();
  }, [cameras]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cameras.filter((c) => {
      if (kind !== 'all' && c.kind !== kind) return false;
      if (provider !== 'all' && c.provider_label !== provider) return false;
      if (!q) return true;
      return `${c.name} ${c.city ?? ''} ${c.country ?? ''} ${c.operator ?? ''}`.toLowerCase().includes(q);
    });
  }, [cameras, query, kind, provider]);

  const watchable = useMemo(() => cameras.filter((c) => c.kind === 'stream').length, [cameras]);
  const attributions = useMemo(() => [...new Set(filtered.map((c) => c.attribution))], [filtered]);

  return (
    <div className="glass-panel flex flex-col overflow-hidden" style={{ borderRadius: 20 }}>
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
        <Globe2 className="w-4 h-4 text-[var(--gold-primary)] shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="hud-text text-[11px] text-[var(--text-primary)]">WORLDWIDE CAMERAS</h2>
          <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
            {cameras.length.toLocaleString()} in view · {watchable.toLocaleString()} watchable
          </p>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            aria-label="Reload cameras for this area"
            className="p-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--gold-primary)] hover:border-[rgba(var(--gold-rgb),0.4)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold-primary)]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close camera browser"
            className="p-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--alert-red)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--alert-red)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </header>

      <div className="px-4 py-3 flex flex-col gap-2.5 border-b border-[var(--border-subtle)]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, city, country, operator"
            aria-label="Search cameras"
            className="w-full bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl pl-9 pr-3 py-2 text-[11px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[rgba(var(--gold-rgb),0.45)] transition-colors"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([['all', 'All'], ['stream', 'Watchable'], ['location', 'Position only']] as const).map(([value, label]) => (
            <Chip key={value} active={kind === value} onClick={() => setKind(value)} label={label} />
          ))}
          {providers.length > 1 && (
            <>
              <span className="w-px self-stretch bg-[var(--border-subtle)] mx-1" aria-hidden="true" />
              <Chip active={provider === 'all'} onClick={() => setProvider('all')} label="Any source" />
              {providers.map((p) => (
                <Chip key={p} active={provider === p} onClick={() => setProvider(p)} label={p} />
              ))}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto styled-scrollbar px-4 py-3">
        {error && (
          <div className="rounded-2xl border border-[rgba(var(--alert-red-rgb),0.3)] bg-[rgba(var(--alert-red-rgb),0.08)] px-3 py-2.5">
            <p className="text-[11px] font-mono text-[var(--alert-red)]">{error}</p>
          </div>
        )}

        {loading && cameras.length === 0 && (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--surface-1)]">
                <div className="aspect-video skeleton-shimmer" />
                <div className="p-3 space-y-2">
                  <div className="h-2.5 w-3/4 rounded-full bg-[var(--surface-3)]" />
                  <div className="h-2 w-1/2 rounded-full bg-[var(--surface-2)]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-10">
            <CameraOff className="w-7 h-7 mx-auto mb-3 text-[var(--text-muted)]" />
            <p className="text-[11px] font-mono text-[var(--text-secondary)]">
              {cameras.length === 0 ? 'No cameras in this area — pan or zoom the map.' : 'No cameras match those filters.'}
            </p>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {filtered.slice(0, 300).map((cam) => (
              <CameraCard
                key={cam.id}
                camera={cam}
                thumbFailed={!!failedThumbs[cam.id]}
                onThumbError={() => setFailedThumbs((f) => ({ ...f, [cam.id]: true }))}
                onSelect={onSelect}
                onLocate={onLocate}
              />
            ))}
          </div>
        )}

        {filtered.length > 300 && (
          <p className="text-[10px] font-mono text-[var(--text-muted)] text-center mt-3">
            Showing 300 of {filtered.length.toLocaleString()} — narrow the search or zoom in.
          </p>
        )}
      </div>

      {attributions.length > 0 && (
        <footer className="px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-0)]">
          <p className="text-[9px] font-mono text-[var(--text-muted)] leading-relaxed">
            {attributions.join(' · ')}
          </p>
        </footer>
      )}
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="px-2.5 py-1 rounded-full text-[9px] font-mono uppercase tracking-wider border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold-primary)]"
      style={{
        borderColor: active ? 'rgba(var(--gold-rgb), 0.5)' : 'var(--border-subtle)',
        background: active ? 'rgba(var(--gold-rgb), 0.12)' : 'transparent',
        color: active ? 'var(--gold-primary)' : 'var(--text-secondary)',
      }}
    >
      {label}
    </button>
  );
}

const CameraCard = memo(function CameraCard({
  camera, thumbFailed, onThumbError, onSelect, onLocate,
}: {
  camera: CameraRecord;
  thumbFailed: boolean;
  onThumbError: () => void;
  onSelect: (c: CameraRecord) => void;
  onLocate: (lat: number, lng: number) => void;
}) {
  const watchable = camera.kind === 'stream';
  const showThumb = !!camera.preview_url && !thumbFailed;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className="rounded-2xl overflow-hidden border bg-[var(--surface-1)] flex flex-col"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <button
        onClick={() => (watchable ? onSelect(camera) : onLocate(camera.lat, camera.lng))}
        aria-label={watchable ? `Watch ${camera.name}` : `Locate ${camera.name} on the map`}
        className="relative aspect-video w-full bg-[var(--surface-0)] overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold-primary)]"
      >
        {showThumb ? (
          <img
            src={camera.preview_url as string}
            alt={camera.name}
            loading="lazy"
            onError={onThumbError}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
            {watchable
              ? <Camera className="w-5 h-5 text-[var(--text-muted)]" />
              : <MapPin className="w-5 h-5 text-[var(--cyan-primary)]" />}
            <span className="text-[8px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
              {watchable ? 'no preview' : 'mapped position'}
            </span>
          </div>
        )}

        {/* A play affordance appears only where there is something to play. */}
        {watchable && (
          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--scrim-strong)]">
            <Play className="w-7 h-7 text-[var(--text-primary)]" />
          </span>
        )}

        <span
          className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[8px] font-mono uppercase tracking-wider border"
          style={
            watchable
              ? { color: 'var(--alert-green)', borderColor: 'rgba(var(--alert-green-rgb), 0.4)', background: 'rgba(var(--alert-green-rgb), 0.14)' }
              : { color: 'var(--cyan-primary)', borderColor: 'rgba(var(--cyan-rgb), 0.4)', background: 'rgba(var(--cyan-rgb), 0.12)' }
          }
        >
          {watchable ? 'Live' : 'Position'}
        </span>
      </button>

      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <h3 className="text-[11px] font-mono text-[var(--text-primary)] leading-snug line-clamp-2">{camera.name}</h3>
        {(camera.city || camera.country) && (
          <p className="text-[10px] font-mono text-[var(--text-secondary)] truncate">
            {[camera.city, camera.country].filter(Boolean).join(', ')}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 mt-auto pt-1.5">
          <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-dim)] truncate">
            {camera.provider_label}
          </span>
          <button
            onClick={() => onLocate(camera.lat, camera.lng)}
            aria-label={`Centre the map on ${camera.name}`}
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold-primary)]"
          >
            <MapPin className="w-3 h-3" />
          </button>
        </div>
      </div>
    </motion.div>
  );
});

export default memo(CameraBrowser);
export type { CameraRecord };
