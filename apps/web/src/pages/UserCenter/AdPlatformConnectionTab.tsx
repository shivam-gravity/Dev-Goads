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
  { key: "tiktok", label: "TikTok", Icon: TikTokIcon, supported: true },
  { key: "bing", label: "Bing", Icon: BingIcon, supported: false }
];

const MOCK_ACCOUNT_NAMES: Record<string, string> = {
  meta: "AdGo Meta Business Manager",
  google: "AdGo Google Ads MMC",
  tiktok: "AdGo TikTok Ads Account"
};

export default function AdPlatformConnectionTab({ businessId }: { businessId: string }) {
  const [active, setActive] = useState<Platform["key"]>("meta");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            <p className="muted-text">
              {integration?.accountName} ({integration?.accountId})
            </p>
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
            <button className="platform-connect-btn" onClick={handleConnect}>
              Connect {current.label} ads
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
