import { AlertTriangle, CheckCircle2, ShieldAlert, HelpCircle } from 'lucide-react';
import { useChecks } from '../hooks/useApi';
import type { CheckResult, CheckState } from '../types';
import { cn } from '../lib/utils';

const STATE_META: Record<
  CheckState,
  { label: string; dot: string; text: string; chip: string }
> = {
  ok: {
    label: 'OK',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  warn: {
    label: 'WARN',
    dot: 'bg-amber-400',
    text: 'text-amber-600 dark:text-amber-400',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  crit: {
    label: 'CRIT',
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    chip: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
  unknown: {
    label: 'UNKN',
    dot: 'bg-gray-400',
    text: 'text-gray-500 dark:text-gray-400',
    chip: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  },
};

const ORDER: Record<CheckState, number> = { crit: 0, unknown: 1, warn: 2, ok: 3 };

function formatSince(since: number) {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function ProblemRow({ check }: { check: CheckResult }) {
  const meta = STATE_META[check.state];
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            'mt-0.5 inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide',
            meta.chip
          )}
        >
          {meta.label}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{check.name}</p>
          <p className="truncate text-xs text-muted">{check.summary}</p>
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-muted">
        <div>for {formatSince(check.since)}</div>
        {check.pending && (
          <div className={cn('font-medium', STATE_META[check.pending].text)}>
            → {check.pending} ({check.attempts.count}/{check.attempts.needed})
          </div>
        )}
      </div>
    </div>
  );
}

export default function Problems() {
  const { data, loading } = useChecks(15000);

  if (loading && !data) {
    return (
      <div className="card p-5">
        <p className="text-sm text-muted">Evaluating checks…</p>
      </div>
    );
  }

  const summary = data?.summary || { ok: 0, warn: 0, crit: 0, unknown: 0 };
  const problems = (data?.checks || [])
    .filter((c) => c.state !== 'ok' || c.pending)
    .sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  const problemCount = summary.crit + summary.unknown + summary.warn;

  return (
    <div className="card p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {problemCount === 0 ? (
            <CheckCircle2 size={18} className="text-emerald-500" />
          ) : summary.crit > 0 ? (
            <ShieldAlert size={18} className="text-red-500" />
          ) : (
            <AlertTriangle size={18} className="text-amber-500" />
          )}
          <h3 className="text-lg font-semibold">Problems</h3>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {(['crit', 'warn', 'unknown', 'ok'] as CheckState[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', STATE_META[s].dot)} />
              <span className="text-muted">
                {summary[s]} {STATE_META[s].label}
              </span>
            </span>
          ))}
        </div>
      </div>

      {problemCount === 0 && !problems.length ? (
        <p className="py-1 text-sm text-muted">All checks passing.</p>
      ) : (
        <div className="divide-y divide-black/5 dark:divide-white/5">
          {problems.map((c) => (
            <ProblemRow key={c.id} check={c} />
          ))}
        </div>
      )}
      {data && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted">
          <HelpCircle size={11} />
          {data.checks.length} checks evaluated · states go hard only after repeated failures
        </p>
      )}
    </div>
  );
}
