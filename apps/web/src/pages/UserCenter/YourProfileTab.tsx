import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../api/client.js";
import { useAuth } from "../../context/AuthContext.js";

export default function YourProfileTab() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await api.updateMe({ name });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="your-profile-tab">
      <div className="card">
        <h2>Your Profile</h2>
        {error && <p className="error">{error}</p>}
        <form onSubmit={handleSave} className="wizard-form mt-3">
          <label>
            Full Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Email
            <input type="email" value={user?.email ?? ""} disabled />
          </label>
          <button className="btn btn-primary mt-3" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
          {saved && <p className="text-success mt-2">Profile updated.</p>}
        </form>
      </div>
    </div>
  );
}
