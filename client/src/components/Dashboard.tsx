import {
  Cpu,
  HardDrive,
  MemoryStick,
  Clock,
  ArrowDown,
  ArrowUp,
  Box,
  Activity,
  RefreshCw,
  AlertTriangle,
  Settings,
  Download,
} from 'lucide-react';
import {
  useOverview,
  useNetwork,
  useContainers,
  useServices,
  useHistory,
} from '../hooks/useApi';
import KpiCard from './KpiCard';
import StatusBadge from './StatusBadge';
import Sparkline from './Sparkline';
import MiniBar from './MiniBar';
import { formatUptime } from '../lib/utils';
import type { ContainerData, ServiceData, HistoryPoint } from '../types';

function ActionPill({ icon: Icon, label, onClick }: { icon: typeof Cpu; label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="pill pill-muted hover:bg-black/10 dark:hover:bg-white/20"
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function toSparkData(history: HistoryPoint[] | null, key: keyof HistoryPoint) {
  return (history || [])
    .slice(-30)
    .map((p) => ({ value: typeof p[key] === 'number' ? (p[key] as number) : 0 }));
}

function containerSummary(containers: ContainerData[] | null) {
  if (!containers) return { total: 0, running: 0, cpu: 0, mem: 0 };
  return containers.reduce(
    (acc, c) => {
      acc.total += 1;
      if (c.state === 'running') acc.running += 1;
      acc.cpu += c.cpu || 0;
      acc.mem += c.memory || 0;
      return acc;
    },
    { total: 0, running: 0, cpu: 0, mem: 0 }
  );
}

function serviceSummary(services: ServiceData[] | null) {
  if (!services) return { total: 0, active: 0, failed: 0 };
  return services.reduce(
    (acc, s) => {
      acc.total += 1;
      if (s.state === 'active' && s.sub === 'running') acc.active += 1;
      if (s.state === 'failed') acc.failed += 1;
      return acc;
    },
    { total: 0, active: 0, failed: 0 }
  );
}

function netTotal(network: { interfaces: { rxSpeed: number; txSpeed: number }[] } | null, dir: 'rx' | 'tx') {
  if (!network) return 0;
  return network.interfaces.reduce((sum, i) => sum + (dir === 'rx' ? i.rxSpeed : i.txSpeed), 0);
}

export default function Dashboard({ setTab }: { setTab?: (tab: string) => void }) {
  const { data: overview, refresh: refreshOverview } = useOverview(3000);
  const { data: network } = useNetwork(1000);
  const { data: containers } = useContainers(5000);
  const { data: services } = useServices(30000);
  const { data: history } = useHistory(1000);

  const csum = containerSummary(containers);
  const ssum = serviceSummary(services);
  const cpuData = toSparkData(history, 'cpu');
  const memData = toSparkData(history, 'memory');
  const netRxData = toSparkData(history, 'networkRx');
  const netTxData = toSparkData(history, 'networkTx');

  const topContainers = (containers || [])
    .slice(0, 5)
    .sort((a, b) => (b.memory || 0) - (a.memory || 0));

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <ActionPill icon={RefreshCw} label="Refresh" onClick={refreshOverview} />
        <ActionPill icon={Download} label="Export report" />
        <ActionPill icon={AlertTriangle} label="View alerts" />
        <ActionPill icon={Settings} label="Settings" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="CPU Usage"
          value={overview ? `${overview.cpu.usage.toFixed(1)}%` : '—'}
          sub={overview ? `${overview.cpu.cores} cores · load ${overview.cpu.load.map((l) => l.toFixed(2)).join(', ')}` : ''}
          icon={<Cpu size={20} />}
        >
          {cpuData.length > 1 && (
            <Sparkline data={cpuData} color="#0f0f11" fill="#0f0f11" height={50} />
          )}
        </KpiCard>

        <KpiCard
          title="Memory Usage"
          value={overview ? `${overview.memory.percent.toFixed(1)}%` : '—'}
          sub={overview ? `${overview.memory.usedHuman} / ${overview.memory.totalHuman}` : ''}
          icon={<MemoryStick size={20} />}
        >
          {memData.length > 1 && (
            <Sparkline data={memData} color="#22c55e" fill="#22c55e" height={50} />
          )}
        </KpiCard>

        <KpiCard
          title="Disk Usage"
          value={overview ? `${overview.disk.percent.toFixed(1)}%` : '—'}
          sub={overview ? `${overview.disk.usedHuman} / ${overview.disk.totalHuman}` : ''}
          icon={<HardDrive size={20} />}
        >
          {overview && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${overview.disk.percent}%` }}
              />
            </div>
          )}
        </KpiCard>

        <KpiCard
          title="Uptime"
          value={overview ? formatUptime(overview.uptime) : '—'}
          sub="Time since boot"
          icon={<Clock size={20} />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <KpiCard
          title="Network Download"
          value={
            network
              ? `${(netTotal(network, 'rx') * 8 / 1_000_000).toFixed(2)} Mbps`
              : '—'
          }
          sub="Live throughput"
          icon={<ArrowDown size={20} />}
        >
          {netRxData.length > 1 && (
            <Sparkline data={netRxData} color="#3b82f6" fill="#3b82f6" height={50} />
          )}
        </KpiCard>

        <KpiCard
          title="Network Upload"
          value={
            network
              ? `${(netTotal(network, 'tx') * 8 / 1_000_000).toFixed(2)} Mbps`
              : '—'
          }
          sub="Live throughput"
          icon={<ArrowUp size={20} />}
        >
          {netTxData.length > 1 && (
            <Sparkline data={netTxData} color="#8b5cf6" fill="#8b5cf6" height={50} />
          )}
        </KpiCard>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted">Active Interfaces</span>
            <Activity size={18} className="text-muted" />
          </div>
          <div className="mt-4 space-y-3">
            {network?.interfaces.slice(0, 3).map((iface) => (
              <div key={iface.name} className="flex items-center justify-between text-sm">
                <span className="font-medium">{iface.name}</span>
                <span className="text-muted">
                  ↓ {iface.rxSpeedHuman} · ↑ {iface.txSpeedHuman}
                </span>
              </div>
            )) || <span className="text-sm text-muted">No interfaces</span>}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Containers</h3>
              <p className="text-sm text-muted">
                {csum.running} of {csum.total} running
              </p>
            </div>
            <button
              onClick={() => setTab?.('containers')}
              className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink/90 dark:bg-accent dark:text-ink"
            >
              View all
            </button>
          </div>
          <div className="space-y-3">
            {topContainers.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Box size={16} className="text-muted" />
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted">{c.image}</p>
                  </div>
                </div>
                <StatusBadge state={c.state} />
              </div>
            ))}
            {!topContainers.length && (
              <p className="text-sm text-muted">No containers running</p>
            )}
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">System Services</h3>
              <p className="text-sm text-muted">
                {ssum.active} active · {ssum.failed} failed
              </p>
            </div>
            <button
              onClick={() => setTab?.('services')}
              className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink/90 dark:bg-accent dark:text-ink"
            >
              View all
            </button>
          </div>
          {ssum.total > 0 ? (
            <MiniBar
              data={[
                ssum.active,
                ssum.failed,
                ssum.total - ssum.active - ssum.failed,
              ]}
              color="#0f0f11"
            />
          ) : (
            <p className="text-sm text-muted">Loading services…</p>
          )}
          <div className="mt-4 flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Active
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              Failed
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Other
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
