import { useProjects } from '../hooks/useApi';
import StatusBadge from './StatusBadge';

export default function Projects() {
  const { data, loading } = useProjects(5000);

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
                  <StatusBadge state={c.state} />
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
