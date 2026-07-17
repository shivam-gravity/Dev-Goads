import { useState } from "react";

interface AuditLog {
  id: string;
  who: string;
  action: string;
  when: string;
  oldValue: string;
  newValue: string;
  ip: string;
  device: string;
}

const DEFAULT_LOGS: AuditLog[] = [
  {
    id: "log-1",
    who: "ssrivastava",
    action: "Updated workspace settings",
    when: new Date(Date.now() - 1000 * 60 * 15).toLocaleString(), // 15 mins ago
    oldValue: "Name: Polluxa Platform",
    newValue: "Name: Default Brand",
    ip: "192.168.1.104",
    device: "Chrome 126 / Windows"
  },
  {
    id: "log-2",
    who: "ssrivastava",
    action: "Modified metric scale filters",
    when: new Date(Date.now() - 1000 * 60 * 45).toLocaleString(), // 45 mins ago
    oldValue: "Filter: Last 30 days",
    newValue: "Filter: Last 7 days",
    ip: "192.168.1.104",
    device: "Chrome 126 / Windows"
  },
  {
    id: "log-3",
    who: "system (bandit)",
    action: "Shifted campaign budget allocation",
    when: new Date(Date.now() - 1000 * 60 * 120).toLocaleString(), // 2 hours ago
    oldValue: "Meta: 50%, Google: 50%",
    newValue: "Meta: 35%, Google: 65%",
    ip: "10.0.4.82",
    device: "Background Job Server"
  },
  {
    id: "log-4",
    who: "ssrivastava",
    action: "Updated campaign status",
    when: new Date(Date.now() - 1000 * 3600 * 4).toLocaleString(), // 4 hours ago
    oldValue: "Status: draft",
    newValue: "Status: published",
    ip: "192.168.1.104",
    device: "Chrome 126 / Windows"
  },
  {
    id: "log-5",
    who: "jdoe@example.com",
    action: "Accepted workspace invitation",
    when: new Date(Date.now() - 1000 * 3600 * 24).toLocaleString(), // 1 day ago
    oldValue: "Invite token: pending",
    newValue: "Status: active member",
    ip: "203.0.113.88",
    device: "Safari 17.5 / macOS"
  },
  {
    id: "log-6",
    who: "ssrivastava",
    action: "Modified primary brand color",
    when: new Date(Date.now() - 1000 * 3600 * 48).toLocaleString(), // 2 days ago
    oldValue: "Color: #4f46e5",
    newValue: "Color: #7033f5",
    ip: "192.168.1.92",
    device: "Chrome 125 / Windows"
  }
];

export default function AuditLogsTab() {
  const [logs] = useState<AuditLog[]>(DEFAULT_LOGS);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredLogs = logs.filter(log =>
    log.who.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.ip.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <section className="card">
      <div className="audit-logs-controls">
        <div>
          <h2>Audit &amp; Compliance Logs</h2>
          <p className="muted-text mt-1">Review chronological logs of operations, state changes, and API actions.</p>
        </div>
        <input
          type="text"
          className="audit-search-input"
          placeholder="Search by action, operator, or IP..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="table-wrap mt-4" style={{ overflowX: "auto" }}>
        <table className="audit-table">
          <thead>
            <tr>
              <th>Operator</th>
              <th>Action Perform</th>
              <th>Date &amp; Time</th>
              <th>Before</th>
              <th>After</th>
              <th>IP Address</th>
              <th>Device</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center" }} className="muted-text">
                  No matching audit logs found.
                </td>
              </tr>
            ) : (
              filteredLogs.map(log => (
                <tr key={log.id}>
                  <td>
                    <strong>{log.who}</strong>
                  </td>
                  <td>{log.action}</td>
                  <td>{log.when}</td>
                  <td className="muted-text font-size-11" style={{ fontFamily: "monospace" }}>{log.oldValue}</td>
                  <td style={{ fontFamily: "monospace" }} className="font-size-11">
                    <span className="status status-active" style={{ background: "rgba(112, 51, 245, 0.08)", color: "#7033f5", fontFamily: "monospace" }}>
                      {log.newValue}
                    </span>
                  </td>
                  <td>{log.ip}</td>
                  <td>
                    <span className="audit-device-badge">{log.device}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
