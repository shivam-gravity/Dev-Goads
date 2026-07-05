import { useEffect, useState } from "react";
import { api, Integration } from "../api/client.js";
import Reveal from "../components/Reveal.js";

export default function Integrations({ businessId }: { businessId: string }) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const wsId = localStorage.getItem("adgo_workspace_id") ?? "demo";

  async function loadIntegrations() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listIntegrations(wsId);
      setIntegrations(data);
    } catch {
      setError("Failed to fetch platform integrations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIntegrations();
  }, [businessId]);

  async function handleToggleConnect(platform: Integration["platform"], isConnected: boolean) {
    setError(null);
    try {
      if (isConnected) {
        if (!confirm("Are you sure you want to disconnect this platform? All syncing campaigns will pause.")) return;
        await api.disconnectIntegration(wsId, platform);
      } else {
        const mockName = platform === "meta" ? "AdGo Meta Business Manager" :
                         platform === "google" ? "AdGo Google Ads MMC" :
                         platform === "shopify" ? "AdGo Store Sync" :
                         "Platform Integration Account";
        await api.connectIntegration(wsId, platform, mockName);
      }
      await loadIntegrations();
    } catch {
      setError("Failed to connect/disconnect platform integration.");
    }
  }

  return (
    <div className="page-integrations">
      <div className="page-header">
        <div>
          <h1>Platform Integrations</h1>
          <p className="subtitle">Connect ad networks, e-commerce stores, and tracking pixels to sync conversion events.</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <div className="campaigns-loading">
          {[1, 2].map(i => <div key={i} className="campaign-row-skeleton" />)}
        </div>
      ) : (
        <Reveal>
          <div className="integrations-grid mt-3">
            {integrations.map((int) => {
              const isConnected = int.status === "connected";
              return (
                <div key={int.platform} className={`card integration-card ${isConnected ? "integration-connected" : ""}`}>
                  <div className="integration-card-header flex justify-between items-center">
                    <span className={`network-badge network-badge-${int.platform}`}>{int.platform.toUpperCase()}</span>
                    <button
                      className={`btn btn-sm ${isConnected ? "btn-danger" : "btn-primary"}`}
                      onClick={() => handleToggleConnect(int.platform, isConnected)}
                    >
                      {isConnected ? "Disconnect" : "Connect Platform"}
                    </button>
                  </div>

                  <div className="integration-body mt-3">
                    {isConnected ? (
                      <div>
                        <p className="text-success"><strong>✓ Connected</strong></p>
                        <p className="muted-text font-size-12">Account: {int.accountName} ({int.accountId})</p>
                        <p className="muted-text font-size-12">Synced At: {new Date(int.updatedAt).toLocaleString()}</p>
                      </div>
                    ) : (
                      <div>
                        <p className="muted-text">Connect to sync daily ad campaign structures and push optimization decisions instantly.</p>
                      </div>
                    )}
                  </div>

                  {int.permissions.length > 0 && (
                    <div className="integration-footer mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                      <span className="muted-text font-size-11">Granted Scope:</span>
                      <div className="scope-list mt-1">
                        {int.permissions.map(p => <span key={p} className="creative-tag">{p}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Reveal>
      )}
    </div>
  );
}
