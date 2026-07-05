import { useState } from "react";
import { api, Workspace } from "../../api/client.js";

interface WorkspaceTabProps {
  workspace: Workspace;
  onRefresh: () => Promise<void>;
}

export default function WorkspaceTab({ workspace, onRefresh }: WorkspaceTabProps) {
  const [name, setName] = useState(workspace.name);
  const [timezone, setTimezone] = useState(workspace.timezone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    setError(null);
    try {
      await api.updateWorkspace(workspace.id, { name, timezone });
      await onRefresh();
      alert("Workspace settings saved successfully.");
    } catch (err) {
      setError("Failed to save workspace details.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <h2>Workspace Profile</h2>
      <p className="muted-text mt-1">Configure your branding, reporting timezones, and display settings.</p>
      
      {error && <p className="error mt-2">{error}</p>}
      
      <form onSubmit={handleSave} className="wizard-form mt-4">
        <label>
          Workspace Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        
        <label className="mt-3">
          Reporting Timezone
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            <option value="UTC">UTC (Coordinated Universal Time)</option>
            <option value="America/New_York">EST/EDT (Eastern Standard Time)</option>
            <option value="America/Los_Angeles">PST/PDT (Pacific Standard Time)</option>
            <option value="Europe/London">GMT/BST (Greenwich Mean Time)</option>
            <option value="Asia/Kolkata">IST (Indian Standard Time)</option>
          </select>
        </label>
        
        <button className="btn btn-primary mt-4" type="submit" disabled={saving}>
          {saving ? "Saving Settings..." : "Save Workspace Details"}
        </button>
      </form>
    </section>
  );
}
