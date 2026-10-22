import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useHistoryRange } from '../hooks/useApi';
import Sparkline from './Sparkline';
import type { HistoryPoint, HistoryRange } from '../types';
import { cn } from '../lib/utils';

const RANGES: { id: HistoryRange; label: string }[] = [
  { id: '1h', label: '1h' },
  { id: '6h', label: '6h' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
];

function series(points: HistoryPoint[] | null, key: 'cpu' | 'memory' | 'disk') {
  return (points || [])
    .map((p) => ({ value: typeof p[key] === 'number' ? (p[key] as number) : 0 }));
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs text-muted">
      {label} <span className="font-medium text-ink dark:text-white">{value}</span>
    </span>
  );
}

export default function Trends() {
  const [range, setRange] = useState<HistoryRange>('24h');
  const { data: points } = useHistoryRange(range, 30000);

  const cpu = series(points, 'cpu');
  const mem = series(points, 'memory');
  const disk = series(points, 'disk');
  const last = points && points.length ? points[points.length - 1] : null;
  const first = points && points.length ? points[0] : null;

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-muted" />
          <h3 className="text-lg font-semibold">Trends</h3>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-black/5 p-1 dark:bg-white/10">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                range === r.id
                  ? 'bg-surface text-ink shadow-sm dark:bg-surface-dark dark:text-white'
                  : 'text-muted hover:text-ink dark:hover:text-white'
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!points || points.length < 2 ? (
        <p className="text-sm text-muted">
          Not enough history yet — points accumulate once per minute and persist across restarts.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Stat label="CPU" value={`${last?.cpu?.toFixed(1) ?? '—'}%`} />
              <Sparkline data={cpu} color="#0f0f11" fill="#0f0f11" height={50} />
            </div>
            <div>
              <Stat label="Memory" value={`${last?.memory?.toFixed(1) ?? '—'}%`} />
              <Sparkline data={mem} color="#22c55e" fill="#22c55e" height={50} />
            </div>
            <div>
              <Stat label="Disk" value={last?.disk != null ? `${last.disk.toFixed(1)}%` : '—'} />
              <Sparkline data={disk} color="#f59e0b" fill="#f59e0b" height={50} />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            {points.length} points · {first ? new Date(first.time).toLocaleString() : ''} →{' '}
            {last ? new Date(last.time).toLocaleString() : ''}
          </p>
        </>
      )}
    </div>
  );
}
