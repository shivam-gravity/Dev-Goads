import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { api, AdInsightNetwork, AdInsightsResponse } from "../api/client.js";
import Reveal from "../components/Reveal.js";
import { MetaInfinityIcon, GoogleIcon, TikTokIcon, BingIcon } from "../components/icons.js";

const AUDIENCE_COLORS = ["#7033f5", "#0e9f6e", "#f59e0b", "#9ca3af"];
const PAGE_COLORS = ["#3b82f6", "#22d3ee", "#a5b4fc", "#c7d2fe"];

const PLATFORM_TABS: { id: AdInsightNetwork; label: string; icon: JSX.Element }[] = [
  { id: "meta", label: "Meta", icon: <MetaInfinityIcon /> },
  { id: "google", label: "Google", icon: <GoogleIcon /> },
  { id: "tiktok", label: "TikTok", icon: <TikTokIcon /> },
  { id: "bing", label: "Bing", icon: <BingIcon /> },
];

function fmtMoney(cents: number) {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function fmtCpa(cents: number | null) {
  return cents == null ? "—" : (cents / 100).toFixed(1);
}

export default function Analytics({ businessId }: { businessId: string }) {
  const [network, setNetwork] = useState<AdInsightNetwork>("meta");
  const [data, setData] = useState<AdInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh(n: AdInsightNetwork) {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getAdInsights(businessId, n);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ad insights");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh(network);
  }, [businessId, network]);

  return (
    <div className="page-analytics">
      <div className="page-header">
        <div>
          <h1>Ad Insights</h1>
          <p className="subtitle">Audience, landing page, and creative performance breakdowns across your ad platforms.</p>
        </div>
        {data?.isDemo && <span className="pill demo-pill">Demo</span>}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="platform-tabs">
        {PLATFORM_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`platform-tab ${network === tab.id ? "active" : ""}`}
            onClick={() => setNetwork(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {loading || !data ? (
        <div className="campaigns-loading">
          {[1, 2].map(i => <div key={i} className="campaign-row-skeleton" />)}
        </div>
      ) : (
        <Reveal>
          <div className="flex-col gap-4">
            {data.isDemo && (
              <div className="demo-banner">
                <span>Demo data only. Create your first campaign to view performance data.</span>
                <Link to="/campaigns/new" className="btn btn-primary btn-sm">✨ Create campaign</Link>
              </div>
            )}

            <div className="grid-2 insight-grid">
              {/* Audience Insight */}
              <section className="card">
                <h2 className="insight-section-title">Audience Insight</h2>
                <h3 className="insight-subsection-title">Spend Distribution</h3>
                <div className="donut-row">
                  <div className="donut-chart-wrap">
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={data.audience.distribution}
                          dataKey="sharePct"
                          nameKey="label"
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={2}
                        >
                          {data.audience.distribution.map((_, i) => (
                            <Cell key={i} fill={AUDIENCE_COLORS[i % AUDIENCE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: any) => `${v}%`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="donut-legend">
                    {data.audience.distribution.map((slice, i) => (
                      <li key={slice.label}>
                        <span className="legend-dot" style={{ background: AUDIENCE_COLORS[i % AUDIENCE_COLORS.length] }} />
                        {slice.label}
                      </li>
                    ))}
                  </ul>
                </div>

                <h3 className="insight-subsection-title mt-3">Top Audiences</h3>
                <div className="flex-col gap-3">
                  {data.audience.top.map((a) => (
                    <div key={a.name} className="top-insight-item">
                      <strong>{a.name}</strong>
                      {a.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {a.tags.map(t => <span key={t} className="pill tag-pill">{t}</span>)}
                        </div>
                      )}
                      <div className="top-insight-stats">
                        <span className="stat-highlight">{fmtCpa(a.cpaCents)} CPA</span>
                        <span className="muted-text">{fmtMoney(a.spendCents)} spend · {a.campaignCount} campaigns</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Page Insights */}
              <section className="card">
                <h2 className="insight-section-title">Page Insights</h2>
                <h3 className="insight-subsection-title">Spend Distribution</h3>
                <div className="donut-row">
                  <div className="donut-chart-wrap">
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={data.pages.distribution}
                          dataKey="sharePct"
                          nameKey="label"
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={2}
                        >
                          {data.pages.distribution.map((_, i) => (
                            <Cell key={i} fill={PAGE_COLORS[i % PAGE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: any) => `${v}%`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="donut-legend">
                    {data.pages.distribution.map((slice, i) => (
                      <li key={slice.label}>
                        <span className="legend-dot" style={{ background: PAGE_COLORS[i % PAGE_COLORS.length] }} />
                        {slice.label}
                      </li>
                    ))}
                  </ul>
                </div>

                <h3 className="insight-subsection-title mt-3">Top Pages</h3>
                <div className="flex-col gap-3">
                  {data.pages.top.map((p) => (
                    <div key={p.url} className="top-insight-item">
                      <strong className="page-url-text">{p.url}</strong>
                      <div className="top-insight-stats">
                        <span className="stat-highlight">{p.cvr}% CVR</span>
                        <span className="muted-text">{fmtMoney(p.spendCents)} spend · {p.campaignCount} campaigns</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Creative Insight */}
            <section className="card">
              <h2 className="insight-section-title">Creative Insight</h2>
              <h3 className="insight-subsection-title">Creative Performance</h3>
              <ResponsiveContainer width="100%" height={260}>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="ctr" name="CTR" unit="%" />
                  <YAxis type="number" dataKey="cpaCentsDollars" name="CPA" />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v: any, name: any) => name === "CTR" ? `${v}%` : v} />
                  <Scatter
                    data={data.creative.scatter.map(s => ({ ...s, cpaCentsDollars: Math.round(s.cpaCents / 100 * 10) / 10 }))}
                    fill="#c2ee00"
                    stroke="#0d031f"
                    strokeWidth={1}
                  />
                </ScatterChart>
              </ResponsiveContainer>

              <h3 className="insight-subsection-title mt-3">Top Ads</h3>
              <div className="top-ads-grid">
                {data.creative.topAds.map((ad) => (
                  <div key={ad.id} className="ad-creative-card">
                    <div className="ad-creative-stats">
                      <span className="stat-highlight">{ad.ctr}% CTR</span>
                      <span className="muted-text">{fmtCpa(ad.cpaCents)} CPA · {ad.campaignCount} campaigns</span>
                    </div>
                    {ad.imageUrl && <img src={ad.imageUrl} alt={ad.headline} className="ad-creative-image" />}
                    <div className="ad-creative-body">
                      <strong>{ad.headline}</strong>
                      <p className="muted-text mt-1">{ad.body}</p>
                    </div>
                    <div className="ad-creative-engagement">
                      <span>👍 Like</span>
                      <span>💬 Comment</span>
                      <span>↗️ Share</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </Reveal>
      )}
    </div>
  );
}
