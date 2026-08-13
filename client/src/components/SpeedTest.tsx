import { useState } from 'react';
import { runSpeedTest } from '../hooks/useApi';
import { Zap, RotateCw } from 'lucide-react';

export default function SpeedTest() {
  const [result, setResult] = useState<{ speedMbps: number; duration: number; source: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const data = await runSpeedTest();
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run speed test');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 md:p-12">
      <div className="card w-full max-w-lg p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent text-ink">
          {running ? <RotateCw size={28} className="animate-spin" /> : <Zap size={28} />}
        </div>
        <h2 className="mt-4 text-2xl font-semibold">Internet Speed Test</h2>
        <p className="mt-2 text-sm text-muted">
          Run a live download test against Cloudflare to measure current throughput.
        </p>

        <button
          onClick={handleRun}
          disabled={running}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-medium text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-60 dark:bg-accent dark:text-ink"
        >
          {running ? 'Running…' : 'Run Speed Test'}
          {!running && <Zap size={16} />}
        </button>

        {result && (
          <div className="mt-8 space-y-2">
            <div className="text-5xl font-bold tracking-tight">
              {result.speedMbps.toFixed(2)}{' '}
              <span className="text-2xl text-muted">Mbps</span>
            </div>
            <p className="text-sm text-muted">
              {result.duration.toFixed(2)}s · {result.source}
            </p>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-2xl bg-red-100 p-4 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
