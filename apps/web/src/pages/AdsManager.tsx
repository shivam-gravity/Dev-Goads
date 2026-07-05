import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, Campaign, AdSet, Ad } from "../api/client.js";
import StatusBadge from "../components/StatusBadge.js";
import Reveal from "../components/Reveal.js";

type Mode = "campaigns" | "adsets" | "ads";
type Network = "meta" | "google" | "tiktok";
type Sentiment = "good" | "bad";

interface BriefStat {
  label: string;
  value: string;
  delta: string;
  trend: "up" | "down";
  sentiment: Sentiment;
}

const NETWORK_LABELS: Record<Network, string> = { meta: "Meta", google: "Google", tiktok: "Tiktok" };

const INSIGHTS_BRIEF: Record<Network, { title: string; stats: BriefStat[] }> = {
  meta: {
    title: "Meta Ads Insights Brief",
    stats: [
      { label: "Spend", value: "$1580.38", delta: "-54.88%", trend: "down", sentiment: "bad" },
      { label: "Purchase", value: "27", delta: "-25.00%", trend: "down", sentiment: "bad" },
      { label: "Cost Per Purchase", value: "$58.53", delta: "-39.84%", trend: "down", sentiment: "good" },
      { label: "ROAS", value: "2.44x", delta: "+87.69%", trend: "up", sentiment: "good" },
    ],
  },
  google: {
    title: "Google Ads Insights Brief",
    stats: [
      { label: "Spend", value: "$942.10", delta: "-18.32%", trend: "down", sentiment: "bad" },
      { label: "Conversions", value: "41", delta: "+12.50%", trend: "up", sentiment: "good" },
      { label: "Cost Per Conversion", value: "$22.98", delta: "-27.10%", trend: "down", sentiment: "good" },
      { label: "ROAS", value: "3.12x", delta: "+21.40%", trend: "up", sentiment: "good" },
    ],
  },
  tiktok: {
    title: "Tiktok Ads Insights Brief",
    stats: [
      { label: "Spend", value: "$310.55", delta: "+64.20%", trend: "up", sentiment: "bad" },
      { label: "Purchase", value: "9", delta: "-10.00%", trend: "down", sentiment: "bad" },
      { label: "Cost Per Purchase", value: "$34.51", delta: "+8.75%", trend: "up", sentiment: "bad" },
      { label: "ROAS", value: "1.62x", delta: "-14.90%", trend: "down", sentiment: "bad" },
    ],
  },
};

const AI_ANALYSIS: Record<Network, string> = {
  meta: "Brand performance shows exceptional efficiency surge with CPA improving 62.6% to $23.30 (251% of target) and ROAS doubling to 481%, but conversion volume dropped 85% from 27 to 2 purchases while only utilizing 19% of available budget, indicating strong efficiency gains constrained by scaling limitations.",
  google: "Search performance remains efficient with cost per conversion down 27.1% and ROAS up 21.4%, driven by higher-intent keyword traffic. Conversion volume grew alongside the efficiency gains, suggesting there is room to raise daily budgets without losing performance.",
  tiktok: "Tiktok spend rose sharply while purchases and ROAS declined, pointing to creative fatigue on the top-spending ad. Cost per purchase is trending upward — pausing the weakest ad set is recommended before increasing budget further.",
};

const KEY_HIGHLIGHTS: Record<Network, string[]> = {
  meta: [
    "Outstanding CPA achievement: $23.30 vs target $58.41 (251% over-target), representing best performance in analysis period",
    "ROAS more than doubled week-over-week, now sitting at 481% against a 250% target",
    "Top ad set held frequency under 1.8, keeping creative fatigue risk low despite reduced spend",
  ],
  google: [
    "Search conversions up 12.5% while cost per conversion fell 27.1% — the most efficient period in 30 days",
    "Branded keyword segment now delivers the lowest CPA across all ad groups",
    "Quality Score improved on 3 of 5 top keywords after the latest ad copy refresh",
  ],
  tiktok: [
    "Top-performing video creative still holds a 2.1x ROAS despite the account-wide dip",
    "Audience retargeting segment is outperforming cold prospecting by 3.4x on cost per purchase",
    "Evening posting window (6-9pm) continues to drive the highest engagement rate",
  ],
};

const POTENTIAL_RISKS: Record<Network, string[]> = {
  meta: [
    "Budget underutilization: only 19% of available daily budget spent during peak efficiency period — estimated $193+ revenue opportunity missed",
    "Purchase volume fell 85% period over period — verify tracking and inventory before scaling budget back up",
    "One ad set has not refreshed creative in 21 days; frequency is beginning to climb",
  ],
  google: [
    "Two low-volume keywords are absorbing 8% of spend with no conversions in 14 days",
    "Mobile placements convert 30% below desktop — consider a bid adjustment",
    "Search impression share dropped 6pts this week, likely due to rising competitor bids",
  ],
  tiktok: [
    "Spend increased 64% while ROAS fell — likely creative fatigue on the primary ad",
    "Cost per purchase has risen for 3 consecutive days on the top ad set",
    "Audience overlap between two ad sets may be inflating frequency and cost",
  ],
};

function trendArrow(trend: "up" | "down") {
  return trend === "up" ? "↗" : "↘";
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
  const [mode, setMode] = useState<Mode>("campaigns");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [network, setNetwork] = useState<Network>("meta");
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
  const brief = INSIGHTS_BRIEF[network];

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
                        {brief.title} <span className="adsgo-demo-badge">Demo</span>
                      </span>
                      <div className="adsgo-brief-period">Last 14 days</div>
                    </div>
                    <button type="button" className="adsgo-icon-btn" onClick={loadData} aria-label="Refresh">
                      ↻
                    </button>
                  </div>
                  <div className="adsgo-stat-grid">
                    {brief.stats.map((s) => (
                      <div className="adsgo-stat-tile" key={s.label}>
                        <div className="adsgo-stat-tile-head">
                          <span>{s.label}</span>
                          <span className={`adsgo-trend-badge ${s.trend} ${s.sentiment}`}>
                            {trendArrow(s.trend)} {s.delta}
                          </span>
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
                    </div>
                    <p className="adsgo-analysis-body">{AI_ANALYSIS[network]}</p>
                  </div>
                  <div className="adsgo-side-cards">
                    <PagerCard variant="highlight" icon="↗" title="Key Highlight" items={KEY_HIGHLIGHTS[network]} />
                    <PagerCard variant="risk" icon="⚠" title="Potential Risk" items={POTENTIAL_RISKS[network]} />
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
                    <span className="adsgo-opt-rule-icon">◎</span> Budget $500, PURCHASE, CPA ≤ –
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
                      <span className="adsgo-opt-mode-status">Paused</span>
                    </div>
                    <div
                      className={`adsgo-opt-mode-card ${applyMode === "auto" ? "selected" : ""}`}
                      onClick={() => setApplyMode("auto")}
                    >
                      {applyMode === "auto" && <span className="adsgo-best-choice-tag">Best choice</span>}
                      <span className="adsgo-opt-mode-icon">∞</span>
                      <span>Auto-apply</span>
                      <span className="adsgo-opt-mode-status">Paused</span>
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
                <span className="adsgo-demo-banner-icon">ⓘ</span>
                <span className="adsgo-demo-banner-text">Demo data only. Create your first campaign to view performance data.</span>
                <Link to="/campaigns/new" className="btn btn-primary adsgo-demo-banner-btn">✨ Create campaign</Link>
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
                        <td>-</td>
                      </tr>
                      {pagedCampaigns.map((c, i) => {
                        const globalIndex = pageStart + i;
                        const bucket = bucketFor(c, globalIndex);
                        const recommendedCents = recommendedBudgetCents(c, globalIndex);
                        const hasSuggestion = bucket !== "maintain" && !acceptedIds.has(c.id) && !dismissedIds.has(c.id);
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
                          <td colSpan={8}>
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
