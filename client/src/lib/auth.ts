const KEY = 'dashboard_token';

export function getToken(): string {
  return localStorage.getItem(KEY) || '';
}

export function setToken(token: string) {
  localStorage.setItem(KEY, token);
  window.dispatchEvent(new Event('auth-changed'));
}

export function clearToken() {
  localStorage.removeItem(KEY);
}

function forceReauth() {
  if (!getToken()) return;
  clearToken();
  window.location.reload();
}

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) forceReauth();
  return res;
}

export function handleSocketError(err: Error) {
  if (err.message === 'Unauthorized') forceReauth();
}
