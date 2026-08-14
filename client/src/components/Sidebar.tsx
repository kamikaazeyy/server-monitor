import {
  LayoutDashboard,
  Box,
  FolderKanban,
  List,
  GitBranch,
  Zap,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils';

type Tab = 'overview' | 'containers' | 'projects' | 'services' | 'github' | 'speed' | 'terminal';

interface SidebarProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const items: { id: Tab; icon: LucideIcon; label: string }[] = [
  { id: 'overview', icon: LayoutDashboard, label: 'Overview' },
  { id: 'containers', icon: Box, label: 'Containers' },
  { id: 'projects', icon: FolderKanban, label: 'Projects' },
  { id: 'services', icon: List, label: 'Services' },
  { id: 'github', icon: GitBranch, label: 'GitHub / CI' },
  { id: 'speed', icon: Zap, label: 'Speed Test' },
  { id: 'terminal', icon: Terminal, label: 'Terminal' },
];

export default function Sidebar({ active, onChange }: SidebarProps) {
  return (
    <aside className="hidden w-20 shrink-0 flex-col items-center gap-6 border-r border-white/10 bg-ink py-6 md:flex">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-ink">
        <LayoutDashboard size={20} strokeWidth={2.5} />
      </div>
      <nav className="flex flex-col gap-3">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              title={item.label}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-xl transition-colors',
                isActive
                  ? 'bg-accent text-ink'
                  : 'text-gray-400 hover:bg-white/10 hover:text-white'
              )}
            >
              <Icon size={20} />
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
