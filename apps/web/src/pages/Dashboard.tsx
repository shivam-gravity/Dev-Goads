import { useEffect, useState } from "react";
import { api, BusinessProfile, Campaign } from "../api/client.js";

export default function Dashboard({ businessId }: { businessId: string }) {
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Dashboard state to match screenshot interactivity
  const [activePeriod, setActivePeriod] = useState("Last 7 days");
  const [activeMetric, setActiveMetric] = useState("Spend");
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  async function refresh() {
    try {
      const [biz, camps] = await Promise.all([
        api.getBusiness(businessId),
        api.listCampaigns(businessId),
      ]);
      setBusiness(biz);
      setCampaigns(camps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    }
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [businessId]);

  // Generate dynamic date list for the last 7 days ending today
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }
  
  // Newest to oldest for table
  const tableDates = [...dates];
  // Oldest to newest for chart
  const chartDates = [...dates].reverse();

  // Selected date range string matching screenshot
  const dateRangeStr = `${chartDates[0]}  →  ${chartDates[6]}`;

  return (
    <div className="adsgo-dashboard">
      {/* Custom Header matching screenshot */}
      <header className="adsgo-header">
        <h1 className="adsgo-header-title">Home</h1>
        <div className="adsgo-header-right">
          {/* UTC Label */}
          <div className="header-meta-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>UTC+5.5</span>
          </div>

          {/* Language Selector */}
          <div className="header-meta-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>English</span>
          </div>

          {/* Bell Icon */}
          <div className="header-bell">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>

          {/* Profile Dropdown */}
          <div className="header-profile-dropdown" onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}>
            <div className="profile-avatar">SS</div>
            <div className="profile-info">
              <span className="profile-name">ssrivastava</span>
              <span className="profile-username">ssrivastava</span>
            </div>
            <span style={{ fontSize: "10px", color: "#9ca3af", marginLeft: "4px" }}>▼</span>
          </div>
        </div>
      </header>

      {error && <p className="error" style={{ marginBottom: "20px" }}>{error}</p>}

      {/* Date Controls Row */}
      <div className="adsgo-controls-row">
        <div className="adsgo-date-pills">
          {["Last 7 days", "Last 14 days", "Last 30 days", "Last 90 days", "Today"].map((period) => (
            <button
              key={period}
              className={`adsgo-date-pill ${activePeriod === period ? "active" : ""}`}
              onClick={() => setActivePeriod(period)}
            >
              {period}
            </button>
          ))}
        </div>

        {/* Datepicker Mock */}
        <div className="adsgo-datepicker-container">
          <input type="text" readOnly value={dateRangeStr} />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="adsgo-metrics-grid">
        {/* Spend Card */}
        <div
          className={`adsgo-metric-card ${activeMetric === "Spend" ? "active" : ""}`}
          onClick={() => setActiveMetric("Spend")}
        >
          <div className="adsgo-metric-card-top">
            <span className="metric-dot purple"></span>
            <span>Spend</span>
          </div>
          <div className="metric-checkbox">
            {activeMetric === "Spend" && <span className="metric-checkbox-tick">✓</span>}
          </div>
          <div className="metric-value">$0</div>
        </div>

        {/* CPM Card */}
        <div
          className={`adsgo-metric-card ${activeMetric === "CPM" ? "active" : ""}`}
          onClick={() => setActiveMetric("CPM")}
        >
          <div className="adsgo-metric-card-top">
            <span className="metric-dot grey"></span>
            <span>CPM</span>
          </div>
          <div className="metric-checkbox">
            {activeMetric === "CPM" && <span className="metric-checkbox-tick">✓</span>}
          </div>
          <div className="metric-value">$0</div>
        </div>

        {/* CPC Card */}
        <div
          className={`adsgo-metric-card ${activeMetric === "CPC" ? "active" : ""}`}
          onClick={() => setActiveMetric("CPC")}
        >
          <div className="adsgo-metric-card-top">
            <span className="metric-dot grey"></span>
            <span>CPC</span>
          </div>
          <div className="metric-checkbox">
            {activeMetric === "CPC" && <span className="metric-checkbox-tick">✓</span>}
          </div>
          <div className="metric-value">$0</div>
        </div>

        {/* CTR Card */}
        <div
          className={`adsgo-metric-card ${activeMetric === "CTR" ? "active" : ""}`}
          onClick={() => setActiveMetric("CTR")}
        >
          <div className="adsgo-metric-card-top">
            <span className="metric-dot grey"></span>
            <span>CTR</span>
          </div>
          <div className="metric-checkbox">
            {activeMetric === "CTR" && <span className="metric-checkbox-tick">✓</span>}
          </div>
          <div className="metric-value">0%</div>
        </div>
      </div>

      {/* SVG Chart Card */}
      <div className="adsgo-chart-card">
        <svg width="100%" height="240" viewBox="0 0 1000 240" preserveAspectRatio="none">
          <defs>
            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7033f5" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#7033f5" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 1, 2, 3, 4, 5].map((idx) => (
            <line
              key={idx}
              x1="60"
              y1={30 + idx * 34}
              x2="940"
              y2={30 + idx * 34}
              stroke="#f3f4f6"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
          ))}

          {/* Y-axis Ticks */}
          {[1, 0.8, 0.6, 0.4, 0.2, 0].map((val, idx) => (
            <text
              key={val}
              x="45"
              y={34 + idx * 34}
              fill="#9ca3af"
              fontSize="12"
              fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
              textAnchor="end"
            >
              {val}
            </text>
          ))}

          {/* X-axis line */}
          <line x1="60" y1="200" x2="940" y2="200" stroke="#e5e7eb" strokeWidth="1" />

          {/* X-axis date labels */}
          {chartDates.map((date, idx) => (
            <text
              key={date}
              x={100 + idx * 130}
              y="222"
              fill="#9ca3af"
              fontSize="12"
              fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
              textAnchor="middle"
            >
              {date}
            </text>
          ))}

          {/* Performance Line (Flat at Y=200, corresponding to 0 value) */}
          <polyline
            points="100,200 230,200 360,200 490,200 620,200 750,200 880,200"
            fill="none"
            stroke="#7033f5"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Gradient area under flat line (for visual completion matching active state styles) */}
          <path
            d="M 100,200 L 880,200 L 880,200 L 100,200 Z"
            fill="url(#chartGrad)"
          />
        </svg>

        {/* Avg metric indicator */}
        <div className="chart-avg-badge">
          Avg Spend
        </div>
      </div>

      {/* Daily Performance Section */}
      <section className="adsgo-section">
        <div className="adsgo-section-header">
          <div className="adsgo-section-indicator"></div>
          <h2 className="adsgo-section-title">Daily Performance</h2>
        </div>

        <div className="adsgo-table-container">
          <table className="adsgo-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Spend</th>
                <th>Impressions</th>
                <th>CPM</th>
                <th>Clicks</th>
                <th>CPC</th>
                <th>CTR</th>
              </tr>
            </thead>
            <tbody>
              {tableDates.map((date) => (
                <tr key={date}>
                  <td style={{ fontWeight: 500, color: "#4b5563" }}>{date}</td>
                  <td>$0</td>
                  <td>0</td>
                  <td>$0</td>
                  <td>0</td>
                  <td>$0</td>
                  <td>0%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
