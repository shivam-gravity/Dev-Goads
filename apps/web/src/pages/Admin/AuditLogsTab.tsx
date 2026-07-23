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

// No hardcoded fake audit logs. There is no audit-log API yet, so this starts empty and shows the
// "No matching audit logs found" state until a real audit-log feed is wired up — rather than
// displaying fabricated operators/IPs/devices ("ssrivastava", "192.168.1.104") as real history.
export default function AuditLogsTab() {
  const [logs] = useState<AuditLog[]>([]);
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
