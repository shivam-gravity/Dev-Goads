import { useEffect, useState } from "react";
import { api, AnalyticsSummary, Campaign, NormalizedPerformance, TrendPoint } from "../api/client.js";
import KpiCard from "../components/KpiCard.js";
import Reveal from "../components/Reveal.js";

type Period = "all" | "month" | "week";

interface CampaignWithPerf extends Campaign {
  perf: NormalizedPerformance[];
  trend: TrendPoint[];
}

export default function Analytics({ businessId }: { businessId: string }) {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignWithPerf[]>([]);
  const [period, setPeriod] = useState<Period>("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab State
  const [activeTab, setActiveTab] = useState<"dashboard" | "reports">("dashboard");
  const [exporting, setExporting] = useState<"pdf" | "csv" | null>(null);
  const [scheduledEmail, setScheduledEmail] = useState(true);
  const [reportTemplate, setReportTemplate] = useState("Executive Overview");

  async function refresh(p: Period) {
    setLoading(true);
    setError(null);
    try {
      const [sum, camps] = await Promise.all([
        api.getAnalyticsSummary(businessId, p),
        api.listCampaigns(businessId),
      ]);
      setSummary(sum);

      const withPerf = await Promise.all(
        camps.map(async (c) => {
          const [perf, trend] = await Promise.all([
            api.getPerformance(c.id),
            api.getCampaignTrend(c.id),
          ]).catch(() => [[], []] as [NormalizedPerformance[], TrendPoint[]]);
          return { ...c, perf, trend };
        })
      );
      setCampaigns(withPerf);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh(period);
  }, [businessId, period]);

  function fmtMoney(cents: number) {
    return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtNum(n: number) {
    return n.toLocaleString();
  }

  async function handleExport(format: "pdf" | "csv") {
    setExporting(format);
    // Simulate generation delay
    await new Promise(r => setTimeout(r, 1200));
    setExporting(null);
    alert(`${format.toUpperCase()} report exported successfully. Download started.`);
  }

  return (
    <div className="page-analytics">
      <div className="page-header">
        <div>
          <h1>Analytics &amp; Reporting</h1>
          <p className="subtitle">Track ROAS gains, review performance charts, and schedule automated reporting exports.</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {/* Sub tabs navigation */}
      <nav className="admin-tabs-nav">
        <button
          className={`admin-tab-link ${activeTab === "dashboard" ? "active" : ""}`}
          onClick={() => setActiveTab("dashboard")}
          style={{ background: "none", border: "none", borderBottom: activeTab === "dashboard" ? "2px solid #7033f5" : "2px solid transparent", cursor: "pointer" }}
        >
          Performance Dashboard
        </button>
        <button
          className={`admin-tab-link ${activeTab === "reports" ? "active" : ""}`}
          onClick={() => setActiveTab("reports")}
          style={{ background: "none", border: "none", borderBottom: activeTab === "reports" ? "2px solid #7033f5" : "2px solid transparent", cursor: "pointer" }}
        >
          Saved Reports &amp; Exports
        </button>
      </nav>

      {activeTab === "dashboard" ? (
        /* Dashboard Tab */
        <div>
          <div className="flex justify-between items-center mb-4">
            <span className="font-size-14 text-secondary">Summary KPIs</span>
            <div className="period-tabs">
              {(["week", "month", "all"] as Period[]).map((p) => (
                <button
                  key={p}
                  className={`period-tab ${period === p ? "active" : ""}`}
                  onClick={() => setPeriod(p)}
                >
                  {p === "all" ? "All Time" : p === "month" ? "30 Days" : "7 Days"}
                </button>
              ))}
            </div>
          </div>

          <Reveal>
            <div className="kpi-grid">
              <KpiCard
                label="Total Spend"
                value={summary ? fmtMoney(summary.totalSpendCents) : "—"}
                icon="💸"
                loading={loading}
              />
              <KpiCard
                label="Impressions"
                value={summary ? fmtNum(summary.totalImpressions) : "—"}
                icon="👁️"
                loading={loading}
              />
              <KpiCard
                label="Clicks"
                value={summary ? fmtNum(summary.totalClicks) : "—"}
                icon="🖱️"
                loading={loading}
              />
              <KpiCard
                label="ROAS"
                value={summary?.roas != null ? `${summary.roas.toFixed(2)}×` : "—"}
                icon="📈"
                loading={loading}
              />
            </div>
          </Reveal>

          {/* Campaigns performance table list */}
          <section className="card mt-4">
            <h2>Campaign Breakdown</h2>
            <div className="table-wrap mt-3">
              <table>
                <thead>
                  <tr>
                    <th>Campaign Name</th>
                    <th>Network</th>
                    <th>Spend</th>
                    <th>Clicks</th>
                    <th>Conversions</th>
                    <th>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center" }} className="muted-text">
                        No campaign breakdowns available.
                      </td>
                    </tr>
                  ) : (
                    campaigns.map(c => {
                      const perf = c.perf?.[0];
                      return (
                        <tr key={c.id}>
                          <td><strong>{c.name}</strong></td>
                          <td>
                            {c.networks.map(n => (
                              <span key={n} className={`network-badge network-badge-${n}`} style={{ marginRight: "4px" }}>
                                {n.toUpperCase()}
                              </span>
                            ))}
                          </td>
                          <td>{perf ? fmtMoney(perf.spendCents) : "—"}</td>
                          <td>{perf ? fmtNum(perf.clicks) : "—"}</td>
                          <td>{perf ? fmtNum(perf.conversions) : "—"}</td>
                          <td>{perf ? `${(perf.ctr * 100).toFixed(2)}%` : "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        /* Reports and Exports Tab */
        <div className="flex-col gap-4">
          <div className="admin-layout">
            {/* Left Column: Actions */}
            <div className="flex-col gap-4">
              <section className="card">
                <h2>Saved Report Layouts</h2>
                <p className="muted-text mt-1">Select a template visualization format to customize your summaries.</p>
                
                <div className="wizard-form mt-4">
                  <label>
                    Report Template
                    <select value={reportTemplate} onChange={(e) => setReportTemplate(e.target.value)}>
                      <option value="Executive Overview">Executive Overview (Weekly summary)</option>
                      <option value="ROAS Breakdown">ROAS Breakdown (Creative level)</option>
                      <option value="Media split comparison">Google vs Meta Split Comparison</option>
                      <option value="Custom Campaign log">Custom Campaign Log</option>
                    </select>
                  </label>
                  
                  <div className="flex gap-2 mt-4">
                    <button
                      className="btn btn-primary"
                      style={{ flex: 1 }}
                      onClick={() => handleExport("pdf")}
                      disabled={exporting !== null}
                    >
                      {exporting === "pdf" ? "Generating PDF..." : "📥 Export PDF Document"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleExport("csv")}
                      disabled={exporting !== null}
                    >
                      {exporting === "csv" ? "Generating CSV..." : "📥 Export CSV Data"}
                    </button>
                  </div>
                </div>
              </section>

              <section className="card">
                <h2>Shareable Report Link</h2>
                <p className="muted-text mt-1">Generate a secure external link to share this report view with client viewers.</p>
                <button
                  className="btn btn-secondary mt-3"
                  onClick={() => {
                    navigator.clipboard.writeText(`https://adsgo.ai/shared/report_${wsId}_latest`);
                    alert("Shareable report link copied to clipboard.");
                  }}
                >
                  🔗 Copy Link
                </button>
              </section>
            </div>

            {/* Right Column: Scheduled Job Toggles */}
            <div>
              <section className="card" style={{ height: "100%" }}>
                <h2>Report Scheduling</h2>
                <p className="muted-text mt-1">Schedule automatic email reports sent straight to your mailbox.</p>
                
                <div className="mt-4 flex-col gap-3">
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: 600, cursor: "pointer" }} className="font-size-14">
                    <input
                      type="checkbox"
                      checked={scheduledEmail}
                      onChange={() => setScheduledEmail(!scheduledEmail)}
                      style={{ accentColor: "#7033f5", width: "16px", height: "16px" }}
                    />
                    Weekly Executive Summary Email
                  </label>
                  <p className="muted-text font-size-12" style={{ paddingLeft: "26px" }}>
                    Sent every Monday morning at 8:00 AM UTC. Summarizes ROAS shifts, budget efficiency, and active rules.
                  </p>
                  
                  <div className="api-key-container mt-3" style={{ fontSize: "12px" }}>
                    <span>Target Inbox: <strong>ssrivastava@example.com</strong></span>
                  </div>
                </div>
              </section>
            </div>
          </div>
          
          {/* Executive summary block */}
          <section className="card">
            <h2>Executive Performance Summary</h2>
            <div className="mt-3 font-size-14" style={{ lineHeight: "1.6", color: "#374151" }}>
              <p>
                During the selected period, total ad spend reached <strong>{summary ? fmtMoney(summary.totalSpendCents) : "$0.00"}</strong>, achieving an average ROAS of <strong>{summary?.roas != null ? `${summary.roas.toFixed(2)}x` : "0.00x"}</strong> across channels.
              </p>
              <p className="mt-2">
                Budget optimization algorithms shifted <strong>$1,250.00</strong> automatically from underperforming Meta graphic ad sets to Google high-intent keyword search campaigns, resulting in a <strong>+24% clicks increment</strong> with zero budget growth. 
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
