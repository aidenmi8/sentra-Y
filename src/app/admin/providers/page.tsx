'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, KeyRound, RefreshCw, ShieldAlert, Save } from 'lucide-react';

const ADMIN_ENDPOINT = '/api/admin/providers';
const ADMIN_HEADER = 'x-sentra-admin';

interface ManagedKeyStatus {
  key: string;
  set: boolean;
  source: 'override' | 'environment' | 'unset';
  length: number;
}

interface ProviderStatus {
  id: string;
  name: string;
  category: string;
  state: string;
  env: string[];
  routes: string[];
  message: string;
}

interface AdminPayload {
  overrideFile: string;
  managedKeys: string[];
  keys: ManagedKeyStatus[];
  providers: ProviderStatus[];
}

const STATE_COLOR: Record<string, string> = {
  configured: 'var(--alert-green)',
  keyless: 'var(--cyan-primary)',
  missing_optional: 'var(--alert-orange)',
  disabled: 'var(--text-muted)',
  planned: 'var(--text-muted)',
};

export default function ProviderAdminPage() {
  const [payload, setPayload] = useState<AdminPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(ADMIN_ENDPOINT, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || `Request failed with HTTP ${res.status}`);
        setPayload(null);
      } else {
        setPayload(body);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the admin endpoint.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const keyStatus = useMemo(() => {
    const map = new Map<string, ManagedKeyStatus>();
    for (const entry of payload?.keys || []) map.set(entry.key, entry);
    return map;
  }, [payload]);

  const pendingCount = Object.values(drafts).filter((v) => v !== '').length;

  const save = async () => {
    const updates = Object.fromEntries(Object.entries(drafts).filter(([, v]) => v !== ''));
    if (Object.keys(updates).length === 0) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(ADMIN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [ADMIN_HEADER]: '1' },
        body: JSON.stringify({ updates }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || `Save failed with HTTP ${res.status}`);
      } else {
        setPayload((prev) => (prev ? { ...prev, keys: body.keys, providers: body.providers } : prev));
        setDrafts({});
        const parts = [
          body.applied?.length ? `${body.applied.length} updated` : null,
          body.cleared?.length ? `${body.cleared.length} cleared` : null,
          body.clearedCaches?.length ? `caches reset: ${body.clearedCaches.join(', ')}` : null,
        ].filter(Boolean);
        setNotice(parts.join(' · ') || 'No changes applied.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async (key: string) => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(ADMIN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [ADMIN_HEADER]: '1' },
        body: JSON.stringify({ updates: { [key]: '' } }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error || `Clear failed with HTTP ${res.status}`);
      else {
        setPayload((prev) => (prev ? { ...prev, keys: body.keys, providers: body.providers } : prev));
        setNotice(`${key} cleared — falls back to its environment value if one is set.`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg-void)] text-[var(--text-primary)] px-4 py-8 md:px-10 overflow-y-auto styled-scrollbar">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <Link href="/" className="inline-flex items-center gap-1.5 text-[10px] font-mono tracking-widest text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition-colors mb-2">
              <ArrowLeft className="w-3 h-3" /> BACK TO MAP
            </Link>
            <h1 className="text-xl font-mono font-bold tracking-[0.2em] text-[var(--gold-primary)] flex items-center gap-2">
              <KeyRound className="w-5 h-5" /> PROVIDER CREDENTIALS
            </h1>
          </div>
          <button
            onClick={load}
            className="glass-panel px-3 py-2 flex items-center gap-2 text-[10px] font-mono tracking-widest hover:border-[var(--gold-primary)]/40 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> REFRESH
          </button>
        </div>

        <div className="glass-panel-sm p-3 mb-6 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 text-[var(--cyan-primary)] shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
            Values are never displayed after saving — this page reports only whether a key is set and
            where it came from. Environment variables remain the base layer; anything saved here is an
            override stored in a gitignored file, and clearing an override falls the key back to its
            environment value. Reachable only over a loopback address.
          </p>
        </div>

        {error && (
          <div className="glass-panel-sm p-3 mb-4 border-[var(--alert-red)]/30">
            <p className="text-[11px] font-mono text-[var(--alert-red)]">{error}</p>
          </div>
        )}
        {notice && (
          <div className="glass-panel-sm p-3 mb-4 border-[var(--alert-green)]/30 flex items-center gap-2">
            <Check className="w-3.5 h-3.5 text-[var(--alert-green)]" />
            <p className="text-[11px] font-mono text-[var(--alert-green)]">{notice}</p>
          </div>
        )}

        {loading && !payload && (
          <p className="text-[11px] font-mono text-[var(--text-muted)] tracking-widest">LOADING…</p>
        )}

        {payload && (
          <>
            <div className="space-y-4">
              {payload.providers.map((provider) => (
                <section key={provider.id} className="glass-panel p-4">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
                    <h2 className="text-[13px] font-mono font-bold tracking-wider text-[var(--text-primary)]">
                      {provider.name}
                    </h2>
                    <span
                      className="text-[9px] font-mono tracking-widest px-2 py-0.5 rounded"
                      style={{
                        color: STATE_COLOR[provider.state] || 'var(--text-muted)',
                        border: `1px solid ${STATE_COLOR[provider.state] || 'var(--text-muted)'}55`,
                      }}
                    >
                      {provider.state.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed mb-1">{provider.message}</p>
                  <p className="text-[9px] font-mono text-[var(--text-muted)] mb-3">{provider.routes.join(' · ') || '—'}</p>

                  {provider.env.length === 0 ? (
                    <p className="text-[10px] font-mono text-[var(--text-muted)]">No credentials required.</p>
                  ) : (
                    <div className="space-y-2">
                      {provider.env.map((key) => {
                        const status = keyStatus.get(key);
                        return (
                          <div key={key} className="flex items-center gap-2 flex-wrap">
                            <label htmlFor={`key-${key}`} className="text-[10px] font-mono text-[var(--text-secondary)] w-full md:w-[220px] shrink-0">
                              {key}
                            </label>
                            <input
                              id={`key-${key}`}
                              type="password"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder={status?.set ? `set via ${status.source} — enter a new value to replace` : 'not set'}
                              value={drafts[key] ?? ''}
                              onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                              className="flex-1 min-w-[200px] bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded px-2 py-1.5 text-[11px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]/50 transition-colors"
                            />
                            {status?.source === 'override' && (
                              <button
                                onClick={() => clearKey(key)}
                                disabled={saving}
                                className="text-[9px] font-mono tracking-widest px-2 py-1.5 rounded border border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--alert-red)] hover:border-[var(--alert-red)]/40 transition-colors disabled:opacity-40"
                              >
                                CLEAR
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>

            <div className="sticky bottom-4 mt-6 flex items-center justify-between gap-3 glass-panel p-3 flex-wrap">
              <p className="text-[10px] font-mono text-[var(--text-muted)]">
                {pendingCount === 0 ? 'No pending changes' : `${pendingCount} pending change${pendingCount === 1 ? '' : 's'}`}
                <span className="hidden md:inline"> · overrides stored at {payload.overrideFile}</span>
              </p>
              <button
                onClick={save}
                disabled={saving || pendingCount === 0}
                className="flex items-center gap-2 px-4 py-2 rounded text-[11px] font-mono font-bold tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--gold-primary)]/15 border border-[var(--gold-primary)]/50 text-[var(--gold-primary)] hover:bg-[var(--gold-primary)]/25"
              >
                <Save className="w-3.5 h-3.5" /> {saving ? 'SAVING…' : 'SAVE & RELOAD PROVIDERS'}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
