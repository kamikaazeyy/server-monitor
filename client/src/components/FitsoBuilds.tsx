import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, Download, Loader2, Rocket, X, RefreshCw, QrCode, Copy, Trash2, ExternalLink, ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { useBuilds, triggerBuild, cancelBuild, mirrorBuild, deleteBuild, fetchBuildLog } from '../hooks/useApi';
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

function normalizeBuildStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

function isBuildActive(status: string): boolean {
  const s = normalizeBuildStatus(status);
  return s === 'new' || s === 'in queue' || s === 'in progress' || s === 'pending' || s === 'downloading' || s === 'mirroring';
}

function isMirrorFailed(status: string): boolean {
  return normalizeBuildStatus(status) === 'mirror failed';
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '—';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}

// --- Build Log Console -------------------------------------------------------

interface LogEntry {
  stream: string;
  line: string;
}

function BuildLogConsole({ buildId }: { buildId: string }) {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;

    fetchBuildLog(buildId).then((text) => {
      if (cancelled || !text) return;
      const parsed = text.split('\n').filter(Boolean).map((l) => {
        const idx = l.indexOf('|');
        if (idx < 0) return { stream: 'stdout', line: l };
        return { stream: l.slice(0, idx), line: l.slice(idx + 1) };
      });
      setLines(parsed);
    });

    const socketUrl = import.meta.env.VITE_TERMINAL_URL || window.location.origin;
    const socket = io(socketUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      socket.emit('build:join', buildId);
    });

    socket.on('build:log', (data: { buildId: string; line: string; stream: string }) => {
      if (data.buildId !== buildId) return;
      setLines((prev) => {
        const next = [...prev, { stream: data.stream, line: data.line }];
        if (next.length > 2000) return next.slice(-2000);
        return next;
      });
    });

    return () => {
      cancelled = true;
      socket.emit('build:leave', buildId);
      socket.disconnect();
    };
  }, [buildId]);

  useEffect(() => {
    if (autoScroll && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleScroll = () => {
    if (!preRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = preRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
  };

  const copyLog = () => {
    const text = lines.map((l) => l.line).join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="mt-3 rounded-2xl border border-black/5 dark:border-white/10">
      <div className="flex items-center justify-between rounded-t-2xl bg-black/5 px-4 py-2 dark:bg-white/5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-2 text-sm font-medium text-muted"
        >
          <Terminal size={14} />
          Build Log (CLI/Queue)
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{lines.length} lines</span>
          <button
            onClick={copyLog}
            className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2 py-1 text-xs text-muted hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
          >
            <Copy size={12} />
            Copy
          </button>
        </div>
      </div>
      {expanded && (
        <>
          <div className="px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            This is the EAS CLI/queue log, not compiler output. The Gradle build runs on Expo's machines — view the full Gradle log on EAS.
          </div>
          <pre
            ref={preRef}
            onScroll={handleScroll}
            className="max-h-80 overflow-auto bg-[#0f0f11] p-4 text-xs leading-relaxed"
          >
            {lines.length === 0 ? (
              <span className="text-gray-500">Waiting for build output…</span>
            ) : (
              lines.map((entry, i) => (
                <div
                  key={i}
                  className={entry.stream === 'stderr' ? 'text-red-400' : 'text-gray-300'}
                >
                  {entry.line}
                </div>
              ))
            )}
          </pre>
          {!autoScroll && (
            <button
              onClick={() => setAutoScroll(true)}
              className="w-full bg-black/5 py-1 text-xs text-muted hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              ↓ Auto-scroll
            </button>
          )}
        </>
      )}
    </div>
  );
}

// --- QR Modal ----------------------------------------------------------------

function QrModal({ buildId, onClose }: { buildId: string; onClose: () => void }) {
  const apkUrl = `${window.location.origin}/api/builds/${buildId}/apk`;
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    navigator.clipboard.writeText(apkUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="card w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Install via QR</h3>
          <button onClick={onClose} className="text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="flex justify-center">
          <div className="rounded-2xl bg-white p-4">
            <QRCodeSVG value={apkUrl} size={200} />
          </div>
        </div>
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-black/5 px-3 py-2 text-xs dark:bg-white/10">
              {apkUrl}
            </code>
            <button
              onClick={copyUrl}
              className="rounded-lg bg-black/5 px-3 py-2 text-xs hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
            >
              {copied ? '✓' : <Copy size={14} />}
            </button>
          </div>
          <p className="mt-3 text-xs text-muted">
            On Android, enable "Install unknown apps" for your browser the first time.
          </p>
        </div>
      </div>
    </div>
  );
}

// --- Elapsed Timer -----------------------------------------------------------

function ElapsedTimer({ startIso }: { startIso: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startIso).getTime();
    const update = () => setElapsed(Math.max(0, (Date.now() - start) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startIso]);
  return <span className="text-xs text-muted">{formatElapsed(elapsed)}</span>;
}

export default function FitsoBuilds() {
  const { data: builds, loading, error, refresh } = useBuilds(10000);
  const [triggering, setTriggering] = useState<'preview' | 'development' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [mirroringId, setMirroringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [qrBuildId, setQrBuildId] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, { received: number; total: number }>>({});
  const [liveBuilds, setLiveBuilds] = useState<Record<string, { status: string; sizeBytes?: number }>>({});
  const [pendingBuilds, setPendingBuilds] = useState<EasBuild[]>([]);
  const buildSocketRef = useRef<ReturnType<typeof io> | null>(null);

  // Listen for optimistic build additions
  useEffect(() => {
    const handler = (e: Event) => {
      const build = (e as CustomEvent<EasBuild>).detail;
      setPendingBuilds((prev) => [build, ...prev.filter(b => b.id !== build.id)]);
    };
    window.addEventListener('build:optimistic', handler);
    return () => window.removeEventListener('build:optimistic', handler);
  }, []);

  // Merge pending builds with fetched builds, dropping ones that are now in the fetched list
  const listedBuilds = [
    ...pendingBuilds.filter(p => !builds?.some(b => b.id === p.id)),
    ...(builds ?? []),
  ];
  const allBuilds = listedBuilds.map((build) => {
    const liveBuild = liveBuilds[build.id];
    if (!liveBuild) return build;
    return {
      ...build,
      status: liveBuild.status,
      localApkAvailable: build.localApkAvailable || liveBuild.status === 'downloaded',
      sizeBytes: liveBuild.sizeBytes ?? build.sizeBytes,
    };
  });
  const joinedBuildIds = listedBuilds.map((build) => build.id).sort().join(',');

  // Socket.io for build:progress events (global, not per-build)
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_TERMINAL_URL || window.location.origin;
    const socket = io(socketUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
    });
    buildSocketRef.current = socket;

    socket.on('build:progress', (data: { buildId: string; received: number; total: number }) => {
      setProgressMap((prev) => ({ ...prev, [data.buildId]: { received: data.received, total: data.total } }));
    });

    socket.on('build:status', (data: { buildId: string; status: string; sizeBytes?: number }) => {
      const status = normalizeBuildStatus(data.status);
      setLiveBuilds((prev) => ({ ...prev, [data.buildId]: { status, sizeBytes: data.sizeBytes } }));
      if (status === 'downloaded' || status === 'finished' || status === 'errored' || status === 'canceled' || status === 'mirror failed') {
        setProgressMap((prev) => {
          const next = { ...prev };
          delete next[data.buildId];
          return next;
        });
        refresh();
      }
    });

    return () => {
      buildSocketRef.current = null;
      socket.disconnect();
    };
  }, [refresh]);

  useEffect(() => {
    const socket = buildSocketRef.current;
    if (!socket) return;
    const joinBuilds = () => {
      joinedBuildIds.split(',').filter(Boolean).forEach((buildId) => socket.emit('build:join', buildId));
    };
    joinBuilds();
    socket.on('connect', joinBuilds);
    return () => {
      socket.off('connect', joinBuilds);
    };
  }, [joinedBuildIds]);

  const handleTrigger = async (profile: 'preview' | 'development') => {
    setTriggering(profile);
    setActionError(null);
    setSuccessMsg(null);
    try {
      const result = await triggerBuild(profile);
      setSuccessMsg(`Build started: ${result.id}`);
      setExpandedLogId(result.id);
      // Optimistic update: add the new build to the list immediately
      const optimisticBuild: EasBuild = {
        id: result.id,
        profile: result.profile,
        platform: 'ANDROID',
        status: result.status || 'new',
        distribution: '',
        buildType: '',
        sdkVersion: '',
        appVersion: '',
        gitCommitHash: '',
        gitCommitMessage: '',
        channel: '',
        message: result.message || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        artifacts: null,
        submissionStatus: null,
        localApkAvailable: false,
        sizeBytes: null,
        downloadedAt: null,
      };
      // Use functional update via a ref-like approach through refresh + manual merge
      refresh();
      // Also directly inject into the builds data via a custom event
      window.dispatchEvent(new CustomEvent('build:optimistic', { detail: optimisticBuild }));
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

  const handleMirror = async (buildId: string) => {
    setMirroringId(buildId);
    setActionError(null);
    try {
      await mirrorBuild(buildId);
      setSuccessMsg(`Mirroring started for ${buildId.slice(0, 8)}`);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to mirror build');
    } finally {
      setMirroringId(null);
    }
  };

  const handleDelete = async (buildId: string) => {
    setDeletingId(buildId);
    setActionError(null);
    try {
      await deleteBuild(buildId);
      setSuccessMsg('Build artifact deleted');
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete build');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleLog = useCallback((buildId: string) => {
    setExpandedLogId((prev) => (prev === buildId ? null : buildId));
  }, []);

  const activeBuilds = allBuilds.filter((b) => isBuildActive(b.status));
  const historyBuilds = allBuilds.filter((b) => !isBuildActive(b.status));

  return (
    <div className="space-y-6 p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-ink">
          <Smartphone size={22} />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Fitso APK Builds</h2>
          <p className="text-sm text-muted">Trigger EAS cloud builds, mirror APKs locally, and install over Tailscale.</p>
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
            {activeBuilds.map((build) => {
              const buildUrl = build.artifacts?.buildUrl;
              const prog = progressMap[build.id];
              const isDownloading = build.status.toLowerCase() === 'downloading' || build.status.toLowerCase() === 'mirroring';
              return (
                <div key={build.id} className="card p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Loader2 size={20} className="animate-spin text-accent" />
                      <div>
                        <div className="font-medium">{build.profile}</div>
                        <div className="text-xs text-muted">
                          {build.id.slice(0, 8)} · <ElapsedTimer startIso={build.createdAt} />
                          {build.gitCommitHash && ` · ${build.gitCommitHash.slice(0, 7)}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge state={build.status} />
                      {buildUrl && (
                        <a
                          href={buildUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300"
                        >
                          <ExternalLink size={12} />
                          EAS Log
                        </a>
                      )}
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
                  {isDownloading && prog && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-muted">
                        <span>Mirroring…</span>
                        <span>{formatBytes(prog.received)} / {formatBytes(prog.total)}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                        <div
                          className="h-full bg-accent transition-all"
                          style={{ width: `${prog.total > 0 ? (prog.received / prog.total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <BuildLogConsole buildId={build.id} />
                </div>
              );
            })}
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

        {allBuilds.length === 0 && !loading && (
          <div className="card p-8 text-center text-muted">
            No builds yet. Trigger a build above to get started.
          </div>
        )}

        {historyBuilds.length > 0 && (
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
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {historyBuilds.map((build: EasBuild) => {
                    const artifactUrl = build.artifacts?.artifactUrl || build.artifacts?.applicationArchiveUrl;
                    const buildUrl = build.artifacts?.buildUrl;
                    const isFinished = build.status.toLowerCase() === 'finished' || build.status.toLowerCase() === 'mirror_failed';
                    const isDownloading = build.status.toLowerCase() === 'downloading' || build.status.toLowerCase() === 'mirroring' || !!progressMap[build.id];
                    const prog = progressMap[build.id];
                    return (
                      <Fragment key={build.id}>
                        <tr
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
                            <div className="flex items-center justify-end gap-2">
                              {/* Local APK download */}
                              {build.localApkAvailable ? (
                                <>
                                  <a
                                    href={`/api/builds/${build.id}/apk`}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300"
                                  >
                                    <Download size={14} />
                                    {formatBytes(build.sizeBytes || 0)}
                                  </a>
                                  <button
                                    onClick={() => setQrBuildId(build.id)}
                                    className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
                                    title="Show QR code"
                                  >
                                    <QrCode size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(build.id)}
                                    disabled={deletingId === build.id}
                                    className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-60 dark:bg-red-900/30 dark:text-red-300"
                                    title="Delete local artifact"
                                  >
                                    {deletingId === build.id ? (
                                      <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                      <Trash2 size={14} />
                                    )}
                                  </button>
                                </>
                              ) : isDownloading ? (
                                <span className="inline-flex items-center gap-1 text-xs text-muted">
                                  <Loader2 size={14} className="animate-spin" />
                                  {prog ? `${formatBytes(prog.received)}` : 'Mirroring…'}
                                </span>
                              ) : isMirrorFailed(build.status) && artifactUrl ? (
                                <button
                                  onClick={() => handleMirror(build.id)}
                                  disabled={mirroringId === build.id}
                                  className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 disabled:opacity-60 dark:bg-red-900/30 dark:text-red-300"
                                  title="Previous mirror attempt failed. Click to retry."
                                >
                                  {mirroringId === build.id ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <Download size={14} />
                                  )}
                                  Retry Mirror
                                </button>
                              ) : isFinished && artifactUrl ? (
                                <button
                                  onClick={() => handleMirror(build.id)}
                                  disabled={mirroringId === build.id}
                                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-200 disabled:opacity-60 dark:bg-amber-900/30 dark:text-amber-300"
                                >
                                  {mirroringId === build.id ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <Download size={14} />
                                  )}
                                  Mirror
                                </button>
                              ) : isBuildActive(build.status) ? (
                                <span className="inline-flex items-center gap-1 text-xs text-muted">
                                  <Loader2 size={14} className="animate-spin" />
                                  Building…
                                </span>
                              ) : (
                                <span className="text-xs text-muted">—</span>
                              )}

                              {/* EAS link as secondary fallback */}
                              {artifactUrl && (
                                <a
                                  href={artifactUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-blue-500 hover:underline"
                                >
                                  EAS
                                </a>
                              )}

                              {/* Log toggle for finished/active builds */}
                              <button
                                onClick={() => toggleLog(build.id)}
                                className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
                              >
                                {expandedLogId === build.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                Log
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expandedLogId === build.id && (
                          <tr>
                            <td colSpan={6} className="px-5 py-3">
                              <BuildLogConsole buildId={build.id} />
                              {buildUrl && (
                                <a
                                  href={buildUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-flex items-center gap-1 text-xs text-blue-500 hover:underline"
                                >
                                  <ExternalLink size={12} />
                                  View full Gradle log on EAS
                                </a>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* QR Modal */}
      {qrBuildId && (
        <QrModal buildId={qrBuildId} onClose={() => setQrBuildId(null)} />
      )}
    </div>
  );
}
