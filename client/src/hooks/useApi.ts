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
