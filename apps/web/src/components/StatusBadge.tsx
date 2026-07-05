interface StatusBadgeProps {
  status: string;
  className?: string;
}

export default function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  return (
    <span className={`status status-${status} ${className}`}>
      {status === "active" && <span className="live-dot" style={{ marginRight: 5 }} />}
      {status}
    </span>
  );
}

interface NetworkBadgeProps {
  network: "meta" | "google";
}

export function NetworkBadge({ network }: NetworkBadgeProps) {
  const labels: Record<string, string> = {
    meta: "Meta",
    google: "Google",
  };
  return <span className={`network-badge network-badge-${network}`}>{labels[network] ?? network}</span>;
}
