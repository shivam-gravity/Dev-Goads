import { useEffect, useState } from "react";
import { api, Campaign, AdSet, Ad } from "../api/client.js";
import StatusBadge, { NetworkBadge } from "../components/StatusBadge.js";
import Reveal from "../components/Reveal.js";

type Mode = "campaigns" | "adsets" | "ads";

export default function AdsManager({ businessId }: { businessId: string }) {
  const [mode, setMode] = useState<Mode>("campaigns");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adSets, setAdSets] = useState<AdSet[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const camps = await api.listCampaigns(businessId);
      setCampaigns(camps);

      // Resolve nested ad sets and ads for the first campaign as demo if none exist
      const firstCamp = camps[0];
      if (firstCamp) {
        const sets = await api.listAdSets(firstCamp.id).catch(() => []);
        setAdSets(sets);
        
        const firstSet = sets[0];
        if (firstSet) {
          const adItems = await api.listAds(firstSet.id).catch(() => []);
          setAds(adItems);
        } else {
          setAds([]);
        }
      } else {
        setAdSets([]);
        setAds([]);
      }
    } catch (err) {
      setError("Failed to load Ads Manager hierarchy data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [businessId]);

  function handleSelectRow(id: string) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function handleSelectAll(checked: boolean) {
    if (checked) {
      if (mode === "campaigns") setSelectedIds(campaigns.map(c => c.id));
      if (mode === "adsets") setSelectedIds(adSets.map(s => s.id));
      if (mode === "ads") setSelectedIds(ads.map(a => a.id));
    } else {
      setSelectedIds([]);
    }
  }

  async function handleBulkPause() {
    // Demo implementation
    alert(`Bulk paused ${selectedIds.length} items`);
    setSelectedIds([]);
  }

  async function handleBulkDuplicate() {
    alert(`Bulk duplicated ${selectedIds.length} items`);
    setSelectedIds([]);
  }

  return (
    <div className="ads-manager">
      <div className="page-header">
        <div>
          <h1>Ads Manager</h1>
          <p className="subtitle">Detailed campaign tree manager with multi-network controls.</p>
        </div>
        <div className="campaign-detail-actions">
          {selectedIds.length > 0 && (
            <div className="bulk-actions-bar">
              <span>{selectedIds.length} Selected</span>
              <button className="btn btn-sm btn-secondary" onClick={handleBulkPause}>⏸ Pause</button>
              <button className="btn btn-sm btn-secondary" onClick={handleBulkDuplicate}>📋 Duplicate</button>
            </div>
          )}
          <button className="btn btn-primary" onClick={loadData}>↻ Sync Network</button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {/* Tabs */}
      <div className="status-tabs">
        <button className={`status-tab ${mode === "campaigns" ? "active" : ""}`} onClick={() => { setMode("campaigns"); setSelectedIds([]); }}>
          Campaigns ({campaigns.length})
        </button>
        <button className={`status-tab ${mode === "adsets" ? "active" : ""}`} onClick={() => { setMode("adsets"); setSelectedIds([]); }}>
          Ad Sets ({adSets.length})
        </button>
        <button className={`status-tab ${mode === "ads" ? "active" : ""}`} onClick={() => { setMode("ads"); setSelectedIds([]); }}>
          Ads ({ads.length})
        </button>
      </div>

      {/* Filters */}
      <div className="manager-filter-bar mb-4">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter by name..."
          className="search-input"
          style={{ maxWidth: 260 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="active">Active Only</option>
          <option value="paused">Paused Only</option>
        </select>
      </div>

      {loading ? (
        <div className="campaigns-loading">
          {[1, 2, 3].map(i => <div key={i} className="campaign-row-skeleton" />)}
        </div>
      ) : (
        <Reveal>
          <div className="campaigns-table-wrap">
            <table className="campaigns-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      checked={
                        mode === "campaigns" ? selectedIds.length === campaigns.length && campaigns.length > 0 :
                        mode === "adsets" ? selectedIds.length === adSets.length && adSets.length > 0 :
                        selectedIds.length === ads.length && ads.length > 0
                      }
                    />
                  </th>
                  <th>Name</th>
                  {mode === "campaigns" && <th>Networks</th>}
                  <th>Status</th>
                  {mode === "campaigns" && <th>Daily Budget</th>}
                  {mode === "adsets" && <th>Bid Strategy</th>}
                  {mode === "ads" && <th>Format</th>}
                  <th>Spend</th>
                  <th>Impressions</th>
                  <th>Clicks</th>
                  <th>CTR</th>
                </tr>
              </thead>
              <tbody>
                {mode === "campaigns" && campaigns
                  .filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
                  .filter(c => statusFilter === "all" || c.status === statusFilter)
                  .map((c) => (
                    <tr key={c.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(c.id)}
                          onChange={() => handleSelectRow(c.id)}
                        />
                      </td>
                      <td>
                        <strong>{c.name}</strong>
                      </td>
                      <td>
                        <div className="network-badges">
                          {c.networks.map(n => <NetworkBadge key={n} network={n} />)}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={c.status} />
                      </td>
                      <td>${(c.dailyBudgetCents / 100).toFixed(0)}/day</td>
                      <td>$124.50</td>
                      <td>12,450</td>
                      <td>324</td>
                      <td>2.60%</td>
                    </tr>
                  ))}

                {mode === "adsets" && adSets
                  .filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
                  .filter(s => statusFilter === "all" || s.status === statusFilter)
                  .map((s) => (
                    <tr key={s.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(s.id)}
                          onChange={() => handleSelectRow(s.id)}
                        />
                      </td>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td>{s.bidStrategy}</td>
                      <td>${(s.dailyBudgetCents / 100).toFixed(0)}/day</td>
                      <td>10,200</td>
                      <td>211</td>
                      <td>2.07%</td>
                    </tr>
                  ))}

                {mode === "ads" && ads
                  .filter(a => a.name.toLowerCase().includes(searchTerm.toLowerCase()))
                  .filter(a => statusFilter === "all" || a.status === statusFilter)
                  .map((a) => (
                    <tr key={a.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(a.id)}
                          onChange={() => handleSelectRow(a.id)}
                        />
                      </td>
                      <td>
                        <div className="flex gap-2 items-center">
                          {a.creative.imageUrl && <img src={a.creative.imageUrl} alt="Ad Thumbnail" style={{ width: 28, height: 28, borderRadius: 4 }} />}
                          <strong>{a.name}</strong>
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
                      <td>{a.format}</td>
                      <td>$24.50</td>
                      <td>2,250</td>
                      <td>113</td>
                      <td>5.02%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      )}
    </div>
  );
}
