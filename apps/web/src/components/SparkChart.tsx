interface SparkChartProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  className?: string;
}

export default function SparkChart({
  data,
  width = 120,
  height = 40,
  color = "var(--accent)",
  fill = true,
  className = "",
}: SparkChartProps) {
  if (!data || data.length === 0) {
    return <svg width={width} height={height} className={className} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return `${x},${y}`;
  });

  const polyline = points.join(" ");
  const fillPath =
    `M ${points[0]} ` +
    points.slice(1).map((p) => `L ${p}`).join(" ") +
    ` L ${pad + w},${pad + h} L ${pad},${pad + h} Z`;

  return (
    <svg
      width={width}
      height={height}
      className={`spark-chart ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {fill && (
        <path
          d={fillPath}
          fill={color}
          fillOpacity="0.12"
          strokeWidth="0"
        />
      )}
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
