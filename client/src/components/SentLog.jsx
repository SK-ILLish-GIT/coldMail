import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { api } from '../lib/api.js';
import EmptyState from './EmptyState.jsx';

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'sent', label: 'Sent' },
  { id: 'failed', label: 'Failed' },
];

export default function SentLog() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api.listLog();
      setItems(data);
    } catch (err) {
      toast.error(err.message || 'Failed to load log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.status === filter)),
    [items, filter]
  );

  const counts = useMemo(() => {
    const total = items.length;
    const sent = items.filter((i) => i.status === 'sent').length;
    const failed = total - sent;
    return { total, sent, failed };
  }, [items]);

  const clearAll = async () => {
    if (!items.length) return;
    if (!confirm('Clear the entire sent log? This cannot be undone.')) return;
    try {
      await api.clearLog();
      toast.success('Log cleared.');
      refresh();
    } catch (err) {
      toast.error(err.message || 'Failed to clear log');
    }
  };

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/60 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Sent log</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <span className="pill-ink">{counts.total} total</span>
            <span className="pill-emerald">{counts.sent} sent</span>
            <span className="pill-rose">{counts.failed} failed</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="tabs text-xs">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={['tab', filter === f.id && 'tab-active'].filter(Boolean).join(' ')}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn-ghost btn-xs" onClick={refresh}>
            Refresh
          </button>
          <button
            type="button"
            className="btn-ghost btn-xs text-rose-600 hover:bg-rose-50"
            onClick={clearAll}
            disabled={!items.length}
          >
            Clear
          </button>
        </div>
      </header>

      {loading ? (
        <div className="p-6">
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-ink-100" />
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="mail"
          title={
            items.length === 0
              ? 'No emails sent yet'
              : `No ${filter} emails to show`
          }
          description={
            items.length === 0
              ? 'Once you start sending campaigns, you’ll see a per-recipient audit trail here.'
              : 'Try a different filter or come back after a fresh send.'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50/60 text-2xs uppercase tracking-[0.08em] text-ink-500">
              <tr>
                <th className="px-6 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold">Recipient</th>
                <th className="px-6 py-3 font-semibold">Subject</th>
                <th className="px-6 py-3 font-semibold">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map((row) => (
                <tr key={row.id} className="transition hover:bg-ink-50/40">
                  <td className="px-6 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      {row.status === 'sent' ? (
                        <span className="pill-emerald">
                          <span className="status-dot bg-emerald-500" />
                          Sent
                        </span>
                      ) : (
                        <span className="pill-rose" title={row.error || ''}>
                          <span className="status-dot bg-rose-500" />
                          Failed
                        </span>
                      )}
                      {row.meta?.enriched && (
                        <span
                          className="pill-brand"
                          title={
                            row.meta?.pattern
                              ? `${row.meta.pattern} @ ${Math.round((row.meta.confidence || 0) * 100)}%`
                              : 'AI-suggested email'
                          }
                        >
                          AI
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <div className="font-medium text-ink-900">{row.to}</div>
                    {(row.name || row.company) && (
                      <div className="text-xs text-ink-500">
                        {[row.name, row.company].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3 max-w-sm truncate text-ink-700">
                    {row.subject || <span className="italic text-ink-400">(no subject)</span>}
                  </td>
                  <td className="px-6 py-3 text-xs text-ink-500">{fmtDate(row.sentAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
