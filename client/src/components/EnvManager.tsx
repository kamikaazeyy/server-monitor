import { useEffect, useState } from 'react';
import {
  KeyRound,
  Plus,
  Trash2,
  Pencil,
  Eye,
  EyeOff,
  Copy,
  Download,
  FileUp,
  X,
  Check,
  Lock,
  FolderPlus,
  Box,
  RefreshCw,
  FileSearch,
  FileKey2,
} from 'lucide-react';
import {
  useEnvProjects,
  useEnvVars,
  createEnvProject,
  deleteEnvProject,
  upsertEnvVar,
  deleteEnvVar,
  importEnvVars,
  importEnvFile,
  exportEnvProject,
  useEnvContainers,
  useEnvScan,
  fetchContainerEnvVars,
} from '../hooks/useApi';
import { cn } from '../lib/utils';
import type { EnvProject, EnvVar, ContainerEnvVar, EnvDirGroup } from '../types';

function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}

function toDotenv(vars: { key: string; value: string }[]): string {
  return vars
    .map((v) => {
      const needsQuote = v.value === '' || /[\s#"'$`\\]/.test(v.value);
      const val = needsQuote
        ? `"${v.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
        : v.value;
      return `${v.key}=${val}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={cn('card max-h-[85vh] w-full overflow-y-auto p-6', wide ? 'max-w-2xl' : 'max-w-md')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-black/5 dark:hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NewProjectModal({
  discovered,
  onClose,
  onCreated,
}: {
  discovered: { name: string; containers: number }[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [composeProject, setComposeProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createEnvProject({
        name: name.trim(),
        description: description.trim(),
        composeProject: composeProject.trim() || undefined,
      });
      onCreated(created.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New project" onClose={onClose}>
      <div className="space-y-3">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name (e.g. fitso-api)"
          className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-white/15"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-white/15"
        />
        <div>
          <input
            value={composeProject}
            onChange={(e) => setComposeProject(e.target.value)}
            placeholder="Link docker-compose project (optional)"
            list="compose-projects"
            className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-white/15"
          />
          <datalist id="compose-projects">
            {discovered.map((d) => (
              <option key={d.name} value={d.name} />
            ))}
          </datalist>
          <p className="mt-1 text-xs text-muted">
            Linking a compose project groups containers under this env space.
          </p>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          onClick={submit}
          disabled={busy || !name.trim()}
          className="pill pill-accent w-full justify-center disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </Modal>
  );
}

function ImportModal({
  projectId,
  onClose,
  onDone,
}: {
  projectId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [content, setContent] = useState('');
  const [markSecrets, setMarkSecrets] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await importEnvVars(projectId, content, markSecrets);
      setResult(`Imported ${res.added} new, updated ${res.updated}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Import .env" onClose={onClose} wide>
      <div className="space-y-3">
        <textarea
          autoFocus
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={'Paste your .env file here, e.g.\nDATABASE_URL=postgres://…\nAPI_KEY=…'}
          rows={10}
          spellCheck={false}
          className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-accent dark:border-white/15"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={markSecrets}
            onChange={(e) => setMarkSecrets(e.target.checked)}
            className="h-4 w-4 accent-[#dfff4f]"
          />
          Auto-mark keys containing SECRET / TOKEN / PASSWORD / KEY as secrets
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        {result && <p className="text-sm text-success">{result}</p>}
        <button
          onClick={submit}
          disabled={busy || !content.trim()}
          className="pill pill-accent w-full justify-center disabled:opacity-50"
        >
          {busy ? 'Importing…' : 'Import variables'}
        </button>
      </div>
    </Modal>
  );
}

function PullModal({
  projectId,
  onClose,
  onDone,
}: {
  projectId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: containers, loading } = useEnvContainers();
  const [selected, setSelected] = useState<string | null>(null);
  const [vars, setVars] = useState<ContainerEnvVar[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const loadVars = async (name: string) => {
    setSelected(name);
    setVars(null);
    setError(null);
    try {
      const list = await fetchContainerEnvVars(name);
      setVars(list);
      setChecked(new Set(list.map((v) => v.key)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load env vars');
    }
  };

  const importSelected = async () => {
    if (!vars) return;
    const chosen = vars.filter((v) => checked.has(v.key));
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importEnvVars(projectId, toDotenv(chosen), true);
      setResult(`Imported ${res.added} new, updated ${res.updated}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Pull env from container" onClose={onClose} wide>
      {!selected ? (
        <div className="space-y-2">
          {loading && <p className="text-sm text-muted">Loading containers…</p>}
          {containers?.map((c) => (
            <button
              key={c.name}
              onClick={() => loadVars(c.name)}
              className="flex w-full items-center justify-between rounded-2xl bg-black/[0.03] p-3 text-left transition-colors hover:bg-black/[0.06] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
            >
              <div className="flex items-center gap-3">
                <Box size={18} className="shrink-0 text-muted" />
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted">{c.image}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {c.project && <span className="pill pill-muted text-xs">{c.project}</span>}
                <span className="pill pill-muted text-xs">{c.envCount} vars</span>
              </div>
            </button>
          ))}
          {containers && !containers.length && (
            <p className="text-sm text-muted">No containers found on this host.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <button onClick={() => { setSelected(null); setVars(null); setResult(null); }} className="text-sm text-muted hover:text-ink dark:hover:text-white">
              ← {selected}
            </button>
            {vars && (
              <button
                onClick={() => setChecked(checked.size === vars.length ? new Set() : new Set(vars.map((v) => v.key)))}
                className="text-xs font-medium text-muted hover:text-ink dark:hover:text-white"
              >
                {checked.size === vars.length ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>
          {!vars && !error && <p className="text-sm text-muted">Inspecting container…</p>}
          {vars && (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {vars.map((v) => (
                <label key={v.key} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]">
                  <input
                    type="checkbox"
                    checked={checked.has(v.key)}
                    onChange={(e) => {
                      const next = new Set(checked);
                      if (e.target.checked) next.add(v.key);
                      else next.delete(v.key);
                      setChecked(next);
                    }}
                    className="h-4 w-4 shrink-0 accent-[#dfff4f]"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{v.key}</span>
                  {v.secret && <Lock size={12} className="shrink-0 text-warning" />}
                </label>
              ))}
              {!vars.length && <p className="text-sm text-muted">No importable env vars on this container.</p>}
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          {result && <p className="text-sm text-success">{result}</p>}
          <button
            onClick={importSelected}
            disabled={busy || !checked.size}
            className="pill pill-accent w-full justify-center disabled:opacity-50"
          >
            {busy ? 'Importing…' : `Import ${checked.size} selected`}
          </button>
        </div>
      )}
    </Modal>
  );
}

function ScanModal({
  projectId,
  onClose,
  onDone,
}: {
  projectId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: groups, loading, error } = useEnvScan();
  const [results, setResults] = useState<Record<string, string>>({});

  const importFile = async (filePath: string) => {
    setResults((r) => ({ ...r, [filePath]: 'importing…' }));
    try {
      const res = await importEnvFile(projectId, filePath, true);
      setResults((r) => ({ ...r, [filePath]: `✓ ${res.added} new, ${res.updated} updated` }));
      onDone();
    } catch (e) {
      setResults((r) => ({ ...r, [filePath]: `✗ ${e instanceof Error ? e.message : 'failed'}` }));
    }
  };

  return (
    <Modal title="Import .env from this server" onClose={onClose} wide>
      {loading && <p className="text-sm text-muted">Scanning for .env files…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="space-y-3">
        {groups?.map((g) => (
          <div key={g.dir}>
            <p className="mb-1 truncate text-xs font-medium text-muted" title={g.dir}>{g.dir}</p>
            <div className="space-y-1">
              {g.files.map((f) => (
                <div
                  key={f.path}
                  className="flex items-center justify-between gap-2 rounded-xl bg-black/[0.03] px-3 py-2 dark:bg-white/[0.05]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileKey2 size={14} className="shrink-0 text-muted" />
                    <span className="truncate font-mono text-xs">{f.path.split('/').pop()}</span>
                  </div>
                  {results[f.path] ? (
                    <span className={cn('shrink-0 text-xs', results[f.path].startsWith('✗') ? 'text-danger' : 'text-success')}>
                      {results[f.path]}
                    </span>
                  ) : (
                    <button
                      onClick={() => importFile(f.path)}
                      className="pill pill-muted shrink-0 px-2.5 py-1 text-xs hover:bg-accent hover:text-ink"
                    >
                      Import
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {groups && !groups.length && !loading && (
          <p className="text-sm text-muted">No .env files found under the configured scan roots.</p>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Variable row
// ---------------------------------------------------------------------------

function VarRow({
  projectId,
  v,
  onChanged,
}: {
  projectId: string;
  v: EnvVar;
  onChanged: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(v.value);
  const [secret, setSecret] = useState(v.secret);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await upsertEnvVar(projectId, { key: v.key, value, secret });
      setEditing(false);
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${v.key}?`)) return;
    setBusy(true);
    try {
      await deleteEnvVar(projectId, v.key);
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const masked = v.secret && !revealed;

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-black/[0.03] p-3 dark:bg-white/[0.05]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-mono text-sm font-medium">{v.key}</p>
          {v.secret && <Lock size={12} className="shrink-0 text-warning" />}
        </div>
        {editing ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-black/10 bg-surface px-2 py-1 font-mono text-xs outline-none focus:border-accent dark:border-white/15 dark:bg-surface-dark"
            />
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
              <input
                type="checkbox"
                checked={secret}
                onChange={(e) => setSecret(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#dfff4f]"
              />
              Secret
            </label>
          </div>
        ) : (
          <p
            className={cn(
              'mt-0.5 truncate font-mono text-xs text-muted',
              masked && 'cursor-pointer select-none'
            )}
            onClick={() => masked && setRevealed(true)}
            title={masked ? 'Click to reveal' : undefined}
          >
            {masked ? '••••••••••••' : v.value || <span className="italic">empty</span>}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <button onClick={save} disabled={busy} className="rounded-lg p-1.5 text-success hover:bg-black/5 dark:hover:bg-white/10" title="Save">
              <Check size={16} />
            </button>
            <button onClick={() => { setEditing(false); setValue(v.value); setSecret(v.secret); }} className="rounded-lg p-1.5 text-muted hover:bg-black/5 dark:hover:bg-white/10" title="Cancel">
              <X size={16} />
            </button>
          </>
        ) : (
          <>
            {v.secret && (
              <button onClick={() => setRevealed(!revealed)} className="rounded-lg p-1.5 text-muted hover:bg-black/5 dark:hover:bg-white/10" title={revealed ? 'Hide' : 'Reveal'}>
                {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            )}
            <button onClick={() => copyText(v.value)} className="rounded-lg p-1.5 text-muted hover:bg-black/5 dark:hover:bg-white/10" title="Copy value">
              <Copy size={16} />
            </button>
            <button onClick={() => setEditing(true)} className="rounded-lg p-1.5 text-muted hover:bg-black/5 dark:hover:bg-white/10" title="Edit">
              <Pencil size={16} />
            </button>
            <button onClick={remove} disabled={busy} className="rounded-lg p-1.5 text-danger hover:bg-black/5 dark:hover:bg-white/10" title="Delete">
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vars panel for the selected project
// ---------------------------------------------------------------------------

function VarsPanel({ project, onChanged }: { project: EnvProject; onChanged: () => void }) {
  const { data: vars, loading, refresh } = useEnvVars(project.id);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newSecret, setNewSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  const changed = () => {
    refresh();
    onChanged();
  };

  const addVar = async () => {
    if (!newKey.trim()) return;
    setBusy(true);
    try {
      await upsertEnvVar(project.id, { key: newKey.trim(), value: newValue, secret: newSecret });
      setNewKey('');
      setNewValue('');
      setNewSecret(false);
      changed();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add variable');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Add variable */}
      <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-dashed border-black/15 p-3 dark:border-white/15 sm:flex-row sm:items-center">
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value.toUpperCase())}
          placeholder="KEY"
          spellCheck={false}
          className="w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 font-mono text-sm outline-none focus:border-accent dark:border-white/15 sm:w-48"
        />
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="value"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 font-mono text-sm outline-none focus:border-accent dark:border-white/15"
        />
        <div className="flex items-center gap-2">
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={newSecret}
              onChange={(e) => setNewSecret(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#dfff4f]"
            />
            Secret
          </label>
          <button
            onClick={addVar}
            disabled={busy || !newKey.trim()}
            className="pill pill-accent shrink-0 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {/* Vars list */}
      {loading && !vars && <p className="text-sm text-muted">Loading variables…</p>}
      <div className="space-y-2">
        {vars?.map((v) => (
          <VarRow key={v.key} projectId={project.id} v={v} onChanged={changed} />
        ))}
      </div>
      {vars && !vars.length && (
        <p className="py-8 text-center text-sm text-muted">
          No variables yet — add one above, import a .env file, or pull from a container.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function EnvManager() {
  const { data, loading, error, refresh } = useEnvProjects(30000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<'new' | 'import' | 'pull' | 'scan' | null>(null);
  const [varsEpoch, setVarsEpoch] = useState(0);

  const refreshAll = () => {
    refresh();
    setVarsEpoch((e) => e + 1);
  };

  const projects = data?.projects ?? [];
  const discovered = data?.discovered ?? [];
  const envDirs = data?.envDirs ?? [];
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    const first = data?.projects?.[0];
    if (!selectedId && first) setSelectedId(first.id);
  }, [data, selectedId]);

  const removeProject = async (p: EnvProject) => {
    if (!confirm(`Delete project "${p.name}" and all its stored variables?`)) return;
    try {
      await deleteEnvProject(p.id);
      if (selectedId === p.id) setSelectedId(null);
      refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const quickCreate = async (name: string) => {
    try {
      const created = await createEnvProject({ name, composeProject: name });
      setSelectedId(created.id);
      refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create project');
    }
  };

  const quickCreateFromDir = async (g: EnvDirGroup) => {
    try {
      const created = await createEnvProject({ name: g.name, description: g.dir });
      for (const f of g.files) {
        await importEnvFile(created.id, f.path, true);
      }
      setSelectedId(created.id);
      refreshAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create project');
    }
  };

  const projectList = (
    <div className="space-y-2">
      {projects.map((p) => (
        <button
          key={p.id}
          onClick={() => setSelectedId(p.id)}
          className={cn(
            'w-full rounded-2xl p-3 text-left transition-colors',
            selectedId === p.id
              ? 'bg-accent/20 ring-1 ring-accent'
              : 'bg-black/[0.03] hover:bg-black/[0.06] dark:bg-white/[0.05] dark:hover:bg-white/[0.08]'
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">{p.name}</p>
            {p.composeProject && (
              <span className="pill pill-muted shrink-0 px-2 py-0.5 text-[10px]">{p.composeProject}</span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            {p.varCount} var{p.varCount === 1 ? '' : 's'}
            {p.secretCount > 0 && ` · ${p.secretCount} secret${p.secretCount === 1 ? '' : 's'}`}
          </p>
        </button>
      ))}
      {(discovered.length > 0 || envDirs.length > 0) && (
        <div className="pt-2">
          <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted">
            Detected on host
          </p>
          {discovered.map((d) => (
            <div
              key={d.name}
              className="mb-2 flex items-center justify-between rounded-2xl border border-dashed border-black/15 p-3 dark:border-white/15"
            >
              <div>
                <p className="text-sm font-medium">{d.name}</p>
                <p className="text-xs text-muted">{d.containers} container{d.containers === 1 ? '' : 's'}</p>
              </div>
              <button
                onClick={() => quickCreate(d.name)}
                className="pill pill-muted px-2.5 py-1 text-xs hover:bg-accent hover:text-ink"
              >
                <Plus size={12} /> Create
              </button>
            </div>
          ))}
          {envDirs.map((g) => (
            <div
              key={g.dir}
              className="mb-2 flex items-center justify-between gap-2 rounded-2xl border border-dashed border-black/15 p-3 dark:border-white/15"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{g.name}</p>
                <p className="truncate text-xs text-muted" title={g.dir}>
                  {g.files.length} .env file{g.files.length === 1 ? '' : 's'} · {g.dir}
                </p>
              </div>
              <button
                onClick={() => quickCreateFromDir(g)}
                className="pill pill-muted shrink-0 px-2.5 py-1 text-xs hover:bg-accent hover:text-ink"
                title="Create project and import its .env files"
              >
                <Plus size={12} /> Import
              </button>
            </div>
          ))}
        </div>
      )}
      {!projects.length && !discovered.length && !envDirs.length && !loading && (
        <p className="px-1 py-4 text-sm text-muted">No projects yet. Create one to get started.</p>
      )}
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Left: project list (desktop) */}
      <div className="hidden w-72 shrink-0 flex-col border-r border-black/5 bg-surface dark:border-white/10 dark:bg-surface-dark md:flex">
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/10">
          <h2 className="text-sm font-semibold">Env Projects</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => refresh()} className="rounded-lg p-1.5 text-muted hover:bg-black/5 dark:hover:bg-white/10" title="Refresh">
              <RefreshCw size={14} />
            </button>
            <button onClick={() => setModal('new')} className="rounded-lg p-1.5 text-muted hover:bg-black/5 dark:hover:bg-white/10" title="New project">
              <FolderPlus size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">{projectList}</div>
      </div>

      {/* Right: vars for selected project */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
                <KeyRound size={28} className="text-muted" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Env &amp; secrets manager</h3>
              <p className="mt-1 max-w-sm text-sm text-muted">
                Store environment variables per project — encrypted at rest on this server.
                Import a .env file or pull vars straight from a running container.
              </p>
              {/* Mobile: show project picker inline */}
              <div className="mt-4 md:hidden">{projectList}</div>
              <button onClick={() => setModal('new')} className="pill pill-accent mx-auto mt-4">
                <Plus size={14} /> New project
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-black/5 px-4 py-3 dark:border-white/10">
              {/* Mobile project switcher */}
              <select
                value={selected.id}
                onChange={(e) => setSelectedId(e.target.value)}
                className="mb-2 w-full rounded-lg border border-black/10 bg-surface px-2 py-1.5 text-sm dark:border-white/15 dark:bg-surface-dark md:hidden"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{selected.name}</h2>
                  {selected.description && (
                    <p className="truncate text-xs text-muted">{selected.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setModal('import')} className="pill pill-muted text-xs">
                    <FileUp size={14} /> Import .env
                  </button>
                  <button onClick={() => setModal('pull')} className="pill pill-muted text-xs">
                    <Box size={14} /> Pull from container
                  </button>
                  <button onClick={() => setModal('scan')} className="pill pill-muted text-xs">
                    <FileSearch size={14} /> Server .env files
                  </button>
                  <button
                    onClick={() => exportEnvProject(selected.id, selected.name).catch((e) => alert(e.message))}
                    className="pill pill-muted text-xs"
                  >
                    <Download size={14} /> Export
                  </button>
                  <button onClick={() => removeProject(selected)} className="pill pill-muted text-xs text-danger">
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              <VarsPanel key={`${selected.id}-${varsEpoch}`} project={selected} onChanged={refresh} />
            </div>
          </>
        )}
        {error && <p className="px-4 pb-2 text-sm text-danger">{error}</p>}
      </div>

      {modal === 'new' && (
        <NewProjectModal
          discovered={discovered}
          onClose={() => setModal(null)}
          onCreated={(id) => {
            setSelectedId(id);
            refresh();
          }}
        />
      )}
      {modal === 'import' && selected && (
        <ImportModal projectId={selected.id} onClose={() => setModal(null)} onDone={refreshAll} />
      )}
      {modal === 'pull' && selected && (
        <PullModal projectId={selected.id} onClose={() => setModal(null)} onDone={refreshAll} />
      )}
      {modal === 'scan' && selected && (
        <ScanModal projectId={selected.id} onClose={() => setModal(null)} onDone={refreshAll} />
      )}
    </div>
  );
}
