import {
  LayoutDashboard,
  Box,
  FolderKanban,
  List,
  GitBranch,
  Smartphone,
  Zap,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';

type Tab = 'overview' | 'containers' | 'projects' | 'services' | 'github' | 'builds' | 'speed' | 'terminal';

interface MobileNavProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const items: { id: Tab; icon: LucideIcon; label: string }[] = [
  { id: 'overview', icon: LayoutDashboard, label: 'Overview' },
  { id: 'containers', icon: Box, label: 'Containers' },
  { id: 'projects', icon: FolderKanban, label: 'Projects' },
  { id: 'services', icon: List, label: 'Services' },
  { id: 'github', icon: GitBranch, label: 'GitHub' },
  { id: 'builds', icon: Smartphone, label: 'Builds' },
  { id: 'speed', icon: Zap, label: 'Speed' },
  { id: 'terminal', icon: Terminal, label: 'Terminal' },
];

export default function MobileNav({ active, onChange }: MobileNavProps) {
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-black/5 bg-surface px-4 py-3 dark:border-white/10 dark:bg-surface-dark md:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-ink text-white dark:bg-accent dark:text-ink'
                : 'bg-black/5 text-muted dark:bg-white/10 dark:text-gray-300'
            )}
          >
            <Icon size={16} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
