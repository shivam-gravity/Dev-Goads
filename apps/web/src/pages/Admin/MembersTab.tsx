import { useState } from "react";
import { api, WorkspaceMember } from "../../api/client.js";

interface MembersTabProps {
  workspaceId: string;
  members: WorkspaceMember[];
  onRefresh: () => Promise<void>;
}

export default function MembersTab({ workspaceId, members, onRefresh }: MembersTabProps) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "viewer">("member");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviting(true);
    setError(null);
    try {
      await api.inviteMember(workspaceId, inviteEmail, inviteRole);
      setInviteEmail("");
      await onRefresh();
      alert(`Invitation sent to ${inviteEmail}!`);
    } catch (err) {
      setError("Failed to send workspace invitation.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(memberId: string) {
    if (!confirm("Are you sure you want to remove this team member?")) return;
    try {
      await api.removeMember(memberId);
      await onRefresh();
    } catch (err) {
      setError("Failed to remove workspace member.");
    }
  }

  return (
    <div className="admin-layout">
      {/* Left Column: Invite Form */}
      <div className="flex-col gap-4">
        <section className="card">
          <h2>Invite Team Member</h2>
          <p className="muted-text mt-1">Add teammates to collaborate on strategies and campaigns.</p>
          
          {error && <p className="error mt-2">{error}</p>}
          
          <form onSubmit={handleInvite} className="wizard-form mt-4">
            <div className="flex-col">
              <label htmlFor="member-email-input" className="font-weight-600 font-size-13 text-secondary block mb-1">User Email Address</label>
              <input
                id="member-email-input"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                required
              />
            </div>
            
            <div className="flex-col mt-3">
              <label htmlFor="member-role-select" className="font-weight-600 font-size-13 text-secondary block mb-1">Role Profile</label>
              <select id="member-role-select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as any)}>
                <option value="admin">Admin (Manage Billing & Connections)</option>
                <option value="member">Member (Create & Launch Campaigns)</option>
                <option value="viewer">Viewer (Read-Only Analytics)</option>
              </select>
            </div>
            
            <button className="btn btn-primary mt-4" type="submit" disabled={inviting} aria-label="Send workspace invitation email token">
              {inviting ? "Inviting..." : "Send Invite Token"}
            </button>
          </form>
        </section>
      </div>

      {/* Right Column: Member list */}
      <div className="admin-members">
        <section className="card">
          <h2>Team Members ({members.length})</h2>
          
          <div className="table-wrap mt-3">
            <table>
              <thead>
                <tr>
                  <th>Teammate</th>
                  <th>Role</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.user?.name || "Pending User"}</strong>
                      <span className="muted-text font-size-11 block">{m.user?.email || "awaiting login"}</span>
                    </td>
                    <td>
                      <span className="status status-active">{m.role.toUpperCase()}</span>
                    </td>
                    <td>
                      {m.role !== "owner" && (
                        <button className="btn btn-sm btn-danger" onClick={() => handleRemove(m.id)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
