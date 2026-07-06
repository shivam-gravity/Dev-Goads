import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { api, Integration } from "../../api/client.js";
import { MetaInfinityIcon, GoogleIcon, TikTokIcon, BingIcon, CloseIcon } from "../../components/icons.js";

const EMPTY_META_MANUAL_FORM = { accessToken: "", adAccountId: "", pageId: "", pageAccessToken: "" };
const EMPTY_GOOGLE_MANUAL_FORM = { customerId: "", developerToken: "", accessToken: "", clientId: "", clientSecret: "", refreshToken: "" };

interface Platform {
  key: Integration["platform"] | "bing";
  label: string;
  Icon: ComponentType<{ className?: string }>;
  supported: boolean;
}

const PLATFORMS: Platform[] = [
  { key: "meta", label: "Meta", Icon: MetaInfinityIcon, supported: true },
  { key: "google", label: "Google", Icon: GoogleIcon, supported: true },
  { key: "tiktok", label: "TikTok", Icon: TikTokIcon, supported: true },
  { key: "bing", label: "Bing", Icon: BingIcon, supported: false }
];

const MOCK_ACCOUNT_NAMES: Record<string, string> = {
  meta: "AdGo Meta Business Manager",
  google: "AdGo Google Ads MMC",
  tiktok: "AdGo TikTok Ads Account"
};

const PLATFORM_DESCRIPTIONS: Record<string, string> = {
  meta: "Let AdGo run your Meta campaigns end to end — AI-generated images, video, and copy; audience targeting; and lead capture from your Facebook/Instagram lead forms.",
  google: "Let AdGo run your Google Ads campaigns end to end — Responsive Search Ads, keyword & audience targeting, and lead capture from your Google lead form assets.",
  tiktok: "Let AdGo launch and monitor TikTok campaigns using the same AI-generated creative as your other channels.",
};

const PLATFORM_FEATURES: Record<string, string[]> = {
  meta: ["AI-generated images, video & ad copy", "Campaign, Ad Set & Ad launch (starts paused)", "Audience targeting & reach estimates", "Lead form capture — leads sync automatically"],
  google: ["AI-generated Responsive Search Ads", "Campaign & Ad Group launch (starts paused)", "Keyword & audience targeting", "Lead form capture — leads sync automatically"],
  tiktok: ["AI-generated ad creative", "Campaign launch, pause & budget control", "Performance insights"],
};

export default function AdPlatformConnectionTab({ businessId }: { businessId: string }) {
  const [active, setActive] = useState<Platform["key"]>("meta");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [manualOpen, setManualOpen] = useState(false);
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

  const OAUTH_STARTERS: Partial<Record<Platform["key"], (workspaceId: string) => string>> = {
    meta: api.startMetaOAuth,
    google: api.startGoogleOAuth,
  };

  async function handleConnect() {
    if (!current.supported) return;
    setError(null);
    const startOAuth = OAUTH_STARTERS[active];
    if (startOAuth) {
      window.location.href = startOAuth(wsId);
      return;
    }
    try {
      await api.connectIntegration(wsId, active as Integration["platform"], MOCK_ACCOUNT_NAMES[active] ?? "Platform Account");
      await load();
    } catch {
      setError("Failed to connect platform.");
    }
  }

  function openManualConnect() {
    setManualError(null);
    setManualOpen(true);
  }

  function closeManualConnect() {
    setManualOpen(false);
    setManualError(null);
  }

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
      setManualOpen(false);
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
          <div className="platform-connect-empty platform-connect-empty-wide">
            <div className="platform-connect-icon-badge">
              <current.Icon />
            </div>
            <p className="platform-connect-lead">Start by linking your {current.label} accounts.</p>
            {PLATFORM_DESCRIPTIONS[active] && <p className="muted-text">{PLATFORM_DESCRIPTIONS[active]}</p>}
            {PLATFORM_FEATURES[active] && (
              <ul className="platform-connect-feature-list">
                {PLATFORM_FEATURES[active].map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            )}
            <button className="platform-connect-btn" onClick={handleConnect}>
              Connect {current.label} ads
            </button>
            {(active === "meta" || active === "google") && (
              <button type="button" className="platform-connect-manual-link" onClick={openManualConnect}>
                Manual Connect (Testing)
              </button>
            )}
          </div>
        )}
      </div>

      {manualOpen && (
        <div className="adsgo-modal-overlay" onClick={closeManualConnect}>
          <div className="adsgo-modal adsgo-modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="adsgo-modal-header">
              <h2>Manual Connect — {current.label} Ads</h2>
              <button type="button" className="adsgo-modal-close" onClick={closeManualConnect} aria-label="Close">
                <CloseIcon />
              </button>
            </div>

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
                    rows={3}
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
                    rows={3}
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
              {manualSubmitting ? "Connecting..." : "Connect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
