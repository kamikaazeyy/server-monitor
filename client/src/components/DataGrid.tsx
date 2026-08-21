import { useState } from 'react';
import { RefreshCw, Loader2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { useTableData } from '../hooks/useApi';
import { cn } from '../lib/utils';

interface DataGridProps {
  containerId: string;
  dbName: string;
  tableName: string;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function isNull(value: unknown): boolean {
  return value === null || value === undefined;
}

const PAGE_SIZES = [25, 50, 100, 250];

export default function DataGrid({ containerId, dbName, tableName }: DataGridProps) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const { data, loading, error, refresh } = useTableData(
    containerId, dbName, tableName, page, limit, sortCol, sortDir
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.totalRows / data.limit)) : 1;

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
  };

  if (loading && !data) {
    return <div className="flex items-center gap-2 p-8 text-muted"><Loader2 size={16} className="animate-spin" /> Loading data…</div>;
  }

  if (error) {
    return <div className="p-8 text-red-500">Error: {error}</div>;
  }

  if (!data || data.rows.length === 0) {
    return (
      <div className="p-8 text-center text-muted">
        No rows in this table.
        <button onClick={refresh} className="mt-3 block mx-auto text-sm text-blue-500 hover:underline">
          Refresh
        </button>
      </div>
    );
  }

  const columns = data.columns.length > 0
    ? data.columns
    : Object.keys(data.rows[0]).map(name => ({ name, dataType: 'unknown', nullable: true, defaultValue: null, isPrimaryKey: false }));

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-black/5 px-4 py-2 dark:border-white/10">
        <div className="flex items-center gap-3 text-sm text-muted">
          <span>{data.totalRows.toLocaleString()} rows</span>
          <span>·</span>
          <span>Page {page} of {totalPages}</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={limit}
            onChange={(e) => handleLimitChange(parseInt(e.target.value, 10))}
            className="rounded-lg border border-black/10 bg-surface px-2 py-1 text-xs dark:border-white/10 dark:bg-surface-dark"
          >
            {PAGE_SIZES.map(s => <option key={s} value={s}>{s} / page</option>)}
          </select>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1.5 text-xs font-medium text-muted hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Data table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-black/5 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.02]">
            <tr className="text-muted">
              {columns.map((col) => (
                <th
                  key={col.name}
                  onClick={() => handleSort(col.name)}
                  className="cursor-pointer select-none px-4 py-2.5 font-medium hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <div className="flex items-center gap-1.5">
                    {col.isPrimaryKey && (
                      <span className="rounded bg-accent/30 px-1 text-[10px] font-bold text-ink">PK</span>
                    )}
                    <span>{col.name}</span>
                    <span className="text-[10px] opacity-50">{col.dataType}</span>
                    {sortCol === col.name ? (
                      sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                    ) : (
                      <ArrowUpDown size={12} className="opacity-30" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
              >
                {columns.map((col) => {
                  const value = row[col.name];
                  return (
                    <td key={col.name} className="px-4 py-2">
                      <span
                        className={cn(
                          'font-mono text-xs',
                          isNull(value) && 'text-muted italic',
                          typeof value === 'number' && 'text-blue-600 dark:text-blue-400',
                          typeof value === 'boolean' && 'text-purple-600 dark:text-purple-400'
                        )}
                      >
                        {formatCell(value)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-2 border-t border-black/5 px-4 py-3 dark:border-white/10">
        <button
          onClick={() => setPage(1)}
          disabled={page === 1}
          className="rounded-lg px-3 py-1 text-xs font-medium text-muted hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
        >
          First
        </button>
        <button
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page === 1}
          className="rounded-lg px-3 py-1 text-xs font-medium text-muted hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
        >
          ◀ Prev
        </button>
        <span className="px-3 text-xs text-muted">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
          className="rounded-lg px-3 py-1 text-xs font-medium text-muted hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
        >
          Next ▶
        </button>
        <button
          onClick={() => setPage(totalPages)}
          disabled={page === totalPages}
          className="rounded-lg px-3 py-1 text-xs font-medium text-muted hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
        >
          Last
        </button>
      </div>
    </div>
  );
}
