import { useState } from 'react';
import { Table2, FileCode, Database as DatabaseIcon } from 'lucide-react';
import DbTree from './DbTree';
import DataGrid from './DataGrid';
import SchemaView from './SchemaView';
import { cn } from '../lib/utils';

type PanelTab = 'data' | 'schema';

export default function Database() {
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('data');

  const handleSelectTable = (containerId: string, dbName: string, tableName: string) => {
    setSelectedContainer(containerId);
    setSelectedDb(dbName);
    setSelectedTable(tableName);
    setPanelTab('data');
  };

  return (
    <div className="flex h-full">
      {/* Left: DB Tree */}
      <div className="hidden w-72 shrink-0 border-r border-black/5 bg-surface dark:border-white/10 dark:bg-surface-dark md:block">
        <DbTree
          selectedContainer={selectedContainer}
          selectedDb={selectedDb}
          selectedTable={selectedTable}
          onSelectTable={handleSelectTable}
        />
      </div>

      {/* Mobile tree (collapsible) */}
      <div className="absolute left-0 top-0 z-30 h-full w-72 border-r border-black/5 bg-surface dark:border-white/10 dark:bg-surface-dark md:hidden">
        <DbTree
          selectedContainer={selectedContainer}
          selectedDb={selectedDb}
          selectedTable={selectedTable}
          onSelectTable={handleSelectTable}
        />
      </div>

      {/* Right: Data / Schema panel */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selectedTable ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
                <DatabaseIcon size={28} className="text-muted" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Select a table</h3>
              <p className="mt-1 text-sm text-muted">
                Choose a database container → database → table from the sidebar to view its data.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Table header + tabs */}
            <div className="border-b border-black/5 px-4 py-3 dark:border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{selectedTable}</h2>
                  <p className="text-xs text-muted">
                    {selectedDb} · {(selectedContainer || '').slice(0, 12)}
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-black/5 p-1 dark:bg-white/10">
                  <button
                    onClick={() => setPanelTab('data')}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                      panelTab === 'data'
                        ? 'bg-surface text-ink shadow-sm dark:bg-surface-dark dark:text-white'
                        : 'text-muted hover:text-ink dark:hover:text-white'
                    )}
                  >
                    <Table2 size={14} />
                    Data
                  </button>
                  <button
                    onClick={() => setPanelTab('schema')}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                      panelTab === 'schema'
                        ? 'bg-surface text-ink shadow-sm dark:bg-surface-dark dark:text-white'
                        : 'text-muted hover:text-ink dark:hover:text-white'
                    )}
                  >
                    <FileCode size={14} />
                    Schema
                  </button>
                </div>
              </div>
            </div>

            {/* Panel content */}
            <div className="flex-1 overflow-auto">
              {panelTab === 'data' && selectedContainer && selectedDb && selectedTable && (
                <DataGrid
                  containerId={selectedContainer}
                  dbName={selectedDb}
                  tableName={selectedTable}
                />
              )}
              {panelTab === 'schema' && selectedContainer && selectedDb && selectedTable && (
                <SchemaView
                  containerId={selectedContainer}
                  dbName={selectedDb}
                  tableName={selectedTable}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
