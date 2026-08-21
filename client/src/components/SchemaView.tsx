import { Loader2, KeyRound } from 'lucide-react';
import { useTableSchema } from '../hooks/useApi';
import { cn } from '../lib/utils';

interface SchemaViewProps {
  containerId: string;
  dbName: string;
  tableName: string;
}

export default function SchemaView({ containerId, dbName, tableName }: SchemaViewProps) {
  const { data, loading, error } = useTableSchema(containerId, dbName, tableName);

  if (loading && !data) {
    return <div className="flex items-center gap-2 p-8 text-muted"><Loader2 size={16} className="animate-spin" /> Loading schema…</div>;
  }

  if (error) {
    return <div className="p-8 text-red-500">Error: {error}</div>;
  }

  if (!data || data.length === 0) {
    return <div className="p-8 text-center text-muted">No schema information available.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-black/5 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.02]">
          <tr className="text-muted">
            <th className="px-4 py-2.5 font-medium">Column</th>
            <th className="px-4 py-2.5 font-medium">Type</th>
            <th className="px-4 py-2.5 font-medium">Nullable</th>
            <th className="px-4 py-2.5 font-medium">Default</th>
            <th className="px-4 py-2.5 font-medium">Key</th>
          </tr>
        </thead>
        <tbody>
          {data.map((col) => (
            <tr
              key={col.name}
              className="border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
            >
              <td className="px-4 py-2 font-medium">
                <div className="flex items-center gap-2">
                  {col.isPrimaryKey && <KeyRound size={12} className="text-accent" />}
                  {col.name}
                </div>
              </td>
              <td className="px-4 py-2">
                <code className="rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">
                  {col.dataType}
                </code>
              </td>
              <td className="px-4 py-2">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    col.nullable
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  )}
                >
                  {col.nullable ? 'YES' : 'NO'}
                </span>
              </td>
              <td className="px-4 py-2">
                {col.defaultValue ? (
                  <code className="font-mono text-xs text-muted">{col.defaultValue}</code>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className="px-4 py-2">
                {col.isPrimaryKey ? (
                  <span className="rounded-full bg-accent/30 px-2 py-0.5 text-xs font-bold text-ink">
                    PK
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
