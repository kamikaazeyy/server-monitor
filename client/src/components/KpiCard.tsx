import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface KpiCardProps {
  title: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: boolean;
  className?: string;
  children?: ReactNode;
}

export default function KpiCard({
  title,
  value,
  sub,
  icon,
  accent,
  className,
  children,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        'card flex flex-col justify-between p-5',
        accent && 'bg-accent text-ink',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <span className={cn('text-sm font-medium text-muted', accent && 'text-ink/70')}>
          {title}
        </span>
        {icon && <div className="opacity-70">{icon}</div>}
      </div>
      <div className="mt-4">
        <div className="text-3xl font-semibold tracking-tight md:text-4xl">{value}</div>
        {sub && (
          <div
            className={cn(
              'mt-1 text-sm text-muted',
              accent && 'text-ink/70'
            )}
          >
            {sub}
          </div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
