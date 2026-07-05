import { useState } from "react";

interface Monitor {
  id: string;
  name: string;
  status: "healthy" | "warning" | "critical";
  latency: string;
  uptime: string;
  lastCheck: string;
  incidents: number;
}

const DEFAULT_MONITORS: Monitor[] = [
  {
    id: "mon-1",
    name: "API Health Gateway",
    status: "healthy",
    latency: "14ms",
    uptime: "99.99%",
    lastCheck: "Just now",
    incidents: 0
  },
  {
    id: "mon-2",
    name: "Meta Ads API Sync",
    status: "healthy",
    latency: "182ms",
    uptime: "99.95%",
    lastCheck: "30s ago",
    incidents: 1
  },
  {
    id: "mon-3",
    name: "Google Ads API Sync",
    status: "warning",
    latency: "410ms",
    uptime: "99.88%",
    lastCheck: "1m ago",
    incidents: 3
  },
  {
    id: "mon-4",
    name: "Webhook Delivery Queue",
    status: "healthy",
    latency: "8ms",
    uptime: "100.00%",
    lastCheck: "Just now",
    incidents: 0
  },
  {
    id: "mon-5",
    name: "Background Optimizer Jobs",
    status: "healthy",
    latency: "24ms",
    uptime: "99.99%",
    lastCheck: "15s ago",
    incidents: 0
  },
  {
    id: "mon-6",
    name: "Job Execution Retry Queue",
    status: "healthy",
    latency: "0ms (empty)",
    uptime: "100.00%",
    lastCheck: "2m ago",
    incidents: 0
  }
];

export default function MonitoringTab() {
  const [monitors, setMonitors] = useState<Monitor[]>(DEFAULT_MONITORS);

  function handleTriggerCheck(id: string) {
    setMonitors(prev =>
      prev.map(m => {
        if (m.id === id) {
          // Simulate latency jitter on check
          const randomLatency = m.status === "healthy"
            ? `${Math.floor(Math.random() * 20 + 8)}ms`
            : `${Math.floor(Math.random() * 100 + 350)}ms`;
          return {
            ...m,
            latency: randomLatency,
            lastCheck: "Just now"
          };
        }
        return m;
      })
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2>System Operations Monitoring</h2>
          <p className="muted-text">Live diagnostics, integration sync delays, and queue processing metrics.</p>
        </div>
      </div>

      <div className="monitoring-grid">
        {monitors.map((mon) => (
          <div key={mon.id} className="card monitor-card">
            <div className="monitor-card-header">
              <span className="monitor-name">{mon.name}</span>
              <span
                className={`status-indicator-dot ${mon.status}`}
                title={`System status: ${mon.status}`}
              />
            </div>
            
            <div className="flex-col gap-2 mt-2">
              <div className="monitor-metric-row">
                <span>Latency</span>
                <span className="monitor-metric-value">{mon.latency}</span>
              </div>
              <div className="monitor-metric-row">
                <span>Uptime (30d)</span>
                <span className="monitor-metric-value">{mon.uptime}</span>
              </div>
              <div className="monitor-metric-row">
                <span>Incidents</span>
                <span className="monitor-metric-value" style={{ color: mon.incidents > 0 ? "var(--danger)" : "inherit" }}>
                  {mon.incidents}
                </span>
              </div>
              <div className="monitor-metric-row">
                <span>Checked</span>
                <span className="monitor-metric-value" style={{ fontSize: "11px", color: "var(--muted)" }}>{mon.lastCheck}</span>
              </div>
            </div>

            <button
              className="btn btn-sm btn-secondary mt-2 w-full"
              onClick={() => handleTriggerCheck(mon.id)}
            >
              🔄 Refresh Check
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
