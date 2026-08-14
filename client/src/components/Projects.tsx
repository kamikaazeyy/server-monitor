import { useState } from 'react';
import { useProjects, containerAction } from '../hooks/useApi';
import StatusBadge from './StatusBadge';
import { cn } from '../lib/utils';
import type { ContainerData } from '../types';

function ContainerActions({ c, onRefresh }: { c: ContainerData; onRefresh: () => Promise<void> }) {
  const [working, setWorking] = useState(false);
  const isRunning = c.state?.toLowerCase() === 'running';

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    setWorking(true);
    try {
      await containerAction(c.name, action);
      await onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {!isRunning && (
        <button
          onClick={() => handleAction('start')}
          disabled={working}
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium transition-opacity',
            'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400'
          )}
        >
          {working ? '…' : 'Start'}
        </button>
      )}
      {isRunning && (
        <button
          onClick={() => handleAction('stop')}
          disabled={working}
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium transition-opacity',
            'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400'
          )}
        >
          {working ? '…' : 'Stop'}
        </button>
      )}
      <button
        onClick={() => handleAction('restart')}
        disabled={working}
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-medium transition-opacity',
          'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400'
        )}
      >
        {working ? '…' : 'Restart'}
      </button>
    </div>
  );
}

export default function Projects() {
  const { data, loading, refresh } = useProjects(5000);

  if (loading && !data) {
    return <div className="p-8 text-muted">Loading projects…</div>;
  }

  return (
    <div className="p-6 md:p-8">
      <h2 className="mb-4 text-xl font-semibold">Project-wise Containers</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((p) => (
          <div key={p.project} className="card p-5">
            <h3 className="mb-3 text-lg font-semibold capitalize">{p.project}</h3>
            <div className="space-y-3">
              {p.containers.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-2xl bg-black/[0.03] p-3 dark:bg-white/[0.05]"
                >
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted">{c.service}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge state={c.state} />
                    <ContainerActions c={c} onRefresh={refresh} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!data?.length && (
          <p className="col-span-full text-muted">No projects detected.</p>
        )}
      </div>
    </div>
  );
}
