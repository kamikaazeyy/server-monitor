import { cn, classForState } from '../lib/utils';

interface StatusBadgeProps {
  state: string;
  className?: string;
}

export default function StatusBadge({ state, className }: StatusBadgeProps) {
  return (
    <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', classForState(state), className)}>
      {state}
    </span>
  );
}
