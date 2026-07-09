import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, Campaign, AdSet, Ad, AdInsightsResponse, Insight, LiveInsights } from "../api/client.js";
import StatusBadge from "../components/StatusBadge.js";
import Reveal from "../components/Reveal.js";

type Mode = "campaigns" | "adsets" | "ads";
type Network = "meta" | "google" | "tiktok";

interface BriefStat {
  label: string;
  value: string;
}

const NETWORK_LABELS: Record<Network, string> = { meta: "Meta", google: "Google", tiktok: "Tiktok" };

/** Builds the four overview stat tiles from a real, network-scoped AdInsightsResponse.totals —
 * no historical comparison data exists yet, so there's deliberately no delta/trend arrow here
 * (the old mock version fabricated week-over-week deltas that were never actually computed). */
function statsFromInsights(insights: AdInsightsResponse | null): BriefStat[] {
  if (!insights) return [];
  const t = insights.totals;
  return [
    { label: "Spend", value: `$${(t.spendCents / 100).toFixed(2)}` },
    { label: "Conversions", value: String(t.conversions) },
    { label: "Cost Per Conversion", value: t.cpaCents !== null ? `$${(t.cpaCents / 100).toFixed(2)}` : "—" },
    { label: "ROAS", value: t.roas !== null ? `${t.roas.toFixed(2)}x` : "—" },
  ];
}

function ToggleSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`adsgo-toggle-switch ${on ? "on" : ""}`}
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? "Turn off" : "Turn on"}
    >
      <span className="adsgo-toggle-knob" />
    </button>
  );
}

function PagerCard({
  variant,
  icon,
  title,
  items,
}: {
  variant: "highlight" | "risk";
  icon: string;
  title: string;
  items: string[];
}) {
  const [idx, setIdx] = useState(0);
  const total = items.length;

  useEffect(() => {
    setIdx(0);
  }, [items]);

  return (
    <div className={`adsgo-pager-card ${variant}`}>
      <div className="adsgo-pager-card-head">
        <span className="adsgo-pager-card-title">
          <span className="adsgo-pager-card-icon">{icon}</span> {title}
        </span>
        <span className="adsgo-pager-nav">
          <button type="button" onClick={() => setIdx((idx - 1 + total) % total)} aria-label="Previous">‹</button>
          <span>{idx + 1}/{total}</span>
          <button type="button" onClick={() => setIdx((idx + 1) % total)} aria-label="Next">›</button>
        </span>
      </div>
      <p className="adsgo-pager-card-body">{items[idx]}</p>
    </div>
  );
}

export default function AdsManager({ businessId }: { businessId: string }) {
  const wsId = localStorage.getItem("adgo_workspace_id") ?? "demo";
  const [mode, setMode] = useState<Mode>("campaigns");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [liveInsightsByCampaign, setLiveInsightsByCampaign] = useState<Record<string, LiveInsights>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [network, setNetwork] = useState<Network>("meta");
  const [adInsights, setAdInsights] = useState<AdInsightsResponse | null>(null);
  const [aiInsights, setAiInsights] = useState<Insight[]>([]);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(true);
  const [applyMode, setApplyMode] = useState<"recommended" | "auto">("auto");

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [onIds, setOnIds] = useState<Set<string>>(new Set());
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const camps = await api.listCampaigns(businessId);
      setCampaigns(camps);
      setOnIds(new Set(camps.filter((c) => c.status === "active").map((c) => c.id)));

      const setsByCampaign = await Promise.all(camps.map((c) => api.listAdSets(c.id).catch(() => [])));
      const allSets = setsByCampaign.flat();
      setAdSets(allSets);

      const adsBySet = await Promise.all(allSets.map((s) => api.listAds(s.id).catch(() => [])));
      setAds(adsBySet.flat());

      const liveInsightsList = await Promise.all(camps.map((c) => api.getLiveInsights(c.id).catch(() => null)));
      setLiveInsightsByCampaign(Object.fromEntries(camps.map((c, i) => [c.id, liveInsightsList[i]]).filter(([, v]) => v)));
    } catch (err) {
      setError("Failed to load Ads Manager hierarchy data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [businessId]);

  useEffect(() => {
    api.getAdInsights(businessId, network).then(setAdInsights).catch(() => setAdInsights(null));
  }, [businessId, network]);

  // Real AI-generated analysis (insightService.ts, OpenAI-backed) is generated lazily on first
  // view rather than on a timer — avoids paying for a model call for every business regardless
  // of whether anyone is actually looking at this page.
  useEffect(() => {
    let cancelled = false;
    api.listInsights(wsId).then(async (list) => {
      if (cancelled) return;
      if (list.length > 0) {
        setAiInsights(list);
        return;
      }
      try {
        const generated = await api.generateInsights(wsId, businessId);
        if (!cancelled) setAiInsights(generated);
      } catch {
        // leave aiInsights empty — the overview falls back to a "no analysis yet" message
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  async function handleRefreshAiAnalysis() {
    setGeneratingAi(true);
    try {
      const generated = await api.generateInsights(wsId, businessId);
      setAiInsights(generated);
    } catch {
      // keep showing whatever analysis was already on screen
    } finally {
      setGeneratingAi(false);
    }
  }

  useEffect(() => {
    setPage(1);
  }, [mode, searchTerm, statusFilter, pageSize]);

  function bucketFor(c: Campaign, index: number): "scaleUp" | "scaleDown" | "pause" | "maintain" {
    if (c.status !== "active") return "maintain";
    const b = index % 3;
    if (b === 0) return "scaleUp";
    if (b === 1) return "pause";
    return "scaleDown";
  }

  function recommendedBudgetCents(c: Campaign, index: number): number {
    const bucket = bucketFor(c, index);
    if (bucket === "scaleUp") return Math.round(c.dailyBudgetCents * 1.2);
    if (bucket === "scaleDown") return Math.round(c.dailyBudgetCents * 0.85);
    if (bucket === "pause") return Math.round(c.dailyBudgetCents * 0.3);
    return c.dailyBudgetCents;
  }

  const optSummary = useMemo(() => {
    const counts = { scaleUp: 0, scaleDown: 0, pause: 0, maintain: 0 };
    let currentCents = 0;
    let recommendCents = 0;
    campaigns.forEach((c, i) => {
      counts[bucketFor(c, i)]++;
      currentCents += c.dailyBudgetCents;
      recommendCents += recommendedBudgetCents(c, i);
    });
    return { counts, currentCents, recommendCents };
  }, [campaigns]);

  function handleSelectRow(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleSelectAll(checked: boolean) {
    if (checked) {
      if (mode === "campaigns") setSelectedIds(filteredCampaigns.map((c) => c.id));
      if (mode === "adsets") setSelectedIds(filteredAdSets.map((s) => s.id));
      if (mode === "ads") setSelectedIds(filteredAds.map((a) => a.id));
    } else {
      setSelectedIds([]);
    }
  }

  async function handleBulkPause() {
    alert(`Bulk paused ${selectedIds.length} items`);
    setSelectedIds([]);
  }

  async function handleBulkDuplicate() {
    alert(`Bulk duplicated ${selectedIds.length} items`);
    setSelectedIds([]);
  }

  function toggleOn(id: string) {
    setOnIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filteredCampaigns = campaigns
    .filter((c) => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter((c) => statusFilter === "all" || c.status === statusFilter);
  const filteredAdSets = adSets
    .filter((s) => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter((s) => statusFilter === "all" || s.status === statusFilter);
  const filteredAds = ads
    .filter((a) => a.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter((a) => statusFilter === "all" || a.status === statusFilter);

  const totalItems = mode === "campaigns" ? filteredCampaigns.length : mode === "adsets" ? filteredAdSets.length : filteredAds.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const pageStart = (page - 1) * pageSize;

  const pagedCampaigns = filteredCampaigns.slice(pageStart, pageStart + pageSize);
  const pagedAdSets = filteredAdSets.slice(pageStart, pageStart + pageSize);
  const pagedAds = filteredAds.slice(pageStart, pageStart + pageSize);

  const activeCount = campaigns.filter((c) => c.status === "active").length;
  const totalBudgetCents = campaigns.reduce((sum, c) => sum + c.dailyBudgetCents, 0);

  const today = new Date().toISOString().slice(0, 10);
  const briefTitle = `${NETWORK_LABELS[network]} Ads Insights Brief`;
  const briefStats = statsFromInsights(adInsights);
  const activeAiInsights = aiInsights.filter((i) => !i.dismissed);
  const mainNarrative = activeAiInsights[0]
    ? `${activeAiInsights[0].title} — ${activeAiInsights[0].description}`
    : "No AI analysis yet for this business — click refresh to generate one from current performance data.";
  const highlights = activeAiInsights.filter((i) => i.type !== "anomaly").map((i) => `${i.title} — ${i.description}`);
  const risks = activeAiInsights.filter((i) => i.type === "anomaly").map((i) => `${i.title} — ${i.description}`);

  return (
    <div className="adsgo-ads-page">
      {/* Top bar */}
      <div className="adsgo-topbar">
        <div className="adsgo-breadcrumb">
          <span>AI Optimize</span>
          <span className="adsgo-breadcrumb-sep">›</span>
          <span className="adsgo-breadcrumb-current">Ads Manager</span>
        </div>
        <div className="adsgo-header-right">
          <div className="header-meta-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>UTC+5.5</span>
          </div>
          <div className="header-meta-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>English</span>
          </div>
          <div className="header-bell">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>
          <div className="header-profile-dropdown">
            <div className="profile-avatar">SS</div>
            <div className="profile-info">
              <span className="profile-name">ssrivastava</span>
              <span className="profile-username">ssrivastava</span>
            </div>
            <span style={{ fontSize: "10px", color: "#9ca3af", marginLeft: "4px" }}>▼</span>
          </div>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {/* Overview */}
      <div className="adsgo-overview-card">
        <div className="adsgo-overview-header">
          <h2 className="adsgo-overview-title">Overview</h2>
          <div className="adsgo-network-tabs">
            {(["meta", "google", "tiktok"] as Network[]).map((n) => (
              <button
                key={n}
                type="button"
                className={`adsgo-network-tab ${network === n ? "active" : ""}`}
                onClick={() => setNetwork(n)}
              >
                {NETWORK_LABELS[n]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`adsgo-collapse-btn ${overviewOpen ? "open" : ""}`}
            onClick={() => setOverviewOpen((o) => !o)}
            aria-label="Toggle overview"
          >
            ▲
          </button>
        </div>

        {overviewOpen && (
          <div className="adsgo-overview-body">
            <div className="adsgo-overview-grid">
              {/* Left column: insights */}
              <div className="adsgo-insights-col">
                <div className="adsgo-brief-card">
                  <div className="adsgo-brief-card-head">
                    <div>
                      <span className="adsgo-brief-title">
                        {briefTitle} {adInsights?.isDemo && <span className="adsgo-demo-badge">Demo</span>}
                      </span>
                      <div className="adsgo-brief-period">All time</div>
                    </div>
                    <button type="button" className="adsgo-icon-btn" onClick={loadData} aria-label="Refresh">
                      ↻
                    </button>
                  </div>
                  <div className="adsgo-stat-grid">
                    {briefStats.map((s) => (
                      <div className="adsgo-stat-tile" key={s.label}>
                        <div className="adsgo-stat-tile-head">
                          <span title={s.label}>{s.label}</span>
                        </div>
                        <div className="adsgo-stat-value">{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="adsgo-analysis-row">
                  <div className="adsgo-analysis-card">
                    <div className="adsgo-analysis-head">
                      <span className="adsgo-analysis-icon">✓</span>
                      <span>AI Analysis Insights</span>
                      <button type="button" className="adsgo-icon-btn adsgo-ai-refresh-btn" onClick={handleRefreshAiAnalysis} disabled={generatingAi} aria-label="Refresh AI analysis">
                        {generatingAi ? "…" : "↻"}
                      </button>
                    </div>
                    <p className="adsgo-analysis-body">{mainNarrative}</p>
                  </div>
                  <div className="adsgo-side-cards">
                    <PagerCard variant="highlight" icon="↗" title="Key Highlight" items={highlights.length > 0 ? highlights : ["No highlights yet — refresh to generate AI analysis."]} />
                    <PagerCard variant="risk" icon="⚠" title="Potential Risk" items={risks.length > 0 ? risks : ["No risks identified from current data."]} />
                  </div>
                </div>
              </div>

              {/* Right column: optimization hub */}
              <div className="adsgo-opt-col">
                <div className="adsgo-opt-hub-card">
                  <div className="adsgo-opt-hub-head">
                    <span className="adsgo-opt-hub-icon">◎</span>
                    <div>
                      <div className="adsgo-opt-hub-title">Optimization Hub</div>
                      <div className="adsgo-opt-hub-updated">Last update: {new Date().toTimeString().slice(0, 5)}</div>
                    </div>
                  </div>

                  <div className="adsgo-opt-rule-pill">
                    <span className="adsgo-opt-rule-icon">◎</span> Budget $500 · Goal: Purchases
                  </div>

                  <div className="adsgo-opt-summary-title">Summary</div>
                  <div className="adsgo-opt-summary-grid">
                    <div className="adsgo-opt-summary-item scaleup">
                      <span className="adsgo-opt-summary-count">{optSummary.counts.scaleUp}</span>
                      <span>Scale Up</span>
                    </div>
                    <div className="adsgo-opt-summary-item scaledown">
                      <span className="adsgo-opt-summary-count">{optSummary.counts.scaleDown}</span>
                      <span>Scale Down</span>
                    </div>
                    <div className="adsgo-opt-summary-item pause">
                      <span className="adsgo-opt-summary-count">{optSummary.counts.pause}</span>
                      <span>Pause</span>
                    </div>
                    <div className="adsgo-opt-summary-item maintain">
                      <span className="adsgo-opt-summary-count">{optSummary.counts.maintain}</span>
                      <span>Maintain</span>
                    </div>
                  </div>

                  <div className="adsgo-opt-budget-row">
                    <div>
                      <div className="adsgo-opt-budget-label">Current</div>
                      <div className="adsgo-opt-budget-value">${(optSummary.currentCents / 100).toFixed(0)}</div>
                    </div>
                    <div>
                      <div className="adsgo-opt-budget-label">Recommend</div>
                      <div className="adsgo-opt-budget-value accent">${(optSummary.recommendCents / 100).toFixed(0)}</div>
                    </div>
                    <div>
                      <div className="adsgo-opt-budget-label">Adjustment</div>
                      <div className={`adsgo-opt-budget-value ${optSummary.recommendCents >= optSummary.currentCents ? "up" : "down"}`}>
                        {optSummary.recommendCents >= optSummary.currentCents ? "↑" : "↓"} $
                        {Math.abs(optSummary.recommendCents - optSummary.currentCents) / 100}
                      </div>
                    </div>
                  </div>

                  <div className="adsgo-opt-mode-grid">
                    <div
                      className={`adsgo-opt-mode-card ${applyMode === "recommended" ? "selected" : ""}`}
                      onClick={() => setApplyMode("recommended")}
                    >
                      <span className="adsgo-opt-mode-icon">⟲</span>
                      <span>Recommended only</span>
                      <span className="adsgo-opt-mode-status">{applyMode === "recommended" ? "Selected" : "Off"}</span>
                    </div>
                    <div
                      className={`adsgo-opt-mode-card ${applyMode === "auto" ? "selected" : ""}`}
                      onClick={() => setApplyMode("auto")}
                    >
                      {applyMode === "auto" && <span className="adsgo-best-choice-tag">Best choice</span>}
                      <span className="adsgo-opt-mode-icon">∞</span>
                      <span>Auto-apply</span>
                      <span className="adsgo-opt-mode-status">{applyMode === "auto" ? "Selected" : "Off"}</span>
                    </div>
                  </div>

                  <div className="adsgo-opt-schedule-row">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    Daily | 23:00PM - 00:00AM
                  </div>
                </div>
              </div>
            </div>

            {campaigns.length === 0 && !loading && (
              <div className="adsgo-demo-banner">
                <div className="adsgo-demo-banner-inner">
                  <span className="adsgo-demo-banner-icon">ⓘ</span>
                  <span className="adsgo-demo-banner-text">Demo data only. Create your first campaign to view performance data.</span>
                  <Link to="/campaigns/new" className="btn btn-primary adsgo-demo-banner-btn">✨ Create campaign</Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Table section */}
      <div className="adsgo-table-section">
        <div className="adsgo-table-tabs">
          <button className={`adsgo-table-tab ${mode === "campaigns" ? "active" : ""}`} onClick={() => { setMode("campaigns"); setSelectedIds([]); }}>
            📁 Campaign
          </button>
          <button className={`adsgo-table-tab ${mode === "adsets" ? "active" : ""}`} onClick={() => { setMode("adsets"); setSelectedIds([]); }}>
            ▦ Ad set
          </button>
          <button className={`adsgo-table-tab ${mode === "ads" ? "active" : ""}`} onClick={() => { setMode("ads"); setSelectedIds([]); }}>
            📄 Ad
          </button>
        </div>

        <div className="adsgo-table-filter-row">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Campaign..."
            className="search-input"
            style={{ maxWidth: 220 }}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="adsgo-account-select">
            <option value="all">Ad account: All</option>
            <option value="active">Active Only</option>
            <option value="paused">Paused Only</option>
          </select>
          <div className="adsgo-date-range-display">
            {today} <span>→</span> {today}
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div className="bulk-actions-bar">
            <span>{selectedIds.length} Selected</span>
            <button className="btn btn-sm btn-secondary" onClick={handleBulkPause}>⏸ Pause</button>
            <button className="btn btn-sm btn-secondary" onClick={handleBulkDuplicate}>📋 Duplicate</button>
          </div>
        )}

        {loading ? (
          <div className="campaigns-loading">
            {[1, 2, 3].map((i) => <div key={i} className="campaign-row-skeleton" />)}
          </div>
        ) : (
          <Reveal>
            <div className="adsgo-manager-table-wrap">
              <table className="adsgo-manager-table">
                {mode === "campaigns" && (
                  <>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>
                          <input
                            type="checkbox"
                            onChange={(e) => handleSelectAll(e.target.checked)}
                            checked={selectedIds.length === filteredCampaigns.length && filteredCampaigns.length > 0}
                          />
                        </th>
                        <th style={{ width: 60 }}>Off/On</th>
                        <th>Advertising Campaign</th>
                        <th>Status</th>
                        <th>Location</th>
                        <th>Goal</th>
                        <th>Daily Budget</th>
                        <th>Spend</th>
                        <th>Impressions</th>
                        <th>Clicks</th>
                        <th>CTR</th>
                        <th>Conversions</th>
                        <th>ROAS</th>
                        <th>Recommend</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="adsgo-total-row">
                        <td></td>
                        <td></td>
                        <td>
                          <strong>Total</strong>
                          <div className="adsgo-total-sub">{activeCount}/{campaigns.length} Active</div>
                        </td>
                        <td>-</td>
                        <td>-</td>
                        <td>-</td>
                        <td>${(totalBudgetCents / 100).toFixed(2)}</td>
                        <td>${(Object.values(liveInsightsByCampaign).reduce((s, li) => s + li.spendCents, 0) / 100).toFixed(2)}</td>
                        <td>{Object.values(liveInsightsByCampaign).reduce((s, li) => s + li.impressions, 0).toLocaleString()}</td>
                        <td>{Object.values(liveInsightsByCampaign).reduce((s, li) => s + li.clicks, 0).toLocaleString()}</td>
                        <td>-</td>
                        <td>{Object.values(liveInsightsByCampaign).reduce((s, li) => s + li.conversions, 0).toLocaleString()}</td>
                        <td>-</td>
                        <td>-</td>
                      </tr>
                      {pagedCampaigns.map((c, i) => {
                        const globalIndex = pageStart + i;
                        const bucket = bucketFor(c, globalIndex);
                        const recommendedCents = recommendedBudgetCents(c, globalIndex);
                        const hasSuggestion = bucket !== "maintain" && !acceptedIds.has(c.id) && !dismissedIds.has(c.id);
                        const li = liveInsightsByCampaign[c.id];
                        return (
                          <tr key={c.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(c.id)}
                                onChange={() => handleSelectRow(c.id)}
                              />
                            </td>
                            <td>
                              <ToggleSwitch on={onIds.has(c.id)} onToggle={() => toggleOn(c.id)} />
                            </td>
                            <td>
                              <div className="adsgo-campaign-cell">
                                <strong>{c.name}</strong>
                                <span className="adsgo-campaign-id">({c.id})</span>
                              </div>
                            </td>
                            <td>
                              <StatusBadge status={c.status} />
                            </td>
                            <td>
                              <span className="adsgo-pill location">US</span>
                            </td>
                            <td>
                              <span className="adsgo-pill goal">OUTCOME_SALES</span>
                            </td>
                            <td>${(c.dailyBudgetCents / 100).toFixed(2)}</td>
                            <td>{li ? `$${(li.spendCents / 100).toFixed(2)}` : "—"}</td>
                            <td>{li ? li.impressions.toLocaleString() : "—"}</td>
                            <td>{li ? li.clicks.toLocaleString() : "—"}</td>
                            <td>{li ? `${li.ctr.toFixed(2)}%` : "—"}</td>
                            <td>{li ? li.conversions.toLocaleString() : "—"}</td>
                            <td>{li?.roas != null ? `${li.roas.toFixed(2)}x` : "—"}</td>
                            <td>
                              {hasSuggestion ? (
                                <div className="adsgo-recommend-cell">
                                  <span className="adsgo-recommend-value">
                                    ${(c.dailyBudgetCents / 100).toFixed(0)} <span className="up">↗</span> ${(recommendedCents / 100).toFixed(0)}
                                  </span>
                                  <button
                                    type="button"
                                    className="adsgo-accept-btn"
                                    onClick={() => setAcceptedIds((prev) => new Set(prev).add(c.id))}
                                  >
                                    Accept
                                  </button>
                                  <button
                                    type="button"
                                    className="adsgo-reject-btn"
                                    aria-label="Dismiss suggestion"
                                    onClick={() => setDismissedIds((prev) => new Set(prev).add(c.id))}
                                  >
                                    👎
                                  </button>
                                </div>
                              ) : (
                                <span className="adsgo-recommend-empty">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {pagedCampaigns.length === 0 && (
                        <tr>
                          <td colSpan={14}>
                            <div className="adsgo-table-empty">
                              <p>No campaigns match your filters.</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </>
                )}

                {mode === "adsets" && (
                  <>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>
                          <input
                            type="checkbox"
                            onChange={(e) => handleSelectAll(e.target.checked)}
                            checked={selectedIds.length === filteredAdSets.length && filteredAdSets.length > 0}
                          />
                        </th>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Bid Strategy</th>
                        <th>Daily Budget</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedAdSets.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <input type="checkbox" checked={selectedIds.includes(s.id)} onChange={() => handleSelectRow(s.id)} />
                          </td>
                          <td><strong>{s.name}</strong></td>
                          <td><StatusBadge status={s.status} /></td>
                          <td>{s.bidStrategy}</td>
                          <td>${(s.dailyBudgetCents / 100).toFixed(2)}</td>
                        </tr>
                      ))}
                      {pagedAdSets.length === 0 && (
                        <tr>
                          <td colSpan={5}>
                            <div className="adsgo-table-empty">
                              <p>No ad sets yet. Ad sets you create for a campaign will appear here.</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </>
                )}

                {mode === "ads" && (
                  <>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>
                          <input
                            type="checkbox"
                            onChange={(e) => handleSelectAll(e.target.checked)}
                            checked={selectedIds.length === filteredAds.length && filteredAds.length > 0}
                          />
                        </th>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Format</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedAds.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <input type="checkbox" checked={selectedIds.includes(a.id)} onChange={() => handleSelectRow(a.id)} />
                          </td>
                          <td>
                            <div className="flex gap-2 items-center">
                              {a.creative.imageUrl && <img src={a.creative.imageUrl} alt="Ad Thumbnail" style={{ width: 28, height: 28, borderRadius: 4 }} />}
                              <strong>{a.name}</strong>
                            </div>
                          </td>
                          <td><StatusBadge status={a.status} /></td>
                          <td>{a.format}</td>
                        </tr>
                      ))}
                      {pagedAds.length === 0 && (
                        <tr>
                          <td colSpan={4}>
                            <div className="adsgo-table-empty">
                              <p>No ads yet. Ads you create within an ad set will appear here.</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </>
                )}
              </table>
            </div>

            <div className="adsgo-pagination">
              <span>Total {totalItems} items</span>
              <div className="adsgo-pagination-controls">
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
                <span className="adsgo-page-box">{page}</span>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>›</button>
              </div>
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                <option value={10}>10 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
              </select>
            </div>
          </Reveal>
        )}
      </div>
    </div>
  );
}
