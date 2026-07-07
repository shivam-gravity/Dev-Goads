import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.js";
import type {
  AudienceAnalysis,
  AudiencePersona,
  Citation,
  CompetitorBudgetAnalysis,
  DeepResearchBlock,
  MarketLocationAnalysis,
  ProductAnalysis,
  ResearchSession,
} from "../api/client.js";

const AVATAR_EMOJIS = ["🤖", "👨", "👩", "👩‍🦰", "🧑", "👩🏾"];

// Mirrors marketResearch.ts's RESEARCH_STEPS on the backend — this is the fixed order the
// worker runs blocks in, used to render a checklist (done/active/pending) even for steps
// that haven't completed yet (and so have no block/data to show).
const STEP_ORDER: { key: string; label: string }[] = [
  { key: "productPositioning", label: "Analyzing product positioning, features, pricing and use cases" },
  { key: "audienceProfile", label: "Analyzing target audience profile" },
  { key: "competitorBudget", label: "Analyzing competitors and calculating daily budget recommendations" },
  { key: "marketLocation", label: "Analyzing market trends and competition, recommending target locations" },
  { key: "audiencePersonas", label: "Mining Meta Ads audience interest keywords and building audience personas" },
];

const POLL_INTERVAL_MS = 1500;

function siteLabel(rawUrl: string): string {
  try {
    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "");
  } catch {
    return rawUrl;
  }
}

function formatCents(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function DataSource({ source }: { source?: string }) {
  if (!source) return null;
  return <p className="crawler-block-source">💡 Data Source: {source}</p>;
}

function CitationLinks({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <p className="crawler-block-citations">
      Sources:{" "}
      {citations.map((c, i) => (
        <span key={c.url}>
          <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a>
          {i < citations.length - 1 ? ", " : ""}
        </span>
      ))}
    </p>
  );
}

function ProductBlockView({ data, citations }: { data: ProductAnalysis; citations: Citation[] }) {
  return (
    <div className="crawler-block-content">
      <p><strong>Brand Positioning:</strong> {data.summary} <strong>Value proposition:</strong> {data.valueProposition}</p>
      <p><strong>Business Type:</strong> {data.businessType ?? data.category}</p>
      <p><strong>Product Pricing:</strong> {data.pricingModel} ({data.pricingRange})</p>
      <p><strong>Key Features:</strong></p>
      <ul className="crawler-block-list">
        {data.keyFeatures.map((f) => <li key={f}>{f}</li>)}
      </ul>
      <DataSource source={data.dataSource} />
      <CitationLinks citations={citations} />
    </div>
  );
}

function AudienceBlockView({ data, citations }: { data: AudienceAnalysis; citations: Citation[] }) {
  return (
    <div className="crawler-block-content">
      <p><strong>Primary Audience:</strong> {data.primaryAudience}</p>
      {data.demographics && (
        <p>
          <strong>Demographics:</strong> {data.demographics.ageDistribution} · {data.demographics.genderRatio} · {data.demographics.occupation}
        </p>
      )}
      {data.consumerCharacteristics && <p><strong>Consumer Characteristics:</strong> {data.consumerCharacteristics}</p>}
      {data.interestTags && data.interestTags.length > 0 && <p><strong>Interest Tags:</strong> {data.interestTags.join(", ")}</p>}
      {data.recommendedObjective && (
        <p><strong>Recommended Objective:</strong> {data.recommendedObjective} <strong>Performance Goal:</strong> {data.recommendedPerformanceGoal}</p>
      )}
      <DataSource source={data.dataSource} />
      <CitationLinks citations={citations} />
    </div>
  );
}

function CompetitorBlockView({ data, citations }: { data: CompetitorBudgetAnalysis; citations: Citation[] }) {
  return (
    <div className="crawler-block-content">
      <p><strong>Main Competitors:</strong> {data.competitors.join(", ")}</p>
      <p><strong>Competition Intensity:</strong> {data.competitionIntensity}</p>
      <p><strong>Differentiators:</strong></p>
      <ul className="crawler-block-list">
        {data.differentiators.map((d) => <li key={d}>{d}</li>)}
      </ul>
      <p><strong>Budget Reasoning:</strong></p>
      <ul className="crawler-block-list">
        {data.budgetReasoning.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <p className="crawler-block-highlight">💰 Recommended Daily Budget: {formatCents(data.recommendedDailyBudgetCents)}</p>
      <DataSource source={data.dataSource} />
      <CitationLinks citations={citations} />
    </div>
  );
}

function MarketBlockView({ data, citations }: { data: MarketLocationAnalysis; citations: Citation[] }) {
  return (
    <div className="crawler-block-content">
      <p><strong>Recommended Target Region:</strong> {data.recommendedRegion}</p>
      <p><strong>Alternative Regions:</strong> {data.alternativeRegions.join(", ")}</p>
      <p><strong>Market Trends:</strong> {data.marketTrends}</p>
      <p><strong>Competition Level:</strong> {data.competitionLevel}</p>
      <p><strong>Recommended Platform:</strong> {data.recommendedPlatform}</p>
      <p><strong>Placement Rationale:</strong> {data.placementRationale}</p>
      <DataSource source={data.dataSource} />
      <CitationLinks citations={citations} />
    </div>
  );
}

const PERSONA_AVATAR_COLORS = [
  { bg: "#e8f0fe", color: "#4285f4" },
  { bg: "#e6f4ea", color: "#34a853" },
  { bg: "#fef7e0", color: "#f9ab00" },
  { bg: "#fce8e6", color: "#ea4335" },
  { bg: "#f3e8fd", color: "#7033f5" },
  { bg: "#e0f2f1", color: "#00897b" },
];

function PersonaCarousel({ personas }: { personas: AudiencePersona[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollByCard(direction: 1 | -1) {
    const el = scrollRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>(".persona-card");
    const step = (card?.offsetWidth ?? 260) + 16;
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  }

  return (
    <div className="crawler-block-content">
      <p>Built {personas.length} audience personas from the interest keywords mined above:</p>
      <div className="persona-carousel">
        <button type="button" className="persona-carousel-nav" onClick={() => scrollByCard(-1)} aria-label="Previous personas">‹</button>
        <div className="persona-carousel-track" ref={scrollRef}>
          {personas.map((p, i) => {
            const avatar = PERSONA_AVATAR_COLORS[i % PERSONA_AVATAR_COLORS.length];
            return (
              <div key={p.name} className="persona-card">
                <div className="persona-card-avatar" style={{ background: avatar.bg, color: avatar.color }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div className="persona-card-name">{p.name}</div>
                <div className="persona-card-meta">
                  <span><strong>Age:</strong> {p.ageRange}</span>
                  <span><strong>Gender:</strong> {p.genderSplit}</span>
                </div>
                <p className="persona-card-details">{p.details}</p>
                <div className="persona-card-interests">
                  <strong>Interests:</strong> {p.interests.join(", ")}
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" className="persona-carousel-nav" onClick={() => scrollByCard(1)} aria-label="Next personas">›</button>
      </div>
    </div>
  );
}

function dateStamp(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}${mm}${d.getFullYear()}`;
}

interface BrandInfoCardProps {
  url: string;
  product: ProductAnalysis;
  candidateLogos: string[];
  businessId: string;
  onConfirmed: (businessId: string) => void;
}

/**
 * Non-blocking checkpoint: the research session keeps running/is already done regardless
 * of whether the user confirms this. "Confirm" updates the current business if one
 * already exists (the common case — businessId defaults to "demo-business" from
 * AuthContext), falling back to creating one for a truly fresh session with no business yet.
 */
function BrandInfoCard({ url, product, candidateLogos, businessId, onConfirmed }: BrandInfoCardProps) {
  const [brandName, setBrandName] = useState(`${product.productName.replace(/\s+/g, "_")}_${dateStamp()}`);
  const [brandWebsite, setBrandWebsite] = useState(url);
  const [logoUrls, setLogoUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  function toggleLogo(src: string) {
    setSaved(false);
    setLogoUrls((prev) => (prev.includes(src) ? prev.filter((l) => l !== src) : prev.length >= 5 ? prev : [...prev, src]));
  }

  async function handleConfirm() {
    setSaving(true);
    setConfirmError(null);
    try {
      const patch = { brandName, website: brandWebsite, logoUrls };
      try {
        await api.updateBusiness(businessId, patch);
        onConfirmed(businessId);
      } catch {
        // No business exists yet under this id (fresh session, never onboarded) — create one instead.
        const created = await api.createBusiness({
          name: brandName,
          website: brandWebsite,
          industry: product.category,
          monthlyBudgetCents: 150000,
          goals: ["Leads"],
          brandName,
          logoUrls,
        });
        onConfirmed(created.id);
      }
      setSaved(true);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : "Couldn't save brand info — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="brand-info-card">
      <div className="brand-info-card-header">
        <span aria-hidden="true">📋</span>
        <span className="brand-info-card-title">Your Brand Info</span>
        <button className="btn btn-primary brand-info-confirm-btn" onClick={handleConfirm} disabled={saving}>
          {saving ? "Saving…" : saved ? "Confirmed ✓" : "Confirm"}
        </button>
      </div>

      {confirmError && <p className="error">{confirmError}</p>}

      <label className="adsgo-modal-field">
        <span>* Your Brand Name</span>
        <input type="text" value={brandName} onChange={(e) => { setBrandName(e.target.value); setSaved(false); }} />
      </label>
      <label className="adsgo-modal-field">
        <span>* Your Brand Website</span>
        <input type="text" value={brandWebsite} onChange={(e) => { setBrandWebsite(e.target.value); setSaved(false); }} />
      </label>
      <div className="adsgo-modal-field">
        <span>Brand Logos <span className="field-hint" style={{ display: "inline" }}>Added: {logoUrls.length}/5</span></span>
        {candidateLogos.length > 0 ? (
          <div className="brand-logo-picker">
            {candidateLogos.slice(0, 12).map((src) => (
              <button
                key={src}
                type="button"
                className={`brand-logo-option ${logoUrls.includes(src) ? "selected" : ""}`}
                onClick={() => toggleLogo(src)}
              >
                <img src={src} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        ) : (
          <p className="muted-text">No images found on the page to pick a logo from.</p>
        )}
      </div>
    </div>
  );
}

const BUSINESS_GOALS = ["Sales", "Leads", "Traffic", "Awareness"];
const PROMOTION_TYPES = ["Long-term", "Short-term", "Test"];
const PLATFORM_OPTIONS: { value: "meta" | "google" | "tiktok"; label: string }[] = [
  { value: "meta", label: "Meta" },
  { value: "google", label: "Google" },
  { value: "tiktok", label: "TikTok" },
];

interface PromotionObjectiveCardProps {
  session: ResearchSession;
  businessId: string;
  wsId: string;
  setBusinessId: (id: string) => void;
}

/**
 * The final step: turns the completed research into an actual (paused) Campaign. Skips
 * the separate /wizard page entirely — matching the one-continuous-page flow this whole
 * feature is modeled on — by calling createStrategyFromResearch (which reuses the
 * already-gathered research instead of a redundant fresh strategy-generation call),
 * then the existing createCampaign/launchCampaign pipeline unchanged.
 */
function PromotionObjectiveCard({ session, businessId, wsId, setBusinessId }: PromotionObjectiveCardProps) {
  const navigate = useNavigate();
  const result = session.result!;

  const [businessType, setBusinessType] = useState(result.product.businessType ?? result.product.category);
  const [businessGoal, setBusinessGoal] = useState(result.audience.recommendedObjective ?? "Sales");
  const [performanceGoal, setPerformanceGoal] = useState(result.audience.recommendedPerformanceGoal ?? "In-web actions");
  const [platform, setPlatform] = useState<"meta" | "google" | "tiktok">(result.marketLocation.recommendedPlatform);
  const [locations, setLocations] = useState<string[]>([result.marketLocation.recommendedRegion]);
  const [dailyBudget, setDailyBudget] = useState(Math.max(1, Math.round(result.competitorBudget.recommendedDailyBudgetCents / 100)));
  const [promotionType, setPromotionType] = useState("Long-term");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const addableRegions = result.marketLocation.alternativeRegions.filter((r) => !locations.includes(r));

  function removeLocation(loc: string) {
    setLocations((prev) => (prev.length > 1 ? prev.filter((l) => l !== loc) : prev));
  }

  async function resolveBusinessId(): Promise<string> {
    try {
      await api.getBusiness(businessId);
      return businessId;
    } catch {
      const created = await api.createBusiness({
        name: result.product.productName,
        website: session.url,
        industry: businessType,
        monthlyBudgetCents: dailyBudget * 100 * 30,
        goals: [businessGoal],
      });
      setBusinessId(created.id);
      return created.id;
    }
  }

  async function handleGenerateCampaign() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const resolvedBusinessId = await resolveBusinessId();
      const strategy = await api.createStrategyFromResearch(resolvedBusinessId, session.id);
      const campaign = await api.createCampaign({
        strategyId: strategy.id,
        name: `${result.product.productName} — ${platform}`,
        dailyBudgetCents: Math.round(dailyBudget * 100),
      });
      await api.launchCampaign(campaign.id, wsId);
      navigate(`/campaigns/${campaign.id}`);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Couldn't generate the campaign — try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="brand-info-card promo-objective-card">
      <div className="brand-info-card-header">
        <span aria-hidden="true">🎯</span>
        <span className="brand-info-card-title">Promotion Objective</span>
      </div>

      {generateError && <p className="error">{generateError}</p>}

      <label className="adsgo-modal-field">
        <span>Business Type</span>
        <input type="text" value={businessType} onChange={(e) => setBusinessType(e.target.value)} />
      </label>

      <div className="promo-objective-row">
        <label className="adsgo-modal-field">
          <span>Your Business Goal</span>
          <select value={businessGoal} onChange={(e) => setBusinessGoal(e.target.value)}>
            {BUSINESS_GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className="adsgo-modal-field">
          <span>Your Ad Performance Goal</span>
          <input type="text" value={performanceGoal} onChange={(e) => setPerformanceGoal(e.target.value)} />
        </label>
      </div>

      <div className="promo-objective-row">
        <label className="adsgo-modal-field">
          <span>Ad Platform</span>
          <select value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)}>
            {PLATFORM_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}{p.value === result.marketLocation.recommendedPlatform ? " (Recommended)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="adsgo-modal-field">
          <span>Target Locations</span>
          <div className="promo-location-chips">
            {locations.map((loc) => (
              <span key={loc} className="promo-location-chip">
                {loc}
                <button type="button" onClick={() => removeLocation(loc)} aria-label={`Remove ${loc}`}>×</button>
              </span>
            ))}
          </div>
          {addableRegions.length > 0 && (
            <select value="" onChange={(e) => e.target.value && setLocations((prev) => [...prev, e.target.value])}>
              <option value="">+ Add region…</option>
              {addableRegions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
        </label>
      </div>

      <div className="promo-objective-row">
        <label className="adsgo-modal-field">
          <span>Suggested Daily Limit</span>
          <div className="promo-budget-input">
            <input type="number" min={1} value={dailyBudget} onChange={(e) => setDailyBudget(Number(e.target.value) || 1)} />
            <span>USD</span>
          </div>
        </label>
        <label className="adsgo-modal-field">
          <span>Promotion Type</span>
          <select value={promotionType} onChange={(e) => setPromotionType(e.target.value)}>
            {PROMOTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <button type="button" className="btn btn-primary promo-generate-btn" onClick={handleGenerateCampaign} disabled={generating}>
        <span aria-hidden="true">✨</span> {generating ? "Generating…" : "Generate Campaign"}
      </button>
    </div>
  );
}

function renderBlock(block: DeepResearchBlock) {
  switch (block.key) {
    case "productPositioning": return <ProductBlockView data={block.data as ProductAnalysis} citations={block.citations} />;
    case "audienceProfile": return <AudienceBlockView data={block.data as AudienceAnalysis} citations={block.citations} />;
    case "competitorBudget": return <CompetitorBlockView data={block.data as CompetitorBudgetAnalysis} citations={block.citations} />;
    case "marketLocation": return <MarketBlockView data={block.data as MarketLocationAnalysis} citations={block.citations} />;
    case "audiencePersonas": return <PersonaCarousel personas={block.data as AudiencePersona[]} />;
    default: return null;
  }
}

export default function NewCampaign() {
  const { businessId, setBusinessId } = useAuth();
  const wsId = localStorage.getItem("adgo_workspace_id") ?? "demo";

  const [pageUrl, setPageUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [session, setSession] = useState<ResearchSession | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!session || session.status === "done" || session.status === "failed") {
      if (pollRef.current) window.clearInterval(pollRef.current);
      return;
    }
    pollRef.current = window.setInterval(async () => {
      try {
        const updated = await api.getResearchSession(session.id);
        setSession(updated);
      } catch {
        // transient poll failure — the next tick will retry, no need to surface this to the user
      }
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status]);

  async function handleStart() {
    const url = pageUrl.trim();
    if (!url) {
      setError("Please enter a page URL to continue.");
      return;
    }
    setError(null);
    setStarting(true);
    try {
      const created = await api.createResearchSession(wsId, url);
      setSession(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start research — check the URL and try again.");
    } finally {
      setStarting(false);
    }
  }

  function handleReset() {
    setSession(null);
    setError(null);
  }

  const isActive = Boolean(session) && session!.status !== "done" && session!.status !== "failed";
  const isDone = session?.status === "done";
  const isFailed = session?.status === "failed";

  return (
    <div className="page-new-campaign">
      <div className="page-header">
        <div>
          <h1>New Campaign</h1>
        </div>
      </div>

      <a className="how-to-use-link" href="#" onClick={(e) => e.preventDefault()}>
        <span className="how-to-use-icon" aria-hidden="true">📖</span>
        How to use?
      </a>

      <div className="new-campaign-hero">
        {!session && (
          <>
            <div className="new-campaign-avatars">
              {AVATAR_EMOJIS.map((emoji, i) => (
                <span key={i} className={`new-campaign-avatar ${i === 0 ? "new-campaign-avatar-bot" : ""}`}>
                  {emoji}
                </span>
              ))}
            </div>
            <h2 className="new-campaign-question">
              <span className="new-campaign-word-light">Which</span>{" "}
              <span className="new-campaign-word-accent">page</span> would you like to promote?
            </h2>
            <p className="new-campaign-subtext">
              No landing page? No problem — you can use a social media page or any page that
              shows your product. Paste your link below to get started.
            </p>
          </>
        )}

        {error && <p className="error">{error}</p>}

        {!session && (
          <div className="new-campaign-url-row">
            <input
              type="text"
              className="new-campaign-url-input"
              placeholder="Please enter page url"
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStart()}
              disabled={starting}
            />
            <button className="btn btn-primary new-campaign-deep-research-btn" onClick={handleStart} disabled={starting}>
              <span aria-hidden="true">✨</span>
              {starting ? "Starting…" : "Deep Research"}
            </button>
          </div>
        )}

        {isFailed && (
          <div className="crawler-trace">
            <p className="error">{session?.error ?? "Research failed — try a different URL."}</p>
            <button className="btn btn-secondary" onClick={handleReset}>Try again</button>
          </div>
        )}

        {isActive && session && (
          <div className="crawler-trace">
            <div className="crawler-trace-header">
              Task received: analyzing <strong>{session.url}</strong> with comprehensive product and audience analysis.
              {session.cacheHit && " (served from a recent cached analysis)"}
            </div>
            <ul className="crawler-trace-steps">
              {STEP_ORDER.map((step) => {
                const completedBlock = session.blocks.find((b) => b.key === step.key);
                const isCurrent = !completedBlock && session.currentStep === step.label;
                return (
                  <li key={step.key} className={completedBlock ? "done" : isCurrent ? "active" : "pending"}>
                    <div className="crawler-trace-step-row">
                      <span className="crawler-trace-step-icon" aria-hidden="true">
                        {completedBlock ? "✓" : isCurrent ? <span className="crawler-trace-spinner" /> : ""}
                      </span>
                      <span>{step.label}</span>
                    </div>
                    {completedBlock && renderBlock(completedBlock)}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {isDone && session?.result && (
          <div className="crawler-result">
            <div className="crawler-result-header">
              <span className="crawler-result-check" aria-hidden="true">✓</span>
              Analysis complete for <strong>{siteLabel(session.url)}</strong>
            </div>

            {session.result.site.screenshot && (
              <div className="crawler-result-screenshot">
                <img src={session.result.site.screenshot} alt={`Screenshot of ${session.result.site.title}`} />
                <span className="crawler-result-caption">Page screenshot</span>
              </div>
            )}

            <BrandInfoCard
              url={session.url}
              product={session.result.product}
              candidateLogos={session.result.site.images}
              businessId={businessId ?? "demo-business"}
              onConfirmed={setBusinessId}
            />

            <div className="crawler-trace-steps crawler-result-blocks">
              {session.blocks.map((block) => (
                <div key={block.key} className="crawler-result-block">
                  <div className="crawler-block-label">{block.label}</div>
                  {renderBlock(block)}
                </div>
              ))}
            </div>

            {session.result.site.images.length > 0 && (
              <div className="crawler-result-images">
                <span className="crawler-result-caption">Images found on the page</span>
                <div className="crawler-result-image-grid">
                  {session.result.site.images.slice(0, 8).map((src) => (
                    <img key={src} src={src} alt="" loading="lazy" />
                  ))}
                </div>
              </div>
            )}

            <PromotionObjectiveCard
              session={session}
              businessId={businessId ?? "demo-business"}
              wsId={wsId}
              setBusinessId={setBusinessId}
            />

            <div className="crawler-result-actions">
              <button className="btn btn-secondary" onClick={handleReset}>
                Try a different page
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
