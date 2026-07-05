import { useState } from "react";

interface Webhook {
  id: string;
  url: string;
  events: string[];
  status: "active" | "inactive";
}

const DEFAULT_WEBHOOKS: Webhook[] = [
  { id: "wh-1", url: "https://api.brandcompany.com/v1/adgo-webhook", events: ["campaign.published", "budget.changed"], status: "active" }
];

export default function DeveloperPortalTab() {
  const [apiKey, setApiKey] = useState("sk_test_51P7033f5adgoaikeyplaceholder889");
  const [showKey, setShowKey] = useState(false);
  const [webhooks, setWebhooks] = useState<Webhook[]>(DEFAULT_WEBHOOKS);
  
  // Webhook form states
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  
  const availableEvents = [
    "campaign.create",
    "campaign.published",
    "budget.changed",
    "optimization.applied",
    "billing.invoice_created"
  ];

  function handleRegenerateKey() {
    if (!confirm("Are you sure you want to regenerate your API Key? Old keys will instantly be invalidated.")) return;
    const randomHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    setApiKey(`sk_live_${randomHex}`);
    alert("New API Key generated successfully.");
  }

  function handleToggleEvent(event: string) {
    setSelectedEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    );
  }

  function handleAddWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!webhookUrl.trim() || selectedEvents.length === 0) return;
    
    const newWebhook: Webhook = {
      id: `wh-${Date.now()}`,
      url: webhookUrl,
      events: selectedEvents,
      status: "active"
    };

    setWebhooks(prev => [...prev, newWebhook]);
    setWebhookUrl("");
    setSelectedEvents([]);
    alert("Webhook registered successfully.");
  }

  function handleDeleteWebhook(id: string) {
    if (!confirm("Delete this webhook endpoint?")) return;
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
            <button className="btn btn-sm btn-danger" onClick={handleRegenerateKey}>
              Regenerate API Key
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
              
              <button className="btn btn-primary mt-4" type="submit" disabled={selectedEvents.length === 0} aria-label="Register webhook delivery endpoint">
                Add Webhook Endpoint
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
                      <span className="status status-active" style={{ fontSize: "10px" }}>{w.status.toUpperCase()}</span>
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
        
        <div className="mt-4 flex items-center gap-4">
          <div style={{ flex: 1 }}>
            <div className="flex justify-between font-size-12 mb-1" style={{ fontWeight: 600 }}>
              <span>Request Quota</span>
              <span>420 / 1,000 requests (minute window)</span>
            </div>
            <div style={{ height: "8px", background: "#f3f4f6", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{ width: "42%", height: "100%", background: "#7033f5" }} />
            </div>
          </div>
          <div className="status status-active" style={{ background: "rgba(16, 185, 129, 0.08)", color: "#10b981", fontWeight: 700 }}>
            42% Usage
          </div>
        </div>
      </section>
    </div>
  );
}
