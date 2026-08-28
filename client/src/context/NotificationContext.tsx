import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { io } from 'socket.io-client';

export type NotificationType =
  | 'build'
  | 'container'
  | 'ci'
  | 'system';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
  meta?: Record<string, unknown>;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  permission: NotificationPermission | 'unsupported';
  requestPermission: () => Promise<void>;
  pushNotification: (
    type: NotificationType,
    title: string,
    body: string,
    meta?: Record<string, unknown>,
    silent?: boolean
  ) => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

const MAX_NOTIFICATIONS = 100;
const STORAGE_KEY = 'monitor-notifications';

function loadStored(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_NOTIFICATIONS);
  } catch {
    return [];
  }
}

function persist(notifications: AppNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
  } catch {
    // storage may be full or unavailable
  }
}

function fireBrowserNotification(title: string, body: string) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: title + body,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // some browsers throw if notifications are not allowed
  }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>(loadStored);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  });
  const idCounter = useRef(0);

  useEffect(() => {
    persist(notifications);
  }, [notifications]);

  const pushNotification = useCallback(
    (type: NotificationType, title: string, body: string, meta?: Record<string, unknown>, silent?: boolean) => {
      const id = `${Date.now()}-${idCounter.current++}`;
      const notification: AppNotification = {
        id,
        type,
        title,
        body,
        timestamp: Date.now(),
        read: false,
        meta,
      };
      setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));
      if (!silent) {
        fireBrowserNotification(title, body);
      }
    },
    []
  );

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } catch {
      // ignore
    }
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // --- Socket.io listener for build status changes ---
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_TERMINAL_URL || window.location.origin;
    const socket = io(socketUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
    });

    const handleBuildStatus = (data: { buildId: string; status: string; sizeBytes?: number }) => {
      const status = String(data.status || '').toLowerCase().replace(/_/g, ' ');
      const shortId = data.buildId.slice(0, 8);

      if (status === 'new' || status === 'in queue' || status === 'pending') {
        pushNotification('build', 'Build Triggered', `Build ${shortId} has been queued.`);
      } else if (status === 'in progress') {
        pushNotification('build', 'Build In Progress', `Build ${shortId} is now building.`, undefined, true);
      } else if (status === 'finished') {
        pushNotification('build', 'Build Finished', `Build ${shortId} completed. Download starting…`);
      } else if (status === 'downloaded') {
        const sizeMb = data.sizeBytes ? (data.sizeBytes / (1024 * 1024)).toFixed(1) : '?';
        pushNotification('build', 'APK Ready for Download', `Build ${shortId} APK (${sizeMb} MB) is available.`);
      } else if (status === 'errored') {
        pushNotification('build', 'Build Failed', `Build ${shortId} errored. Check the logs.`);
      } else if (status === 'canceled' || status === 'cancelled') {
        pushNotification('build', 'Build Cancelled', `Build ${shortId} was cancelled.`);
      }
    };

    socket.on('build:status', handleBuildStatus);

    return () => {
      socket.off('build:status', handleBuildStatus);
      socket.disconnect();
    };
  }, [pushNotification]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        permission,
        requestPermission,
        pushNotification,
        markAllRead,
        markRead,
        clearAll,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
