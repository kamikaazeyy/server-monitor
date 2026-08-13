import { useGitHub } from '../hooks/useApi';
import StatusBadge from './StatusBadge';

export default function GitHubCI() {
  const { data, loading } = useGitHub(60000);

  if (loading && !data) {
    return <div className="p-8 text-muted">Loading GitHub data…</div>;
  }

  if (data?.error) {
    return <div className="p-8 text-red-500">GitHub error: {data.error}</div>;
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h2 className="mb-4 text-xl font-semibold">Pull Requests</h2>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/5 dark:border-white/10">
                <tr className="text-muted">
                  <th className="px-5 py-3 font-medium">#</th>
                  <th className="px-5 py-3 font-medium">Title</th>
                  <th className="px-5 py-3 font-medium">Branch</th>
                  <th className="px-5 py-3 font-medium">State</th>
                  <th className="px-5 py-3 font-medium">Checks</th>
                </tr>
              </thead>
              <tbody>
                {data?.pulls.map((pr) => (
                  <tr
                    key={pr.number}
                    className="border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-3">
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        #{pr.number}
                      </a>
                    </td>
                    <td className="px-5 py-3 font-medium">{pr.title}</td>
                    <td className="px-5 py-3 text-muted">{pr.branch}</td>
                    <td className="px-5 py-3">
                      <StatusBadge state={pr.state} />
                    </td>
                    <td className="px-5 py-3 text-muted">{pr.checks}</td>
                  </tr>
                ))}
                {!data?.pulls.length && (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-center text-muted">
                      No pull requests
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-xl font-semibold">CI / CD Runs</h2>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/5 dark:border-white/10">
                <tr className="text-muted">
                  <th className="px-5 py-3 font-medium">Workflow</th>
                  <th className="px-5 py-3 font-medium">Branch</th>
                  <th className="px-5 py-3 font-medium">Event</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.runs.map((run) => (
                  <tr
                    key={run.url}
                    className="border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-3">
                      <a
                        href={run.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {run.name}
                      </a>
                    </td>
                    <td className="px-5 py-3 text-muted">{run.branch}</td>
                    <td className="px-5 py-3 text-muted">{run.event}</td>
                    <td className="px-5 py-3">
                      <StatusBadge state={run.status} />
                    </td>
                  </tr>
                ))}
                {!data?.runs.length && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted">
                      No workflow runs
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
