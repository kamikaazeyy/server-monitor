import { useState, type FormEvent } from 'react';
import { setToken } from '../lib/auth';

export default function AuthScreen({
  needsSetup,
  onSuccess,
}: {
  needsSetup: boolean;
  onSuccess: (username: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const name = username.trim();
    if (!name || !password) return;
    if (needsSetup && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${needsSetup ? 'signup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
      setToken(body.token);
      onSuccess(body.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg p-4 dark:bg-bg-dark">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-black/5 bg-surface p-6 shadow-sm dark:border-white/10 dark:bg-surface-dark"
      >
        <h1 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Server Monitor
        </h1>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {needsSetup
            ? 'Create your account to finish setup.'
            : 'Sign in to continue.'}
        </p>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
          autoFocus
          className="mb-3 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/15 dark:text-gray-100"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={needsSetup ? 'Password (min 8 chars)' : 'Password'}
          autoComplete={needsSetup ? 'new-password' : 'current-password'}
          className="mb-3 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/15 dark:text-gray-100"
        />
        {needsSetup && (
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            className="mb-3 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/15 dark:text-gray-100"
          />
        )}
        {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={loading || !username.trim() || !password}
          className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? 'Please wait…' : needsSetup ? 'Create account' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
