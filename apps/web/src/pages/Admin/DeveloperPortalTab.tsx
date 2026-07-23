import { useEffect, useState } from "react";
import { api, DeveloperWebhook } from "../../api/client.js";
import { useAuth } from "../../context/AuthContext.js";

export default function DeveloperPortalTab() {
  const { workspaceId } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyLoading, setKeyLoading] = useState(false);
  const [webhooks, setWebhooks] = useState<DeveloperWebhook[]>([]);

  // Webhook form states
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const availableEvents = [
    "campaign.create",
    "campaign.published",
    "budget.changed",
    "optimization.applied",
    "billing.invoice_created"
  ];

  useEffect(() => {
    if (!workspaceId) return;
    api.getDeveloperApiKey(workspaceId).then(res => setApiKey(res.key)).catch(() => {});
    api.listDeveloperWebhooks(workspaceId).then(setWebhooks).catch(() => {});
  }, [workspaceId]);

  async function handleRegenerateKey() {
    if (!workspaceId) return;
    if (!confirm("Are you sure you want to regenerate your API Key? Old keys will instantly be invalidated.")) return;
    setKeyLoading(true);
    try {
      const res = await api.regenerateDeveloperApiKey(workspaceId);
      setApiKey(res.key);
      alert("New API Key generated successfully.");
    } finally {
      setKeyLoading(false);
    }
  }

  function handleToggleEvent(event: string) {
    setSelectedEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    );
  }

  async function handleAddWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!webhookUrl.trim() || selectedEvents.length === 0 || !workspaceId) return;

    setSubmitting(true);
    try {
      const newWebhook = await api.createDeveloperWebhook(workspaceId, { url: webhookUrl, events: selectedEvents });
      setWebhooks(prev => [...prev, newWebhook]);
      setWebhookUrl("");
      setSelectedEvents([]);
      alert("Webhook registered successfully.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteWebhook(id: string) {
    if (!confirm("Delete this webhook endpoint?")) return;
    await api.deleteDeveloperWebhook(id);
    setWebhooks(prev => prev.filter(w => w.id !== id));
  }

  return (
    <div className="dev-portal-section">
      {/* API Key management */}
      <section className="card">
        <h2>API Access Keys</h2>
        <p className="muted-text mt-1">Use authentication keys to connect external APIs, scripts, or systems to your campaigns.</p>
        
        <div className="mt-4 flex-col gap-2">
          <div className="api-key-container">
            <span>{showKey ? apiKey : "••••••••••••••••••••••••••••••••••••••••••••••••"}</span>
            <button
              className="btn btn-sm btn-secondary"
              style={{ marginLeft: "auto", minWidth: "80px" }}
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? "Hide" : "Reveal"}
            </button>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => {
                navigator.clipboard.writeText(apiKey);
                alert("API Key copied to clipboard.");
              }}
            >
              Copy
            </button>
          </div>
          <div className="mt-2">
            <button className="btn btn-sm btn-danger" onClick={handleRegenerateKey} disabled={keyLoading}>
              {keyLoading ? "Regenerating..." : "Regenerate API Key"}
            </button>
          </div>
        </div>
      </section>

      {/* Webhook integrations */}
      <div className="admin-layout">
        <div>
          <section className="card">
            <h2>Webhook Subscriptions</h2>
            <p className="muted-text mt-1">Register endpoints to receive real-time JSON payloads on events.</p>
            
            <form onSubmit={handleAddWebhook} className="wizard-form mt-4">
              <div className="flex-col">
                <label htmlFor="webhook-url-input" className="font-weight-600 font-size-13 text-secondary block mb-1">Endpoint URL</label>
                <input
                  id="webhook-url-input"
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://yourdomain.com/webhook"
                  required
                />
              </div>
              
              <div className="mt-3">
                <span className="font-size-13 font-weight-600 block text-secondary">Trigger Events</span>
                <div className="webhook-event-checkboxes">
                  {availableEvents.map(evt => (
                    <label key={evt} style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 500, cursor: "pointer" }} className="font-size-12 mt-1">
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(evt)}
                        onChange={() => handleToggleEvent(evt)}
                        style={{ accentColor: "#7033f5", width: "15px", height: "15px" }}
                        aria-label={`Subscribe to ${evt}`}
                      />
                      {evt}
                    </label>
                  ))}
                </div>
              </div>
              
              <button className="btn btn-primary mt-4" type="submit" disabled={selectedEvents.length === 0 || submitting} aria-label="Register webhook delivery endpoint">
                {submitting ? "Registering..." : "Add Webhook Endpoint"}
              </button>
            </form>
          </section>
        </div>

        <div>
          <section className="card" style={{ height: "100%" }}>
            <h2>Active Endpoints ({webhooks.length})</h2>
            {webhooks.length === 0 ? (
              <p className="muted-text mt-4">No webhook endpoints registered.</p>
            ) : (
              <div className="flex-col gap-3 mt-4">
                {webhooks.map(w => (
                  <div key={w.id} style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px" }}>
                    <div className="flex justify-between items-center">
                      <span className="status status-active" style={{ fontSize: "10px" }}>ACTIVE</span>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDeleteWebhook(w.id)}>Delete</button>
                    </div>
                    <strong className="block mt-2 font-size-12" style={{ wordBreak: "break-all" }}>{w.url}</strong>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {w.events.map(e => (
                        <span key={e} className="pill font-size-10" style={{ background: "#f3f4f6", color: "#4b5563" }}>{e}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Rate limits */}
      <section className="card">
        <h2>API Rate Limiting</h2>
        <p className="muted-text mt-1">Workspace rate limits are dynamically applied based on your subscription tier.</p>

        {/* No fabricated usage numbers: there's no live rate-limit-usage feed yet, so show the honest
            "not available" state rather than a hardcoded "420 / 1,000 · 42%" bar that looks real. */}
        <p className="muted-text mt-4 font-size-12">Live request-quota usage is not available yet.</p>
      </section>
    </div>
  );
}
