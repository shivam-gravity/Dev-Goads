import { useEffect, useState } from "react";
import { api, RbacMatrix } from "../../api/client.js";

// Permission actions
const PERMISSIONS = [
  { key: "create_campaign", label: "Campaign Create" },
  { key: "delete_campaign", label: "Campaign Delete" },
  { key: "launch_campaign", label: "Launch Campaign" },
  { key: "billing", label: "Billing Management" },
  { key: "integrations", label: "Manage Integrations" },
  { key: "workspace", label: "Workspace Settings" }
] as const;

// Roles list
const ROLES = [
  "Owner",
  "Admin",
  "Manager",
  "Analyst",
  "Designer",
  "Viewer",
  "Billing Admin"
] as const;

// Default Matrix map
const DEFAULT_MATRIX: Record<typeof ROLES[number], Record<string, boolean>> = {
  "Owner": { create_campaign: true, delete_campaign: true, launch_campaign: true, billing: true, integrations: true, workspace: true },
  "Admin": { create_campaign: true, delete_campaign: true, launch_campaign: true, billing: true, integrations: true, workspace: true },
  "Manager": { create_campaign: true, delete_campaign: true, launch_campaign: true, billing: false, integrations: true, workspace: false },
  "Analyst": { create_campaign: true, delete_campaign: false, launch_campaign: false, billing: false, integrations: false, workspace: false },
  "Designer": { create_campaign: true, delete_campaign: false, launch_campaign: false, billing: false, integrations: false, workspace: false },
  "Viewer": { create_campaign: false, delete_campaign: false, launch_campaign: false, billing: false, integrations: false, workspace: false },
  "Billing Admin": { create_campaign: false, delete_campaign: false, launch_campaign: false, billing: true, integrations: false, workspace: false }
};

const wsId = localStorage.getItem("adgo_workspace_id") ?? "demo";

export default function RolesTab() {
  const [matrix, setMatrix] = useState<RbacMatrix>(DEFAULT_MATRIX);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modified, setModified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getRbacMatrix(wsId)
      .then(m => {
        if (!cancelled) setMatrix(m);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load RBAC permissions matrix.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  function handleToggle(role: typeof ROLES[number], permissionKey: string) {
    if (role === "Owner") return; // Owner permissions are immutable
    setMatrix(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        [permissionKey]: !prev[role][permissionKey]
      }
    }));
    setModified(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.setRbacMatrix(wsId, matrix);
      setMatrix(saved);
      setModified(false);
      alert("RBAC Permissions Matrix updated successfully.");
    } catch (err) {
      setError("Failed to save RBAC permissions matrix.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h2>Role-Based Access Control (RBAC)</h2>
          <p className="muted-text mt-1">Configure feature permission grids for standard team member roles.</p>
        </div>
        {modified && (
          <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving Changes..." : "Save Matrix Modifications"}
          </button>
        )}
      </div>

      {error && <p className="error mt-2">{error}</p>}

      <div className="table-wrap mt-4" style={{ overflowX: "auto" }}>
        <table className="rbac-matrix-table">
          <thead>
            <tr>
              <th>Feature Permission</th>
              {ROLES.map(role => (
                <th key={role}>{role}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map(perm => (
              <tr key={perm.key}>
                <td>{perm.label}</td>
                {ROLES.map(role => {
                  const isChecked = matrix[role][perm.key];
                  return (
                    <td key={role}>
                      <input
                        type="checkbox"
                        className="rbac-checkbox"
                        checked={isChecked}
                        disabled={role === "Owner"}
                        onChange={() => handleToggle(role, perm.key)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
