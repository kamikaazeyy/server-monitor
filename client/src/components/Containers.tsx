import { useState } from 'react';
import { useContainers, containerAction } from '../hooks/useApi';
import StatusBadge from './StatusBadge';
import { cn } from '../lib/utils';
import type { ContainerData } from '../types';

export default function Containers() {
  const { data, loading, refresh } = useContainers(5000);
  const [working, setWorking] = useState<Record<string, string>>({});

  const handleAction = async (c: ContainerData, action: 'start' | 'stop' | 'restart') => {
    setWorking((prev) => ({ ...prev, [c.name]: action }));
    try {
      await containerAction(c.name, action);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setWorking((prev) => {
        const next = { ...prev };
        delete next[c.name];
        return next;
      });
    }
  };

  if (loading && !data) {
    return <div className="p-8 text-muted">Loading containers…</div>;
  }

  const isRunning = (state: string) => state?.toLowerCase() === 'running';

  return (
    <div className="p-6 md:p-8">
      <h2 className="mb-4 text-xl font-semibold">Docker Containers</h2>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-black/5 dark:border-white/10">
              <tr className="text-muted">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Image</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Project</th>
                <th className="px-5 py-3 font-medium">Service</th>
                <th className="px-5 py-3 font-medium">CPU</th>
                <th className="px-5 py-3 font-medium">Memory</th>
                <th className="px-5 py-3 font-medium">Net I/O</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                >
                  <td className="px-5 py-3 font-medium">{c.name}</td>
                  <td className="px-5 py-3 text-muted">{c.image}</td>
                  <td className="px-5 py-3">
                    <StatusBadge state={c.state} />
                  </td>
                  <td className="px-5 py-3 text-muted">{c.project || '—'}</td>
                  <td className="px-5 py-3 text-muted">{c.service}</td>
                  <td className="px-5 py-3">{c.cpu?.toFixed(2)}%</td>
                  <td className="px-5 py-3">{c.memoryUsage}</td>
                  <td className="px-5 py-3">{c.netIO}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {!isRunning(c.state) && (
                        <button
                          onClick={() => handleAction(c, 'start')}
                          disabled={!!working[c.name]}
                          className={cn(
                            'rounded-full px-2.5 py-1 text-xs font-medium transition-opacity',
                            'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400'
                          )}
                        >
                          {working[c.name] === 'start' ? '…' : 'Start'}
                        </button>
                      )}
                      {isRunning(c.state) && (
                        <button
                          onClick={() => handleAction(c, 'stop')}
                          disabled={!!working[c.name]}
                          className={cn(
                            'rounded-full px-2.5 py-1 text-xs font-medium transition-opacity',
                            'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400'
                          )}
                        >
                          {working[c.name] === 'stop' ? '…' : 'Stop'}
                        </button>
                      )}
                      <button
                        onClick={() => handleAction(c, 'restart')}
                        disabled={!!working[c.name]}
                        className={cn(
                          'rounded-full px-2.5 py-1 text-xs font-medium transition-opacity',
                          'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400'
                        )}
                      >
                        {working[c.name] === 'restart' ? '…' : 'Restart'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!data?.length && (
                <tr>
                  <td colSpan={9} className="px-5 py-6 text-center text-muted">
                    No containers found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
