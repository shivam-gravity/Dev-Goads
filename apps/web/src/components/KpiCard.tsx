import SparkChart from "./SparkChart.js";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean;
  icon?: string;
  sparkData?: number[];
  sparkColor?: string;
  loading?: boolean;
}

export default function KpiCard({
  label,
  value,
  delta,
  deltaPositive,
  icon,
  sparkData,
  sparkColor = "var(--accent)",
  loading = false,
}: KpiCardProps) {
  return (
    <div className="kpi-card">
      <div className="kpi-card-top">
        <span className="kpi-label">{label}</span>
        {icon && <span className="kpi-icon">{icon}</span>}
      </div>
      {loading ? (
        <div className="kpi-skeleton" />
      ) : (
        <div className="kpi-value">{value}</div>
      )}
      <div className="kpi-card-bottom">
        {delta && (
          <span className={`kpi-delta ${deltaPositive ? "kpi-delta-up" : "kpi-delta-down"}`}>
            {deltaPositive ? "▲" : "▼"} {delta}
          </span>
        )}
        {sparkData && sparkData.length > 1 && (
          <SparkChart data={sparkData} width={80} height={28} color={sparkColor} />
        )}
      </div>
    </div>
  );
}
