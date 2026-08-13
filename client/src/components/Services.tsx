import { useServices } from '../hooks/useApi';
import StatusBadge from './StatusBadge';

export default function Services() {
  const { data, loading } = useServices(30000);

  if (loading && !data) {
    return <div className="p-8 text-muted">Loading services…</div>;
  }

  return (
    <div className="p-6 md:p-8">
      <h2 className="mb-4 text-xl font-semibold">System Services</h2>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-black/5 dark:border-white/10">
              <tr className="text-muted">
                <th className="px-5 py-3 font-medium">Unit</th>
                <th className="px-5 py-3 font-medium">State</th>
                <th className="px-5 py-3 font-medium">Sub</th>
                <th className="px-5 py-3 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((s) => (
                <tr
                  key={s.unit}
                  className="border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                >
                  <td className="px-5 py-3 font-medium">{s.unit}</td>
                  <td className="px-5 py-3">
                    <StatusBadge state={s.state} />
                  </td>
                  <td className="px-5 py-3 text-muted">{s.sub}</td>
                  <td className="px-5 py-3 text-muted">{s.description}</td>
                </tr>
              ))}
              {!data?.length && (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-muted">
                    No services loaded
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
