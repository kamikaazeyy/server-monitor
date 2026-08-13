import {
  AreaChart,
  Area,
  ResponsiveContainer,
  YAxis,
} from 'recharts';

interface SparklineProps {
  data: { value: number }[];
  color?: string;
  fill?: string;
  height?: number;
}

export default function Sparkline({
  data,
  color = '#0f0f11',
  fill = '#0f0f11',
  height = 60,
}: SparklineProps) {
  const id = `grad-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fill} stopOpacity={0.3} />
              <stop offset="100%" stopColor={fill} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis domain={[0, 'auto']} hide />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${id})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
