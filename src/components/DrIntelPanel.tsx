'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Newspaper, ShieldCheck, Download, Package, RefreshCw, X, ExternalLink, Clock, AlertTriangle } from 'lucide-react';

const NEWS_ENDPOINT = '/api/dr/news';
const CAPTURE_ENDPOINT = '/api/dr/evidence/capture';
const EXPORT_ENDPOINT = '/api/dr/evidence/export';
const EVIDENCE_HEADER = 'x-sentra-evidence';

interface DrNewsItem {
  id: string;
  title: string;
  link: string;
  summary: string;
  published_utc: string | null;
  published_basis: string;
  source: string;
}

interface DrSource {
  id: string;
  name: string;
  state: 'ok' | 'degraded';
  count: number;
  status?: number;
}

interface DrIntelPanelProps {
  /** True when the evidence surface is reachable (loopback + flag). */
  evidenceAvailable?: boolean;
  onClose?: () => void;
  onLocate?: (lat: number, lng: number) => void;
}

/**
 * Dominican Republic news intelligence + citable evidence capture.
 * Ages items off `captured_at` semantics; the feed's own date is shown as a
 * labelled claim (published_basis), never presented as verified fact.
 */
export default function DrIntelPanel({ evidenceAvailable = false, onClose }: DrIntelPanelProps) {
  const [items, setItems] = useState<DrNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<Record<string, { seq: number; hash: string } | 'pending' | 'error'>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [sources, setSources] = useState<DrSource[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(NEWS_ENDPOINT, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) { setError(body.error || `HTTP ${res.status}`); return; }
      setItems(body.items || []);
      setSources(body.sources || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load DR news.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const capture = async (item: DrNewsItem) => {
    setCaptured((c) => ({ ...c, [item.id]: 'pending' }));
    try {
      const res = await fetch(CAPTURE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [EVIDENCE_HEADER]: '1' },
        body: JSON.stringify({ source_url: item.link, kind: 'news-article', title: item.title }),
      });
      const body = await res.json();
      if (!res.ok || !body.captured) throw new Error(body.error || `HTTP ${res.status}`);
      setCaptured((c) => ({ ...c, [item.id]: { seq: body.seq, hash: body.content_sha256 } }));
      setNotice(`Captured #${body.seq} · sha256 ${String(body.content_sha256).slice(0, 12)}…`);
    } catch (e) {
      setCaptured((c) => ({ ...c, [item.id]: 'error' }));
      setError(e instanceof Error ? e.message : 'Capture failed.');
    }
  };

  const fmtDate = (item: DrNewsItem) => {
    if (item.published_utc) return new Date(item.published_utc).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
    return 'date unverified';
  };

  const header = useMemo(() => `${items.length} DR articles`, [items.length]);

  return (
    <div className="glass-panel flex flex-col overflow-hidden h-full" style={{ borderRadius: 18 }}>
      <header className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border-subtle)]">
        <Newspaper className="w-4 h-4 text-[var(--gold-primary)] shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="hud-text text-[11px] text-[var(--text-primary)]">DOMINICAN REPUBLIC INTEL</h2>
          <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">{header}</p>
        </div>
        {evidenceAvailable && (
          <a href={`${EXPORT_ENDPOINT}?format=dossier`} target="_blank" rel="noopener noreferrer"
            title="Export the tamper-evident evidence dossier (Markdown)"
            className="p-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--gold-primary)] transition-colors">
            <Download className="w-3.5 h-3.5" />
          </a>
        )}
        {evidenceAvailable && (
          <a href={`${EXPORT_ENDPOINT}?format=bundle`} target="_blank" rel="noopener noreferrer"
            title="Download the self-contained evidence bundle (ZIP: blobs + public key + standalone verify.mjs)"
            className="p-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--gold-primary)] transition-colors">
            <Package className="w-3.5 h-3.5" />
          </a>
        )}
        <button onClick={load} aria-label="Reload" className="p-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--gold-primary)] transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {onClose && (
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--alert-red)] transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </header>

      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-[var(--border-subtle)]">
          {sources.map((s) => (
            <span
              key={s.id}
              title={s.state === 'ok' ? `${s.count} articles` : `unavailable${s.status ? ` (HTTP ${s.status})` : ''}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-mono uppercase tracking-wider ${
                s.state === 'ok'
                  ? 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
                  : 'border-[var(--alert-red)] text-[var(--alert-red)]'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${s.state === 'ok' ? 'bg-[var(--alert-green)]' : 'bg-[var(--alert-red)]'}`} />
              {s.name}{s.state === 'ok' ? ` ${s.count}` : ' ✕'}
            </span>
          ))}
        </div>
      )}

      {!evidenceAvailable && (
        <div className="px-4 py-2 border-b border-[var(--border-subtle)] flex items-start gap-2 bg-[rgba(var(--alert-orange-rgb),0.08)]">
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--alert-orange)] shrink-0 mt-0.5" />
          <p className="text-[9px] font-mono text-[var(--text-secondary)] leading-relaxed">
            Evidence capture is off. Start with ENABLE_EVIDENCE_CAPTURE=true (loopback only) to snapshot citable proof.
          </p>
        </div>
      )}
      {notice && <div className="px-4 py-1.5 border-b border-[var(--border-subtle)]"><p className="text-[9px] font-mono text-[var(--alert-green)]">{notice}</p></div>}
      {error && <div className="px-4 py-1.5 border-b border-[var(--border-subtle)]"><p className="text-[9px] font-mono text-[var(--alert-red)]">{error}</p></div>}

      <div className="flex-1 overflow-y-auto styled-scrollbar px-3 py-2 flex flex-col gap-2">
        {loading && items.length === 0 && (
          <p className="text-[10px] font-mono text-[var(--text-muted)] px-1 py-4 text-center tracking-widest">LOADING…</p>
        )}
        {!loading && items.length === 0 && (
          <p className="text-[9px] font-mono text-[var(--alert-orange)] px-2 py-4 text-center leading-relaxed">
            No DR articles right now — outlets reachable but empty, or degraded (see the source badges above). Try reload.
          </p>
        )}
        {items.map((item) => {
          const cap = captured[item.id];
          return (
            <div key={item.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2.5">
              <div className="flex items-start justify-between gap-2">
                <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-[11px] font-mono text-[var(--text-primary)] leading-snug hover:text-[var(--gold-primary)] transition-colors line-clamp-2 flex-1">
                  {item.title}
                </a>
                <ExternalLink className="w-3 h-3 text-[var(--text-muted)] shrink-0 mt-0.5" />
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-dim)]">{item.source}</span>
                <span className="flex items-center gap-1 text-[8px] font-mono text-[var(--text-muted)]">
                  <Clock className="w-2.5 h-2.5" /> {fmtDate(item)}
                </span>
                {!item.published_utc && (
                  <span className="text-[8px] font-mono text-[var(--alert-orange)]" title={`basis: ${item.published_basis}`}>claim</span>
                )}
              </div>
              {evidenceAvailable && (
                <div className="mt-2 flex items-center gap-2">
                  {cap && typeof cap === 'object' ? (
                    <span className="flex items-center gap-1 text-[8px] font-mono text-[var(--alert-green)]">
                      <ShieldCheck className="w-3 h-3" /> CAPTURED #{cap.seq} · {cap.hash.slice(0, 10)}…
                    </span>
                  ) : (
                    <button
                      onClick={() => capture(item)}
                      disabled={cap === 'pending'}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[8px] font-mono uppercase tracking-wider border border-[rgba(var(--gold-rgb),0.4)] text-[var(--gold-primary)] hover:bg-[rgba(var(--gold-rgb),0.12)] transition-colors disabled:opacity-40">
                      <ShieldCheck className="w-3 h-3" /> {cap === 'pending' ? 'Capturing…' : cap === 'error' ? 'Retry capture' : 'Capture evidence'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <footer className="px-4 py-2 border-t border-[var(--border-subtle)] bg-[var(--surface-0)]">
        <p className="text-[9px] font-mono text-[var(--text-muted)]">
          Sources cited at origin. Dates shown are the outlet&apos;s claim; the attested clock is capture time.
        </p>
      </footer>
    </div>
  );
}
