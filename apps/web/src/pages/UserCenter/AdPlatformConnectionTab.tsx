import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { api, Integration } from "../../api/client.js";
import { MetaInfinityIcon, GoogleIcon, TikTokIcon, BingIcon } from "../../components/icons.js";

interface Platform {
  key: Integration["platform"] | "bing";
  label: string;
  Icon: ComponentType<{ className?: string }>;
  supported: boolean;
}

const PLATFORMS: Platform[] = [
  { key: "meta", label: "Meta", Icon: MetaInfinityIcon, supported: true },
  { key: "google", label: "Google", Icon: GoogleIcon, supported: true },
  { key: "tiktok", label: "TikTok", Icon: TikTokIcon, supported: false },
  { key: "bing", label: "Bing", Icon: BingIcon, supported: false }
];

const EMPTY_META_MANUAL_FORM = { accessToken: "", adAccountId: "", pageId: "", pageAccessToken: "" };
const EMPTY_GOOGLE_MANUAL_FORM = { customerId: "", developerToken: "", accessToken: "", clientId: "", clientSecret: "", refreshToken: "" };

export default function AdPlatformConnectionTab({ businessId }: { businessId: string }) {
  const [active, setActive] = useState<Platform["key"]>("meta");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [metaManualForm, setMetaManualForm] = useState(EMPTY_META_MANUAL_FORM);
  const [googleManualForm, setGoogleManualForm] = useState(EMPTY_GOOGLE_MANUAL_FORM);

  const wsId = localStorage.getItem("adgo_workspace_id") ?? "demo";

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setIntegrations(await api.listIntegrations(wsId));
    } catch {
      setError("Failed to fetch platform integrations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    if (connected === "meta" || connected === "google") {
      setActive(connected);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("error")) {
      setError("Failed to connect platform. Please try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [businessId]);

  const current = PLATFORMS.find((p) => p.key === active)!;
  const integration = integrations.find((i) => i.platform === active);
  const isConnected = integration?.status === "connected";

  async function handleManualConnect() {
    setManualError(null);
    setManualSubmitting(true);
    try {
      if (active === "meta") {
        if (!metaManualForm.accessToken || !metaManualForm.adAccountId) {
          setManualError("Access Token and Ad Account ID are required.");
          return;
        }
        await api.connectMetaManual(wsId, {
          accessToken: metaManualForm.accessToken,
          adAccountId: metaManualForm.adAccountId,
          pageId: metaManualForm.pageId || undefined,
          pageAccessToken: metaManualForm.pageAccessToken || undefined,
        });
        setMetaManualForm(EMPTY_META_MANUAL_FORM);
      } else if (active === "google") {
        if (!googleManualForm.customerId || !googleManualForm.developerToken || !googleManualForm.accessToken) {
          setManualError("Customer ID, Developer Token, and Access Token are required.");
          return;
        }
        await api.connectGoogleManual(wsId, {
          customerId: googleManualForm.customerId,
          developerToken: googleManualForm.developerToken,
          accessToken: googleManualForm.accessToken,
          clientId: googleManualForm.clientId || undefined,
          clientSecret: googleManualForm.clientSecret || undefined,
          refreshToken: googleManualForm.refreshToken || undefined,
        });
        setGoogleManualForm(EMPTY_GOOGLE_MANUAL_FORM);
      }
      await load();
    } catch {
      setManualError("Manual connect failed. Double-check the values and try again.");
    } finally {
      setManualSubmitting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect this platform? Syncing campaigns will pause.")) return;
    setError(null);
    try {
      await api.disconnectIntegration(wsId, active as Integration["platform"]);
      await load();
    } catch {
      setError("Failed to disconnect platform.");
    }
  }

  return (
    <div className="platform-connect">
      <div className="platform-connect-tabs">
        {PLATFORMS.map((p) => (
          <button
            key={p.key}
            className={`platform-connect-tab ${active === p.key ? "active" : ""}`}
            onClick={() => setActive(p.key)}
          >
            <p.Icon /> {p.label}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="platform-connect-card">
        {loading ? (
          <div className="campaigns-loading">
            <div className="campaign-row-skeleton" />
          </div>
        ) : !current.supported ? (
          <div className="platform-connect-empty">
            <div className="platform-connect-icon-badge">
              <current.Icon />
            </div>
            <p>{current.label} Ads integration is coming soon.</p>
          </div>
        ) : isConnected ? (
          <div className="platform-connect-empty">
            <div className="platform-connect-icon-badge">
              <current.Icon />
            </div>
            <p className="platform-connect-status">Connected</p>

            <div className="platform-connect-details">
              <div className="platform-connect-details-header">Ad Account Details</div>
              {integration?.accountName && (
                <div className="platform-connect-detail-row"><span>Account Name</span><span>{integration.accountName}</span></div>
              )}
              {integration?.accountId && (
                <div className="platform-connect-detail-row"><span>Account ID</span><span>{integration.accountId}</span></div>
              )}
              {active === "meta" && Boolean(integration?.settings?.currency) && (
                <div className="platform-connect-detail-row"><span>Currency</span><span>{String(integration!.settings.currency)}</span></div>
              )}
              {active === "meta" && Boolean(integration?.settings?.timezoneName) && (
                <div className="platform-connect-detail-row"><span>Timezone</span><span>{String(integration!.settings.timezoneName)}</span></div>
              )}
              {active === "meta" && Boolean(integration?.settings?.accountStatus) && (
                <div className="platform-connect-detail-row"><span>Status</span><span>{String(integration!.settings.accountStatus)}</span></div>
              )}
              {active === "meta" && Boolean(integration?.settings?.pageName) && (
                <div className="platform-connect-detail-row"><span>Page</span><span>{String(integration!.settings.pageName)}</span></div>
              )}
              {integration?.connectedAt && (
                <div className="platform-connect-detail-row"><span>Connected On</span><span>{new Date(integration.connectedAt).toLocaleString()}</span></div>
              )}
            </div>

            <button className="platform-connect-btn danger" onClick={handleDisconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="platform-connect-empty">
            <div className="platform-connect-icon-badge">
              <current.Icon />
            </div>
            <p>Start by linking your {current.label} accounts.</p>

            {(active === "meta" || active === "google") && (
              <div className="platform-connect-manual-inline">
                {manualError && <p className="error">{manualError}</p>}

                {active === "meta" ? (
                  <>
                    <p className="muted-text">
                      Paste tokens from the{" "}
                      <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noreferrer">
                        Meta Graph API Explorer
                      </a>
                      .
                    </p>
                    <label className="adsgo-modal-field">
                      <span>Access Token</span>
                      <textarea
                        rows={2}
                        value={metaManualForm.accessToken}
                        onChange={(e) => setMetaManualForm((f) => ({ ...f, accessToken: e.target.value }))}
                      />
                    </label>
                    <label className="adsgo-modal-field">
                      <span>Ad Account ID (e.g. act_123456)</span>
                      <input
                        type="text"
                        value={metaManualForm.adAccountId}
                        onChange={(e) => setMetaManualForm((f) => ({ ...f, adAccountId: e.target.value }))}
                      />
                    </label>
                    <label className="adsgo-modal-field">
                      <span>Page ID</span>
                      <input
                        type="text"
                        value={metaManualForm.pageId}
                        onChange={(e) => setMetaManualForm((f) => ({ ...f, pageId: e.target.value }))}
                      />
                    </label>
                    <label className="adsgo-modal-field">
                      <span>Page Access Token</span>
                      <textarea
                        rows={2}
                        value={metaManualForm.pageAccessToken}
                        onChange={(e) => setMetaManualForm((f) => ({ ...f, pageAccessToken: e.target.value }))}
                      />
                      <div className="field-hint">From Graph API Explorer → me/accounts → copy the page's access_token. Required for lead form capture.</div>
                    </label>
                  </>
                ) : (
                  <>
                    <p className="muted-text">Paste credentials from the Google Ads API Center.</p>
                    <label className="adsgo-modal-field">
                      <span>Customer ID (e.g. 123-456-7890)</span>
                      <input
                        type="text"
                        value={googleManualForm.customerId}
                        onChange={(e) => setGoogleManualForm((f) => ({ ...f, customerId: e.target.value }))}
                      />
                    </label>
                    <label className="adsgo-modal-field">
                      <span>Developer Token</span>
                      <input
                        type="password"
                        value={googleManualForm.developerToken}
                        onChange={(e) => setGoogleManualForm((f) => ({ ...f, developerToken: e.target.value }))}
                      />
                    </label>
                    <label className="adsgo-modal-field">
                      <span>Access Token</span>
                      <textarea
                        rows={2}
                        value={googleManualForm.accessToken}
                        onChange={(e) => setGoogleManualForm((f) => ({ ...f, accessToken: e.target.value }))}
                      />
                    </label>
                    <label className="adsgo-modal-field">
                      <span>Client ID (optional)</span>
                      <input
                        type="text"
                        value={googleManualForm.clientId}
                        onChange={(e) => setGoogleManualForm((f) => ({ ...f, clientId: e.target.value }))}
                      />
                    </label>
                    <label className="adsgo-modal-field">
                      <span>Client Secret (optional)</span>
                      <input
                        type="password"
                        value={googleManualForm.clientSecret}
                        onChange={(e) => setGoogleManualForm((f) => ({ ...f, clientSecret: e.target.value }))}
                      />
                    </label>
                    <label className="adsgo-modal-field">
                      <span>Refresh Token (optional)</span>
                      <textarea
                        rows={2}
                        value={googleManualForm.refreshToken}
                        onChange={(e) => setGoogleManualForm((f) => ({ ...f, refreshToken: e.target.value }))}
                      />
                      <div className="field-hint">Without this, AdGo can't refresh the token once it expires (~1hr) — you'll need to reconnect.</div>
                    </label>
                  </>
                )}

                <button type="button" className="btn btn-primary adsgo-modal-submit" onClick={handleManualConnect} disabled={manualSubmitting}>
                  {manualSubmitting ? "Connecting..." : "Connect manually"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
