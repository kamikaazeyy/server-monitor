import { useEffect, useState, useCallback } from 'react';
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
} from '../types';

function useFetch<T>(url: string, interval = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url);
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
  const res = await fetch('/api/monitor/speedtest', { method: 'POST' });
  return res.json();
}

export async function containerAction(
  name: string,
  action: 'start' | 'stop' | 'restart'
): Promise<{ ok: boolean; name: string; action: string }> {
  const res = await fetch('/api/monitor/containers/action', {
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
  const res = await fetch('/api/builds', {
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

export async function cancelBuild(buildId: string): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(`/api/builds/${buildId}/cancel`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function mirrorBuild(buildId: string): Promise<{ ok: boolean; id: string; message: string }> {
  const res = await fetch(`/api/builds/${buildId}/mirror`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function deleteBuild(buildId: string): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(`/api/builds/${buildId}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchBuildLog(buildId: string): Promise<string> {
  const res = await fetch(`/api/builds/${buildId}/log`);
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
      const res = await fetch(`/api/db/${containerId}/databases`);
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
      const res = await fetch(`/api/db/${containerId}/${dbName}/tables`);
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
      const res = await fetch(`/api/db/${containerId}/${dbName}/${table}/data?${params}`);
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
      const res = await fetch(`/api/db/${containerId}/${dbName}/${table}/schema`);
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
