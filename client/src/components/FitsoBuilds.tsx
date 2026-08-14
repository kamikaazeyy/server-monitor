import { useState } from 'react';
import { Smartphone, Download, Loader2, Rocket, X, RefreshCw } from 'lucide-react';
import { useBuilds, triggerBuild, cancelBuild } from '../hooks/useApi';
import type { EasBuild } from '../types';
import StatusBadge from './StatusBadge';
import { classForState } from '../lib/utils';

function timeAgo(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isBuildActive(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'new' || s === 'in queue' || s === 'in progress' || s === 'pending';
}

export default function FitsoBuilds() {
  const { data: builds, loading, error, refresh } = useBuilds(10000);
  const [triggering, setTriggering] = useState<'preview' | 'development' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const handleTrigger = async (profile: 'preview' | 'development') => {
    setTriggering(profile);
    setActionError(null);
    setSuccessMsg(null);
    try {
      const result = await triggerBuild(profile);
      setSuccessMsg(`Build started: ${result.id}`);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to start build');
    } finally {
      setTriggering(null);
    }
  };

  const handleCancel = async (buildId: string) => {
    setCancellingId(buildId);
    setActionError(null);
    try {
      await cancelBuild(buildId);
      setSuccessMsg('Build cancelled');
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to cancel build');
    } finally {
      setCancellingId(null);
    }
  };

  const activeBuilds = builds?.filter((b) => isBuildActive(b.status)) ?? [];

  return (
    <div className="space-y-6 p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-ink">
          <Smartphone size={22} />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Fitso APK Builds</h2>
          <p className="text-sm text-muted">Trigger EAS cloud builds and download installable APKs.</p>
        </div>
      </div>

      {/* Action errors / success */}
      {actionError && (
        <div className="rounded-2xl bg-red-100 p-4 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {actionError}
        </div>
      )}
      {successMsg && (
        <div className="rounded-2xl bg-emerald-100 p-4 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          {successMsg}
        </div>
      )}

      {/* Build trigger buttons */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card p-6">
          <div className="flex items-center gap-2">
            <Rocket size={18} className="text-accent" />
            <h3 className="font-semibold">Preview APK</h3>
          </div>
          <p className="mt-2 text-sm text-muted">
            Internal distribution build. Produces an installable <code className="rounded bg-black/5 px-1 dark:bg-white/10">.apk</code> file pointing at the Tailscale server.
          </p>
          <button
            onClick={() => handleTrigger('preview')}
            disabled={triggering !== null}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-60 dark:bg-accent dark:text-ink"
          >
            {triggering === 'preview' ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <Rocket size={16} />
                Build Preview APK
              </>
            )}
          </button>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-2">
            <Smartphone size={18} className="text-accent" />
            <h3 className="font-semibold">Development Build</h3>
          </div>
          <p className="mt-2 text-sm text-muted">
            Development client build for debugging. Connects to Metro bundler for live reloading.
          </p>
          <button
            onClick={() => handleTrigger('development')}
            disabled={triggering !== null}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-60 dark:bg-accent dark:text-ink"
          >
            {triggering === 'development' ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <Smartphone size={16} />
                Build Dev Client
              </>
            )}
          </button>
        </div>
      </div>

      {/* Active builds */}
      {activeBuilds.length > 0 && (
        <div>
          <h3 className="mb-3 text-lg font-semibold">Active Builds</h3>
          <div className="space-y-3">
            {activeBuilds.map((build) => (
              <div key={build.id} className="card flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Loader2 size={20} className="animate-spin text-accent" />
                  <div>
                    <div className="font-medium">{build.profile}</div>
                    <div className="text-xs text-muted">
                      {build.id.slice(0, 8)} · {timeAgo(build.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge state={build.status} />
                  <button
                    onClick={() => handleCancel(build.id)}
                    disabled={cancellingId === build.id}
                    className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 disabled:opacity-60 dark:bg-red-900/30 dark:text-red-300"
                  >
                    {cancellingId === build.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <X size={14} />
                    )}
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Build history */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Build History</h3>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {loading && !builds && (
          <div className="card p-8 text-center text-muted">Loading builds…</div>
        )}

        {error && (
          <div className="card p-8 text-center text-red-500">Error: {error}</div>
        )}

        {builds && builds.length === 0 && (
          <div className="card p-8 text-center text-muted">
            No builds yet. Trigger a build above to get started.
          </div>
        )}

        {builds && builds.length > 0 && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-black/5 dark:border-white/10">
                  <tr className="text-muted">
                    <th className="px-5 py-3 font-medium">Profile</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Version</th>
                    <th className="px-5 py-3 font-medium">Message</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                    <th className="px-5 py-3 font-medium text-right">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {builds.map((build: EasBuild) => {
                    const artifactUrl = build.artifacts?.artifactUrl;
                    const buildUrl = build.artifacts?.buildUrl;
                    const canDownload = build.status.toLowerCase() === 'finished' && (artifactUrl || buildUrl);
                    return (
                      <tr
                        key={build.id}
                        className="border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                      >
                        <td className="px-5 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${classForState(build.profile === 'preview' ? 'success' : 'open')}`}
                          >
                            {build.profile}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge state={build.status} />
                        </td>
                        <td className="px-5 py-3 text-muted">{build.appVersion || '—'}</td>
                        <td className="px-5 py-3 text-muted max-w-xs truncate">
                          {build.message || build.gitCommitMessage || '—'}
                        </td>
                        <td className="px-5 py-3 text-muted">{timeAgo(build.createdAt)}</td>
                        <td className="px-5 py-3 text-right">
                          {canDownload ? (
                            <a
                              href={artifactUrl || buildUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300"
                            >
                              <Download size={14} />
                              {artifactUrl ? 'APK' : 'View'}
                            </a>
                          ) : isBuildActive(build.status) ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted">
                              <Loader2 size={14} className="animate-spin" />
                              Building…
                            </span>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
