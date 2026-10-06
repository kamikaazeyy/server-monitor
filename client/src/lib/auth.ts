import { io, type Socket } from 'socket.io-client';

const KEY = 'dashboard_token';

export function getToken(): string {
  return localStorage.getItem(KEY) || '';
}

export function setToken(token: string) {
  localStorage.setItem(KEY, token);
}

export function clearToken() {
  localStorage.removeItem(KEY);
}

function forceReauth() {
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

// Connect to a socket.io namespace ('' = default). Use '/terminal' for the
// web terminal — only that namespace spawns a shell server-side.
export function connectSocket(namespace = ''): Socket {
  const socketUrl = (import.meta.env.VITE_TERMINAL_URL || window.location.origin) + namespace;
  return io(socketUrl, {
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    auth: { token: getToken() },
  });
}

export function logout() {
  // Rotate the JWT secret server-side so every outstanding token dies,
  // then drop the local copy.
  authFetch('/api/auth/logout', { method: 'POST' })
    .catch(() => {})
    .finally(() => {
      clearToken();
      window.location.reload();
    });
}
