import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, AdStrategy, Campaign, BusinessProfile } from "../api/client.js";

export default function Dashboard({ businessId }: { businessId: string }) {
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [strategies, setStrategies] = useState<AdStrategy[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [biz, strats, camps] = await Promise.all([
      api.getBusiness(businessId),
      api.listStrategies(businessId),
      api.listCampaigns(businessId),
    ]);
    setBusiness(biz);
    setStrategies(strats);
    setCampaigns(camps);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [businessId]);

  async function handleGenerateStrategy() {
    setGenerating(true);
    setError(null);
    try {
      await api.generateStrategy(businessId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate strategy");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCreateCampaign(strategy: AdStrategy) {
    setError(null);
    try {
      const campaign = await api.createCampaign({
        strategyId: strategy.id,
        name: `${business?.name ?? "Campaign"} — ${new Date().toLocaleDateString()}`,
        dailyBudgetCents: Math.round((business?.monthlyBudgetCents ?? 100000) / 30),
      });
      await api.launchCampaign(campaign.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    }
  }

  if (!business) return <p>Loading...</p>;

  const latestStrategy = strategies[0];

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>{business.name}</h1>
        <span className="pill">{business.industry}</span>
      </div>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <div className="card-header">
          <h2>AI Strategy</h2>
          <button onClick={handleGenerateStrategy} disabled={generating}>
            {generating ? "Generating..." : latestStrategy ? "Regenerate" : "Generate strategy"}
          </button>
        </div>
        {latestStrategy ? (
          <div>
            <p>{latestStrategy.summary}</p>
            <div className="grid-2">
              <div>
                <h3>Networks</h3>
                <ul>
                  {latestStrategy.recommendedNetworks.map((n) => (
                    <li key={n}>
                      {n} — {Math.round((latestStrategy.budgetSplit[n] ?? 0) * 100)}%
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>Audiences</h3>
                <ul>
                  {latestStrategy.audiences.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            </div>
            <h3>Creatives</h3>
            <div className="grid-2">
              {latestStrategy.creatives.map((c, i) => (
                <div key={i} className="creative-card">
                  <strong>{c.headline}</strong>
                  <p>{c.body}</p>
                  <span className="pill">{c.callToAction}</span>
                </div>
              ))}
            </div>
            <button className="secondary" onClick={() => handleCreateCampaign(latestStrategy)}>
              Launch campaign from this strategy
            </button>
          </div>
        ) : (
          <p>No strategy yet — generate one to get creative and targeting recommendations.</p>
        )}
      </section>

      <section className="card">
        <h2>Campaigns</h2>
        {campaigns.length === 0 && <p>No campaigns yet.</p>}
        <ul className="campaign-list">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link to={`/campaigns/${c.id}`}>{c.name}</Link>
              <span className={`status status-${c.status}`}>{c.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
