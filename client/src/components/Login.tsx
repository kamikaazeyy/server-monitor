import { useState, type FormEvent } from 'react';
import { setToken } from '../lib/auth';

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [token, setTokenInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const value = token.trim();
    if (!value) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: value }),
      });
      if (!res.ok) throw new Error('Invalid token');
      setToken(value);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
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
          Enter your dashboard token to continue.
        </p>
        <input
          type="password"
          value={token}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="Dashboard token"
          autoFocus
          className="mb-3 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 dark:border-white/15 dark:text-gray-100"
        />
        {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={loading || !token.trim()}
          className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
