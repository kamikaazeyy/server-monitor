import { useEffect, useState, useCallback } from 'react';
import { authFetch } from '../lib/auth';
import type {
  OverviewData,
  NetworkData,
  ContainerData,
  ProjectData,
  ServiceData,
  GitHubData,
  SpeedTestResult,
  HistoryPoint,
  EasBuild,
  TriggerBuildResponse,
  DbContainer,
  TableInfo,
  ColumnInfo,
  TableDataResponse,
  EnvProjectsResponse,
  EnvVar,
  EnvContainer,
  ContainerEnvVar,
  EnvDirGroup,
} from '../types';

function useFetch<T>(url: string, interval = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await authFetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, interval);
    return () => clearInterval(id);
  }, [fetchData, interval]);

  return { data, loading, error, refresh: fetchData };
}

export const useOverview = (interval = 3000) =>
  useFetch<OverviewData>('/api/monitor/overview', interval);

export const useNetwork = (interval = 1000) =>
  useFetch<NetworkData>('/api/monitor/network', interval);

export const useContainers = (interval = 5000) =>
  useFetch<ContainerData[]>('/api/monitor/containers', interval);

export const useProjects = (interval = 5000) =>
  useFetch<ProjectData[]>('/api/monitor/projects', interval);

export const useServices = (interval = 30000) =>
  useFetch<ServiceData[]>('/api/monitor/services', interval);

export const useGitHub = (interval = 60000) =>
  useFetch<GitHubData>('/api/monitor/github', interval);

export const useHistory = (interval = 1000) =>
  useFetch<HistoryPoint[]>('/api/monitor/history', interval);

export async function runSpeedTest(): Promise<SpeedTestResult> {
  const res = await authFetch('/api/monitor/speedtest', { method: 'POST' });
  return res.json();
}

export async function containerAction(
  name: string,
  action: 'start' | 'stop' | 'restart'
): Promise<{ ok: boolean; name: string; action: string }> {
  const res = await authFetch('/api/monitor/containers/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, action }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const useBuilds = (interval = 10000) =>
  useFetch<EasBuild[]>('/api/builds', interval);

export async function triggerBuild(
  profile: 'preview' | 'development',
  message?: string
): Promise<TriggerBuildResponse> {
  const res = await authFetch('/api/builds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, message }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function publishUpdate(
  branch = 'preview',
  message?: string
): Promise<{ ok: boolean; branch: string; output?: string }> {
  const res = await authFetch('/api/updates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch, message }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function cancelBuild(buildId: string): Promise<{ ok: boolean; id: string }> {
  const res = await authFetch(`/api/builds/${buildId}/cancel`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function mirrorBuild(buildId: string): Promise<{ ok: boolean; id: string; message: string }> {
  const res = await authFetch(`/api/builds/${buildId}/mirror`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function deleteBuild(buildId: string): Promise<{ ok: boolean; id: string }> {
  const res = await authFetch(`/api/builds/${buildId}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchBuildLog(buildId: string): Promise<string> {
  const res = await authFetch(`/api/builds/${buildId}/log`);
  if (!res.ok) return '';
  return res.text();
}

// --- Database browser hooks ---

export const useDbContainers = (interval = 15000) =>
  useFetch<DbContainer[]>('/api/db', interval);

export function useDatabases(containerId: string | null) {
  const [data, setData] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDatabases = useCallback(async () => {
    if (!containerId) { setData(null); return; }
    setLoading(true);
    try {
      const res = await authFetch(`/api/db/${containerId}/databases`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [containerId]);

  useEffect(() => {
    fetchDatabases();
  }, [fetchDatabases]);

  return { data, loading, error, refresh: fetchDatabases };
}

export function useTables(containerId: string | null, dbName: string | null) {
  const [data, setData] = useState<TableInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTables = useCallback(async () => {
    if (!containerId || !dbName) { setData(null); return; }
    setLoading(true);
    try {
      const res = await authFetch(`/api/db/${containerId}/${dbName}/tables`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [containerId, dbName]);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  return { data, loading, error, refresh: fetchTables };
}

export function useTableData(
  containerId: string | null,
  dbName: string | null,
  table: string | null,
  page: number,
  limit: number,
  sortCol: string | null,
  sortDir: 'asc' | 'desc'
) {
  const [data, setData] = useState<TableDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!containerId || !dbName || !table) { setData(null); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (sortCol) {
        params.set('sort', sortCol);
        params.set('dir', sortDir);
      }
      const res = await authFetch(`/api/db/${containerId}/${dbName}/${table}/data?${params}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [containerId, dbName, table, page, limit, sortCol, sortDir]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refresh: fetchData };
}

export function useTableSchema(
  containerId: string | null,
  dbName: string | null,
  table: string | null
) {
  const [data, setData] = useState<ColumnInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSchema = useCallback(async () => {
    if (!containerId || !dbName || !table) { setData(null); return; }
    setLoading(true);
    try {
      const res = await authFetch(`/api/db/${containerId}/${dbName}/${table}/schema`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [containerId, dbName, table]);

  useEffect(() => {
    fetchSchema();
  }, [fetchSchema]);

  return { data, loading, error, refresh: fetchSchema };
}

// --- Env / secrets manager hooks ---

export const useEnvProjects = (interval = 15000) =>
  useFetch<EnvProjectsResponse>('/api/env/projects', interval);

export function useEnvVars(projectId: string | null) {
  const [data, setData] = useState<EnvVar[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVars = useCallback(async () => {
    if (!projectId) { setData(null); return; }
    setLoading(true);
    try {
      const res = await authFetch(`/api/env/projects/${projectId}/vars`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchVars();
  }, [fetchVars]);

  return { data, loading, error, refresh: fetchVars };
}

async function envRequest(url: string, method: string, body?: unknown) {
  const res = await authFetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function createEnvProject(payload: { name: string; description?: string; composeProject?: string }) {
  return envRequest('/api/env/projects', 'POST', payload);
}

export function updateEnvProject(id: string, payload: { name?: string; description?: string; composeProject?: string | null }) {
  return envRequest(`/api/env/projects/${id}`, 'PATCH', payload);
}

export function deleteEnvProject(id: string) {
  return envRequest(`/api/env/projects/${id}`, 'DELETE');
}

export function upsertEnvVar(projectId: string, payload: { key: string; value: string; secret: boolean }) {
  return envRequest(`/api/env/projects/${projectId}/vars`, 'PUT', payload);
}

export function deleteEnvVar(projectId: string, key: string) {
  return envRequest(`/api/env/projects/${projectId}/vars/${encodeURIComponent(key)}`, 'DELETE');
}

export function importEnvVars(projectId: string, content: string, markSecrets: boolean): Promise<{ ok: boolean; added: number; updated: number }> {
  return envRequest(`/api/env/projects/${projectId}/import`, 'POST', { content, markSecrets });
}

export function importEnvFile(projectId: string, path: string, markSecrets = true): Promise<{ ok: boolean; added: number; updated: number }> {
  return envRequest(`/api/env/projects/${projectId}/import-file`, 'POST', { path, markSecrets });
}

export function useEnvScan() {
  const [data, setData] = useState<EnvDirGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScan = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/env/scan');
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScan();
  }, [fetchScan]);

  return { data, loading, error, refresh: fetchScan };
}

export async function exportEnvProject(projectId: string, projectName: string): Promise<void> {
  const res = await authFetch(`/api/env/projects/${projectId}/export`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectName}.env`;
  a.click();
  URL.revokeObjectURL(url);
}

export const useEnvContainers = (interval = 0) => {
  const [data, setData] = useState<EnvContainer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchContainers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/env/containers');
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContainers();
    if (interval > 0) {
      const id = setInterval(fetchContainers, interval);
      return () => clearInterval(id);
    }
  }, [fetchContainers, interval]);

  return { data, loading, error, refresh: fetchContainers };
};

export async function fetchContainerEnvVars(name: string): Promise<ContainerEnvVar[]> {
  const res = await authFetch(`/api/env/containers/${encodeURIComponent(name)}/vars`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}
