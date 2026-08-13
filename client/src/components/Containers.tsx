import { useContainers } from '../hooks/useApi';
import StatusBadge from './StatusBadge';

export default function Containers() {
  const { data, loading } = useContainers(5000);

  if (loading && !data) {
    return <div className="p-8 text-muted">Loading containers…</div>;
  }

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
                </tr>
              ))}
              {!data?.length && (
                <tr>
                  <td colSpan={8} className="px-5 py-6 text-center text-muted">
                    No containers running
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
