interface MiniBarProps {
  data: number[];
  max?: number;
  color?: string;
}

export default function MiniBar({ data, max, color = '#0f0f11' }: MiniBarProps) {
  const m = max ?? Math.max(...data, 1);
  return (
    <div className="flex h-12 items-end gap-1">
      {data.map((v, i) => {
        const pct = Math.min(100, Math.max(5, (v / m) * 100));
        return (
          <div
            key={i}
            className="rounded-t-md"
            style={{
              height: `${pct}%`,
              width: '100%',
              backgroundColor: color,
              opacity: 0.7 + (i / data.length) * 0.3,
            }}
          />
        );
      })}
    </div>
  );
}
