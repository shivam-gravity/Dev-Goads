import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, AudienceAnalysis, Insight, ProductAnalysis, ScrapedSite } from "../api/client.js";
import Reveal from "../components/Reveal.js";
import { ClockIcon, GlobeIcon, SparkleIcon, XIcon } from "../components/icons.js";

const SEVERITY_COLORS = {
  high: "var(--danger)",
  medium: "var(--accent)",
  low: "var(--muted)"
};

const CATEGORY_FILTERS: { value: "all" | Insight["category"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "budget", label: "Budget" },
  { value: "audience", label: "Audience" },
  { value: "creative", label: "Creative" },
  { value: "placement", label: "Placement" },
];

interface KnowledgeItem {
  id: string;
  name: string;
  industry: string;
  objective: string;
  platform: "Meta Ads" | "Google Ads" | "Omnichannel";
  budget: string;
  roas: string;
  ctr: string;
  creativeType: string;
  audience: string;
  rationale: string;
  tags: string[];
}

const KNOWLEDGE_BASE_ITEMS: KnowledgeItem[] = [
  {
    id: "kb-1",
    name: "Omnichannel Lead Gen scale",
    industry: "SaaS & services",
    objective: "Lead Generation",
    platform: "Omnichannel",
    budget: "$3,000 - $5,000 / mo",
    roas: "4.5x",
    ctr: "2.8%",
    creativeType: "Text Search + Square Promo Variant",
    audience: "B2B Retargeting + 1% Lookalike",
    rationale: "Google Search Ads captured high-intent keyword search traffic, while Meta Ads retargeted visitors with value-prop case study graphics, maximizing direct conversions.",
    tags: ["SaaS", "B2B", "Lead-Gen", "Epsilon-Greedy"]
  },
  {
    id: "kb-2",
    name: "Summer Season Promo campaign",
    industry: "E-commerce",
    objective: "Sales & Catalog Conversions",
    platform: "Meta Ads",
    budget: "$5,000 - $10,000 / mo",
    roas: "5.2x",
    ctr: "3.4%",
    creativeType: "Carousel + Video UGC Promo",
    audience: "Interests: Fashion & Online Shoppers",
    rationale: "UGC style video review creative variants drove 60% lower acquisition cost than standard product catalog shots. Epsilon-greedy optimization shifted budget automatically to the video variant within 3 days.",
    tags: ["Retail", "D2C", "Social", "Creative-Fatigue"]
  },
  {
    id: "kb-3",
    name: "Local Service Expansion booking",
    industry: "Local services",
    objective: "Local Bookings",
    platform: "Google Ads",
    budget: "$1,000 - $2,500 / mo",
    roas: "3.8x",
    ctr: "5.1%",
    creativeType: "Local Map Search + Call Ads",
    audience: "Local Radius (15 miles)",
    rationale: "Call-only ads during service operating hours generated double the booking conversion rate compared to landing page bookings.",
    tags: ["Services", "Map-Ads", "Lead-Gen", "Schedules"]
  }
];

export default function AIInsights({ businessId }: { businessId: string }) {
  const navigate = useNavigate();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<"all" | Insight["category"]>("all");

  // Tabs & Search State
  const [activeTab, setActiveTab] = useState<"insights" | "kb">("insights");
  const [searchQuery, setSearchQuery] = useState("");

  // Brand Profile analysis modal state
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [brandUrl, setBrandUrl] = useState("");
  const [brandStep, setBrandStep] = useState<"form" | "analyzing-product" | "analyzing-audience" | "result">("form");
  const [brandError, setBrandError] = useState<string | null>(null);
  const [brandProduct, setBrandProduct] = useState<ProductAnalysis | null>(null);
  const [brandAudience, setBrandAudience] = useState<AudienceAnalysis | null>(null);

  const wsId = localStorage.getItem("polluxa_workspace_id") ?? "demo-workspace";

  async function loadInsights() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listInsights(wsId);
      setInsights(data.filter(i => !i.dismissed));
    } catch (err) {
      setError("Failed to fetch performance insights.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInsights();
  }, [businessId]);

  async function handleDismiss(id: string) {
    try {
      await api.dismissInsight(id);
      setInsights(prev => prev.filter(i => i.id !== id));
    } catch {
      setError("Failed to dismiss insight.");
    }
  }

  async function handleApplyAction(insight: Insight) {
    if (!insight.actionLabel) return;
    setRunningAction(insight.id);
    try {
      if (insight.category === "budget") {
        const camps = await api.listCampaigns(businessId);
        const activeCamps = camps.filter(c => c.status === "active");
        if (activeCamps[0]) {
          const currentBudget = activeCamps[0].dailyBudgetCents;
          const newBudget = Math.round(currentBudget * 1.15); // +15%
          await api.updateCampaign(activeCamps[0].id, { dailyBudgetCents: newBudget });
        }
        await handleDismiss(insight.id);
      } else {
        // Audience/creative/placement suggestions don't have a one-click mutation here —
        // surface the recommendation by taking the user to where they'd act on it
        // (Audience Builder, Creative Studio, or the campaign itself for placement changes)
        // rather than faking a delay and pretending something happened.
        if (insight.actionUrl) navigate(insight.actionUrl);
        await handleDismiss(insight.id);
      }
    } catch (err) {
      setError("Failed to apply optimization.");
    } finally {
      setRunningAction(null);
    }
  }

  function openBrandModal() {
    setBrandUrl("");
    setBrandStep("form");
    setBrandError(null);
    setBrandProduct(null);
    setBrandAudience(null);
    setBrandModalOpen(true);
  }

  function closeBrandModal() {
    setBrandModalOpen(false);
  }

  async function handleStartAnalysis(e: FormEvent) {
    e.preventDefault();
    setBrandError(null);
    setBrandStep("analyzing-product");
    try {
      const scraped: ScrapedSite = await api.scrapeWebsite(brandUrl);
      const product = await api.analyzeProduct(scraped);
      setBrandProduct(product);
      setBrandStep("analyzing-audience");
      const audience = await api.analyzeAudience(scraped, product);
      setBrandAudience(audience);
      setBrandStep("result");
    } catch (err) {
      setBrandError(err instanceof Error ? err.message : "Couldn't analyze that website");
      setBrandStep("form");
    }
  }

  // Filter Knowledge Base items
  const filteredKb = KNOWLEDGE_BASE_ITEMS.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.industry.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.rationale.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="page-insights">
      <div className="page-header">
        <div>
          <h1>AI Knowledge &amp; Recommendations</h1>
          <p className="subtitle">Review real-time budget diagnostics and browse our historical playbook of winning ad variants.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openBrandModal}>
          <SparkleIcon /> Create Brand Profile
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {/* Sub tabs navigation */}
      <nav className="admin-tabs-nav">
        <button
          className={`admin-tab-link ${activeTab === "insights" ? "active" : ""}`}
          onClick={() => setActiveTab("insights")}
          style={{ background: "none", border: "none", borderBottom: activeTab === "insights" ? "2px solid #7033f5" : "2px solid transparent", cursor: "pointer" }}
        >
          Active Recommendations
        </button>
        <button
          className={`admin-tab-link ${activeTab === "kb" ? "active" : ""}`}
          onClick={() => setActiveTab("kb")}
          style={{ background: "none", border: "none", borderBottom: activeTab === "kb" ? "2px solid #7033f5" : "2px solid transparent", cursor: "pointer" }}
        >
          Optimization Playbook
        </button>
      </nav>

      {activeTab === "insights" && (
        <div className="insights-category-filters mb-3">
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`btn btn-sm ${categoryFilter === f.value ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setCategoryFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === "insights" ? (
        loading ? (
          <div className="campaigns-loading">
            {[1, 2, 3].map(i => <div key={i} className="campaign-row-skeleton" />)}
          </div>
        ) : insights.filter((i) => categoryFilter === "all" || i.category === categoryFilter).length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">💡</span>
            <p>No new insights found. Check back once your active campaigns accumulate data.</p>
          </div>
        ) : (
          <Reveal>
            <div className="insights-feed flex-col gap-4">
              {insights.filter((i) => categoryFilter === "all" || i.category === categoryFilter).map((ins) => (
                <div key={ins.id} className="card insight-card">
                  <div className="insight-card-header flex justify-between items-start gap-4">
                    <div className="flex gap-3 items-center">
                      <span
                        className="insight-severity-dot"
                        style={{ background: SEVERITY_COLORS[ins.severity] }}
                        title={`${ins.severity} priority`}
                      />
                      <h3 className="insight-title">{ins.title}</h3>
                    </div>
                    <div className="flex gap-2 items-center">
                      <span className="pill text-uppercase font-size-11" style={{ background: "rgba(16, 185, 129, 0.08)", color: "#10b981", fontWeight: 700 }}>{ins.category}</span>
                      <span className="pill text-uppercase font-size-11" style={{ background: "rgba(112, 51, 245, 0.08)", color: "#7033f5", fontWeight: 700 }}>{ins.type}</span>
                    </div>
                  </div>

                  <p className="insight-description mt-3">{ins.description}</p>

                  {ins.metric && (
                    <div className="insight-metrics-row mt-3">
                      <div className="insight-metric-tag">
                        <span>Target Metric:</span>
                        <strong>{ins.metric}</strong>
                      </div>
                      {ins.change !== undefined && (
                        <div className="insight-metric-tag">
                          <span>Projected Shift:</span>
                          <strong style={{ color: ins.change > 0 ? "var(--accent-2)" : "var(--danger)" }}>
                            {ins.change > 0 ? `+${ins.change}%` : `${ins.change}%`}
                          </strong>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="insight-actions-row justify-between mt-4">
                    <button className="btn btn-sm btn-secondary" onClick={() => handleDismiss(ins.id)}>
                      Dismiss
                    </button>
                    {ins.actionLabel && (
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleApplyAction(ins)}
                        disabled={runningAction !== null}
                      >
                        {runningAction === ins.id ? "Applying Optimization..." : `⚡ ${ins.actionLabel}`}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        )
      ) : (
        /* Knowledge Base Tab */
        <div>
          <div className="audit-logs-controls mb-4">
            <span className="font-size-14 text-secondary">Search Winning Blueprints &amp; Creative Angles</span>
            <input
              type="text"
              className="audit-search-input"
              placeholder="Search playbook by tags, platforms..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <Reveal>
            <div className="insights-feed flex-col gap-4">
              {filteredKb.length === 0 ? (
                <p className="muted-text">No optimization playbook items matched your query.</p>
              ) : (
                filteredKb.map(item => (
                  <div key={item.id} className="card insight-card" style={{ borderColor: "#e5e7eb" }}>
                    <div className="insight-card-header flex justify-between items-start">
                      <div>
                        <span className="pill text-uppercase font-size-11" style={{ background: "rgba(16, 185, 129, 0.08)", color: "#10b981", fontWeight: 700 }}>
                          {item.platform}
                        </span>
                        <h3 className="insight-title mt-2">{item.name}</h3>
                      </div>
                      <div className="flex gap-4 font-size-13" style={{ textAlign: "right" }}>
                        <div>
                          <span className="block muted-text font-size-11">Avg ROAS</span>
                          <strong className="text-secondary font-size-15" style={{ color: "var(--accent-2)" }}>{item.roas}</strong>
                        </div>
                        <div>
                          <span className="block muted-text font-size-11">Avg CTR</span>
                          <strong className="text-secondary font-size-15" style={{ color: "var(--accent)" }}>{item.ctr}</strong>
                        </div>
                      </div>
                    </div>

                    {/* Metadata specs */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", border: "1px solid #f3f4f6", padding: "10px", borderRadius: "8px", background: "#f9fafb" }} className="mt-3 font-size-12">
                      <div>
                        <span className="muted-text block">Industry</span>
                        <strong style={{ color: "#374151" }}>{item.industry}</strong>
                      </div>
                      <div>
                        <span className="muted-text block">Objective</span>
                        <strong style={{ color: "#374151" }}>{item.objective}</strong>
                      </div>
                      <div>
                        <span className="muted-text block">Budget Range</span>
                        <strong style={{ color: "#374151" }}>{item.budget}</strong>
                      </div>
                      <div>
                        <span className="muted-text block">Creative Type</span>
                        <strong style={{ color: "#374151" }}>{item.creativeType}</strong>
                      </div>
                    </div>

                    {/* AI Rationale */}
                    <div className="mt-3 font-size-13">
                      <strong className="block mb-1" style={{ color: "#7033f5" }}>📈 AI Rationale &amp; Key Learning</strong>
                      <p style={{ margin: 0, color: "#4b5563" }}>{item.rationale}</p>
                    </div>

                    {/* Tags row */}
                    <div className="flex flex-wrap gap-2 mt-4">
                      {item.tags.map(t => (
                        <span key={t} className="pill font-size-11" style={{ background: "#f3f4f6", color: "#4b5563" }}>#{t}</span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Reveal>
        </div>
      )}

      {brandModalOpen && (
        <div className="brand-modal-overlay" onClick={closeBrandModal}>
          <div className="brand-modal" onClick={(e) => e.stopPropagation()}>
            <div className="brand-modal-header">
              <div className="brand-modal-header-left">
                <span className="brand-modal-icon"><SparkleIcon /></span>
                <h2>Create Brand Profile</h2>
              </div>
              <button type="button" className="brand-modal-close" onClick={closeBrandModal} aria-label="Close">
                <XIcon />
              </button>
            </div>

            <div className="brand-modal-body">
              {brandStep === "form" && (
                <form onSubmit={handleStartAnalysis}>
                  <div className="brand-modal-banner">
                    <ClockIcon />
                    <span>2-3 min for AI to complete brand profile analysis</span>
                  </div>

                  {brandError && <p className="error mt-3">{brandError}</p>}

                  <label className="brand-modal-field-label mt-4">
                    <GlobeIcon /> Brand Url
                  </label>
                  <input
                    type="url"
                    className="brand-modal-input"
                    value={brandUrl}
                    onChange={(e) => setBrandUrl(e.target.value)}
                    placeholder="e.g. https://www.yourbrand.com"
                    required
                  />

                  <button type="submit" className="brand-modal-submit">
                    <SparkleIcon /> Start Analysis
                  </button>
                </form>
              )}

              {(brandStep === "analyzing-product" || brandStep === "analyzing-audience") && (
                <div className="brand-modal-loading">
                  <div className="onboarding-spinner" />
                  <p>
                    {brandStep === "analyzing-product"
                      ? "Reading your website and identifying what you offer…"
                      : "Working out who's likely to buy this…"}
                  </p>
                </div>
              )}

              {brandStep === "result" && brandProduct && brandAudience && (
                <div className="brand-modal-result">
                  <span className="pill">{brandProduct.category}</span>
                  <h3 className="mt-2">{brandProduct.productName}</h3>
                  <p className="muted-text">{brandProduct.summary}</p>
                  <p className="onboarding-value-prop">{brandProduct.valueProposition}</p>

                  <h4>Key features spotted</h4>
                  <ul>
                    {brandProduct.keyFeatures.map((f) => <li key={f}>{f}</li>)}
                  </ul>

                  <h4>Primary audience</h4>
                  <p>{brandAudience.primaryAudience}</p>

                  <h4>Pain points</h4>
                  <ul>
                    {brandAudience.painPoints.map((p) => <li key={p}>{p}</li>)}
                  </ul>

                  <button type="button" className="brand-modal-submit" onClick={closeBrandModal}>
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
