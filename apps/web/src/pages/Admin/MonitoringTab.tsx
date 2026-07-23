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

// No hardcoded fake monitors and no Math.random() latency jitter. There is no system-health API
// wired up yet, so this shows an honest empty state until real diagnostics are connected — rather
// than fabricated "99.99% uptime / 14ms" numbers that look like live monitoring.
export default function MonitoringTab() {
  const [monitors] = useState<Monitor[]>([]);

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2>System Operations Monitoring</h2>
          <p className="muted-text">Live diagnostics, integration sync delays, and queue processing metrics.</p>
        </div>
      </div>

      {monitors.length === 0 && (
        <div className="card muted-text" style={{ textAlign: "center", padding: "32px" }}>
          No live monitoring data available yet.
        </div>
      )}

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

          </div>
        ))}
      </div>
    </div>
  );
}
