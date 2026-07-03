import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, Campaign, NormalizedPerformance, OptimizationDecision } from "../api/client.js";

export default function CampaignDetail() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [performance, setPerformance] = useState<NormalizedPerformance[]>([]);
  const [decisions, setDecisions] = useState<OptimizationDecision[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!campaignId) return;
    const [camp, perf] = await Promise.all([api.getCampaign(campaignId), api.getPerformance(campaignId)]);
    setCampaign(camp);
    setPerformance(perf);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [campaignId]);

  async function runIngest() {
    if (!campaignId) return;
    setBusy("ingest");
    setError(null);
    try {
      await api.ingestMetrics(campaignId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setBusy(null);
    }
  }

  async function runOptimize() {
    if (!campaignId) return;
    setBusy("optimize");
    setError(null);
    try {
      const result = await api.optimize(campaignId);
      setDecisions(result);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Optimization failed");
    } finally {
      setBusy(null);
    }
  }

  if (!campaign) return <p>Loading...</p>;

  return (
    <div className="campaign-detail">
      <h1>{campaign.name}</h1>
      <span className={`status status-${campaign.status}`}>{campaign.status}</span>
      {error && <p className="error">{error}</p>}

      <div className="actions">
        <button onClick={runIngest} disabled={busy !== null}>
          {busy === "ingest" ? "Pulling metrics..." : "Pull latest metrics"}
        </button>
        <button onClick={runOptimize} disabled={busy !== null} className="secondary">
          {busy === "optimize" ? "Optimizing..." : "Run optimization pass"}
        </button>
      </div>

      <section className="card">
        <h2>Variants</h2>
        <table>
          <thead>
            <tr>
              <th>Network</th>
              <th>Headline</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {campaign.variants.map((v) => (
              <tr key={v.id}>
                <td>{v.network}</td>
                <td>{v.creative.headline}</td>
                <td>
                  <span className={`status status-${v.status}`}>{v.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Performance</h2>
        {performance.length === 0 ? (
          <p>No metrics ingested yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Network</th>
                <th>Impressions</th>
                <th>Clicks</th>
                <th>CTR</th>
                <th>Conversions</th>
                <th>CPA</th>
                <th>Spend</th>
              </tr>
            </thead>
            <tbody>
              {performance.map((p) => (
                <tr key={p.variantId}>
                  <td>{p.network}</td>
                  <td>{p.impressions.toLocaleString()}</td>
                  <td>{p.clicks.toLocaleString()}</td>
                  <td>{(p.ctr * 100).toFixed(2)}%</td>
                  <td>{p.conversions}</td>
                  <td>{p.cpaCents !== null ? `$${(p.cpaCents / 100).toFixed(2)}` : "—"}</td>
                  <td>${(p.spendCents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {decisions.length > 0 && (
        <section className="card">
          <h2>Latest optimization decisions</h2>
          <ul className="decision-list">
            {decisions.map((d, i) => (
              <li key={i}>
                <strong>{d.action.replace("_", " ")}</strong> — {d.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
