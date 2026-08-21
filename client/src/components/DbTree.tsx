import { useState } from 'react';
import { Database, ChevronRight, ChevronDown, Table2, Eye, Loader2 } from 'lucide-react';
import { useDbContainers, useDatabases, useTables } from '../hooks/useApi';
import { cn } from '../lib/utils';
import type { DbContainer } from '../types';

interface DbTreeProps {
  selectedContainer: string | null;
  selectedDb: string | null;
  selectedTable: string | null;
  onSelectTable: (containerId: string, dbName: string, tableName: string) => void;
}

function typeIcon(_type: string) {
  // All use Database icon for now; can differentiate per type later
  return <Database size={16} />;
}

function ContainerNode({
  container,
  selectedContainer,
  selectedDb,
  selectedTable,
  onSelectTable,
}: {
  container: DbContainer;
  selectedContainer: string | null;
  selectedDb: string | null;
  selectedTable: string | null;
  onSelectTable: (containerId: string, dbName: string, tableName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: databases, loading: dbLoading } = useDatabases(
    expanded ? container.containerId : null
  );

  const statusColor =
    container.status === 'connected'
      ? 'text-emerald-500'
      : container.status === 'error'
      ? 'text-red-500'
      : 'text-amber-500';

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
      >
        {expanded ? (
          <ChevronDown size={14} className="shrink-0 text-muted" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-muted" />
        )}
        <span className="shrink-0">{typeIcon(container.type)}</span>
        <span className="truncate flex-1">{container.containerName}</span>
        <span className={cn('h-2 w-2 shrink-0 rounded-full', statusColor.replace('text-', 'bg-'))} />
      </button>

      {expanded && (
        <div className="ml-4 border-l border-black/5 dark:border-white/10">
          {dbLoading && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" />
              Loading databases…
            </div>
          )}
          {container.error && (
            <div className="px-3 py-1.5 text-xs text-red-500">{container.error}</div>
          )}
          {databases?.map((dbName) => (
            <DatabaseNode
              key={dbName}
              containerId={container.containerId}
              dbName={dbName}
              selectedDb={selectedDb}
              selectedTable={selectedTable}
              selectedContainer={selectedContainer}
              onSelectTable={onSelectTable}
            />
          ))}
          {!dbLoading && databases && databases.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-muted">No databases</div>
          )}
        </div>
      )}
    </div>
  );
}

function DatabaseNode({
  containerId,
  dbName,
  selectedDb,
  selectedTable,
  selectedContainer,
  onSelectTable,
}: {
  containerId: string;
  dbName: string;
  selectedDb: string | null;
  selectedTable: string | null;
  selectedContainer: string | null;
  onSelectTable: (containerId: string, dbName: string, tableName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: tables, loading: tblLoading } = useTables(
    expanded ? containerId : null,
    expanded ? dbName : null
  );

  const isActive = selectedContainer === containerId && selectedDb === dbName;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10',
          isActive && 'font-medium'
        )}
      >
        {expanded ? (
          <ChevronDown size={14} className="shrink-0 text-muted" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-muted" />
        )}
        <Database size={14} className="shrink-0 text-muted" />
        <span className="truncate flex-1">{dbName}</span>
      </button>

      {expanded && (
        <div className="ml-4 border-l border-black/5 dark:border-white/10">
          {tblLoading && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" />
              Loading tables…
            </div>
          )}
          {tables?.map((t) => (
            <button
              key={t.name}
              onClick={() => onSelectTable(containerId, dbName, t.name)}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10',
                selectedContainer === containerId &&
                  selectedDb === dbName &&
                  selectedTable === t.name &&
                  'bg-accent/20 font-medium'
              )}
            >
              {t.type === 'view' ? (
                <Eye size={14} className="shrink-0 text-muted" />
              ) : (
                <Table2 size={14} className="shrink-0 text-muted" />
              )}
              <span className="truncate flex-1">{t.name}</span>
              <span className="shrink-0 text-xs text-muted">
                {t.rowEstimate > 0 ? `~${t.rowEstimate}` : ''}
              </span>
            </button>
          ))}
          {!tblLoading && tables && tables.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-muted">No tables</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DbTree({
  selectedContainer,
  selectedDb,
  selectedTable,
  onSelectTable,
}: DbTreeProps) {
  const { data: containers, loading, error } = useDbContainers(15000);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-black/5 px-4 py-3 dark:border-white/10">
        <h3 className="text-sm font-semibold">Databases</h3>
        <p className="text-xs text-muted">Auto-discovered from Docker</p>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading && !containers && (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" />
            Scanning containers…
          </div>
        )}
        {error && (
          <div className="px-2 py-3 text-sm text-red-500">{error}</div>
        )}
        {containers?.map((c) => (
          <ContainerNode
            key={c.containerId}
            container={c}
            selectedContainer={selectedContainer}
            selectedDb={selectedDb}
            selectedTable={selectedTable}
            onSelectTable={onSelectTable}
          />
        ))}
        {!loading && containers && containers.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-muted">
            No database containers found.
            <p className="mt-1 text-xs">
              Start a Postgres/MySQL/Mongo container and it will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
