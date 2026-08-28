import { useState } from 'react';
import { Search, Bell, Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useNotifications } from '../context/NotificationContext';
import NotificationPanel from './NotificationPanel';

export default function Header() {
  const { dark, toggle } = useTheme();
  const { unreadCount } = useNotifications();
  const [notifOpen, setNotifOpen] = useState(false);

  return (
    <header className="flex items-center justify-between px-6 py-5 md:px-8">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-ink dark:text-white md:text-3xl">
          Monitoring Dashboard
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-ink">
            live
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          Real-time visibility into servers, containers and projects.
        </p>
      </div>
      <div className="relative flex items-center gap-3">
        <button className="hidden h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm dark:bg-surface-dark md:flex">
          <Search size={18} className="text-muted" />
        </button>
        <button
          onClick={() => setNotifOpen((v) => !v)}
          className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm transition-colors dark:bg-surface-dark"
          aria-label="Notifications"
        >
          <Bell size={18} className="text-muted" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
        <NotificationPanel open={notifOpen} onClose={() => setNotifOpen(false)} />
        <button
          onClick={toggle}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm transition-colors dark:bg-surface-dark"
          aria-label="Toggle theme"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <div className="hidden h-10 w-10 overflow-hidden rounded-full bg-accent md:block">
          <img
            src="https://api.dicebear.com/7.x/initials/svg?seed=Admin&background=dfff4f"
            alt="avatar"
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    </header>
  );
}
