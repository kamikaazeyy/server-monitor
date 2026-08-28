import { useEffect, useRef } from 'react';
import {
  Bell,
  Box,
  GitBranch,
  Rocket,
  Settings,
  Trash2,
  CheckCheck,
  X,
} from 'lucide-react';
import { useNotifications, type NotificationType } from '../context/NotificationContext';

const typeIcon: Record<NotificationType, typeof Bell> = {
  build: Rocket,
  container: Box,
  ci: GitBranch,
  system: Settings,
};

const typeColor: Record<NotificationType, string> = {
  build: 'text-accent',
  container: 'text-blue-500',
  ci: 'text-purple-500',
  system: 'text-muted',
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function NotificationPanel({ open, onClose }: NotificationPanelProps) {
  const { notifications, unreadCount, permission, requestPermission, markAllRead, clearAll } =
    useNotifications();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 md:hidden"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="fixed right-3 top-16 z-50 w-[calc(100vw-1.5rem)] max-w-sm md:absolute md:right-0 md:top-12 md:w-96"
      >
        <div className="card overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/10">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-muted" />
              <span className="text-sm font-semibold">
                Notifications
                {unreadCount > 0 && (
                  <span className="ml-2 rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </span>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-muted hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Permission banner */}
          {permission !== 'granted' && permission !== 'unsupported' && (
            <div className="border-b border-black/5 bg-accent/10 px-4 py-3 dark:border-white/10">
              <p className="text-xs text-ink dark:text-white">
                Enable browser push notifications to get alerts for builds, containers, and CI/CD.
              </p>
              <button
                onClick={requestPermission}
                className="mt-2 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-white dark:bg-accent dark:text-ink"
              >
                Enable Push Notifications
              </button>
            </div>
          )}

          {/* Actions */}
          {notifications.length > 0 && (
            <div className="flex items-center justify-between border-b border-black/5 px-4 py-2 dark:border-white/10">
              <button
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink dark:hover:text-white"
              >
                <CheckCheck size={14} />
                Mark all read
              </button>
              <button
                onClick={clearAll}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-red-500"
              >
                <Trash2 size={14} />
                Clear all
              </button>
            </div>
          )}

          {/* List */}
          <div className="max-h-[60vh] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted">
                No notifications yet.
              </div>
            ) : (
              notifications.map((n) => {
                const Icon = typeIcon[n.type] || Bell;
                return (
                  <div
                    key={n.id}
                    className={`flex gap-3 border-b border-black/5 px-4 py-3 last:border-0 dark:border-white/5 ${
                      !n.read ? 'bg-accent/5 dark:bg-accent/5' : ''
                    }`}
                  >
                    <div className={`mt-0.5 shrink-0 ${typeColor[n.type]}`}>
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{n.title}</p>
                        <span className="shrink-0 text-xs text-muted">{timeAgo(n.timestamp)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{n.body}</p>
                    </div>
                    {!n.read && (
                      <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );
}
