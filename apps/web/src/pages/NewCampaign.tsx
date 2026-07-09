import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.js";
import { DropdownField, type Option } from "../components/DropdownField.js";
import { TargetIcon, UserIcon, LightningIcon, GlobeIcon, SparkleIcon } from "../components/icons.js";
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
// that haven't completed yet (and so have no block/data to show). Each step gets its own
// icon + accent so the trace/result sections read as distinct topics, not a wall of identical cards.
const STEP_ORDER: { key: string; label: string; icon: typeof TargetIcon; accent: string }[] = [
  { key: "productPositioning", label: "Analyzing product positioning, features, pricing and use cases", icon: TargetIcon, accent: "#7033f5" },
  { key: "audienceProfile", label: "Analyzing target audience profile", icon: UserIcon, accent: "#0e9f6e" },
  { key: "competitorBudget", label: "Analyzing competitors and calculating daily budget recommendations", icon: LightningIcon, accent: "#f59e0b" },
  { key: "marketLocation", label: "Analyzing market trends and competition, recommending target locations", icon: GlobeIcon, accent: "#3b82f6" },
  { key: "audiencePersonas", label: "Mining Meta Ads audience interest keywords and building audience personas", icon: SparkleIcon, accent: "#ec4899" },
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

/** Renders `**phrase**` markdown-bold spans the research tool schemas ask the model to wrap
 * around key numbers/terms — turns a flat sentence into skimmable, marketing-copy-style text. */
function renderBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
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
      <p><strong>Brand Positioning:</strong> {renderBold(data.summary)} <strong>Value proposition:</strong> {renderBold(data.valueProposition)}</p>
      <p><strong>Business Type:</strong> {data.businessType ?? data.category}</p>
      <p><strong>Product Pricing:</strong> {data.pricingModel} ({data.pricingRange})</p>
      <p><strong>Key Features:</strong></p>
      <ul className="crawler-block-list">
        {data.keyFeatures.map((f) => <li key={f}>{f}</li>)}
      </ul>
      {data.useCases && data.useCases.length > 0 && (
        <>
          <p><strong>Use Cases:</strong></p>
          <ul className="crawler-block-list">
            {data.useCases.map((u) => <li key={u.title}><strong>{u.title}</strong> — {u.description}</li>)}
          </ul>
        </>
      )}
      <DataSource source={data.dataSource} />
      <CitationLinks citations={citations} />
    </div>
  );
}

function AudienceBlockView({ data, citations }: { data: AudienceAnalysis; citations: Citation[] }) {
  return (
    <div className="crawler-block-content">
      <p><strong>Primary Audience:</strong> {renderBold(data.primaryAudience)}</p>
      {data.demographics && (
        <p>
          <strong>Demographics:</strong> {data.demographics.ageDistribution} · {data.demographics.genderRatio} · {data.demographics.occupation}
        </p>
      )}
      {data.consumerCharacteristics && <p><strong>Consumer Characteristics:</strong> {renderBold(data.consumerCharacteristics)}</p>}
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
      <p><strong>Competition Intensity:</strong> {renderBold(data.competitionIntensity)}</p>
      <p><strong>Differentiators:</strong></p>
      <ul className="crawler-block-list">
        {data.differentiators.map((d) => <li key={d}>{d}</li>)}
      </ul>
      <p><strong>Budget Calculation Walkthrough:</strong></p>
      <ol className="crawler-budget-steps">
        {data.budgetReasoning.map((r, i) => <li key={i}>{renderBold(r)}</li>)}
      </ol>
      <p className="crawler-block-highlight">🎯 Recommended Daily Budget: <strong>{formatCents(data.recommendedDailyBudgetCents)}</strong></p>
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
      <p><strong>Market Trends:</strong> {renderBold(data.marketTrends)}</p>
      {data.keyDrivers && data.keyDrivers.length > 0 && (
        <>
          <p><strong>Key Drivers:</strong></p>
          <ul className="crawler-block-list">
            {data.keyDrivers.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </>
      )}
      <p><strong>Competition Level:</strong> {data.competitionLevel}</p>
      <p><strong>Recommended Platform:</strong> {data.recommendedPlatform}</p>
      <p><strong>Placement Rationale:</strong> {renderBold(data.placementRationale)}</p>
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
                <div className="persona-card-interest-chips">
                  {p.interests.slice(0, 6).map((tag) => (
                    <span key={tag} className="persona-card-interest-chip" style={{ color: avatar.color, borderColor: avatar.color }}>{tag}</span>
                  ))}
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
  // Candidate logos are hotlinked from the crawled site — some hosts block off-site loading,
  // which would otherwise show as blank/broken boxes. Hide any that fail rather than that.
  const [brokenLogos, setBrokenLogos] = useState<Set<string>>(new Set());

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
        {candidateLogos.filter((src) => !brokenLogos.has(src)).length > 0 ? (
          <div className="brand-logo-picker">
            {candidateLogos.filter((src) => !brokenLogos.has(src)).slice(0, 12).map((src) => (
              <button
                key={src}
                type="button"
                className={`brand-logo-option ${logoUrls.includes(src) ? "selected" : ""}`}
                onClick={() => toggleLogo(src)}
              >
                <img src={src} alt="" loading="lazy" onError={() => setBrokenLogos((prev) => new Set(prev).add(src))} />
              </button>
            ))}
          </div>
        ) : (
          <p className="muted-text">No usable images found on the page to pick a logo from.</p>
        )}
      </div>
    </div>
  );
}

const BUSINESS_TYPE_OPTIONS: Option[] = [
  { value: "Online Shopping", label: "Online Shopping" },
  { value: "Solution & Online Service", label: "Solution & Online Service" },
  { value: "Local Store & Service", label: "Local Store & Service" },
  { value: "App", label: "App" },
];

const BUSINESS_GOAL_OPTIONS: Option[] = [
  { value: "Sales", label: "Sales", description: "Find people who take desired actions within your website." },
  { value: "Leads", label: "Leads", description: "Collect leads for your business." },
  { value: "Awareness & Engagement", label: "Awareness & Engagement", description: "Find people interested in your product or business." },
  { value: "Traffic", label: "Traffic", description: "Increase traffic to your website." },
];

const PROMOTION_TYPE_OPTIONS: Option[] = [
  { value: "Long-term", label: "Long-term", description: "Best for ongoing growth. You can pause anytime." },
  { value: "Short-term", label: "Short-term", description: "Ideal for time-limited campaigns. Set an end date below." },
];

const PLATFORM_OPTIONS: Option[] = [
  { value: "meta", label: "Meta" },
  { value: "google", label: "Google" },
  { value: "tiktok", label: "TikTok" },
];

/** Free-text research output ("SaaS", "DTC skincare brand", ...) doesn't line up with the
 * fixed Business Type enum the builder form uses — map it to the closest bucket instead of
 * losing the AI-inferred value to a blank dropdown. */
function inferBusinessType(freeText: string): string {
  const t = freeText.toLowerCase();
  if (/shop|ecommerce|e-commerce|retail|marketplace/.test(t)) return "Online Shopping";
  if (/\bapp\b|mobile app|ios|android/.test(t)) return "App";
  if (/local|restaurant|clinic|salon|brick.and.mortar/.test(t)) return "Local Store & Service";
  return "Solution & Online Service";
}

interface PromotionObjectiveCardProps {
  session: ResearchSession;
  businessId: string;
  setBusinessId: (id: string) => void;
}

/**
 * The final step: turns the completed research into a draft Campaign pre-populated with 6 ready-
 * to-edit ads (one per AI-generated suggestion — see createCampaignFromSuggestions), then hands
 * off to the CampaignBuilder (/campaigns/:id/builder) for manual review — ad account/Page/pixel
 * selection, per-ad copy/creative, checkbox-include, and the actual Publish action — rather than
 * a separate pre-builder picker screen or auto-launching immediately.
 */
function PromotionObjectiveCard({ session, businessId, setBusinessId }: PromotionObjectiveCardProps) {
  const navigate = useNavigate();
  const result = session.result!;

  const [businessType, setBusinessType] = useState(() => inferBusinessType(result.product.businessType ?? result.product.category));
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
      const campaign = await api.createCampaignFromSuggestions(
        session.id,
        resolvedBusinessId,
        `${result.product.productName} — ${platform}`,
        Math.round(dailyBudget * 100)
      );
      await api.updateCampaign(campaign.id, { locations });
      const wsId = localStorage.getItem("adgo_workspace_id") ?? "demo";
      localStorage.removeItem(`adgo_active_research_session_${wsId}`);
      navigate(`/campaigns/${campaign.id}/builder`);
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

      <DropdownField
        label="Business Type"
        options={BUSINESS_TYPE_OPTIONS}
        selected={[businessType]}
        onChange={([v]) => setBusinessType(v)}
      />

      <div className="promo-objective-row">
        <DropdownField
          label="Your Business Goal"
          options={BUSINESS_GOAL_OPTIONS}
          selected={[businessGoal]}
          onChange={([v]) => setBusinessGoal(v)}
        />
        <label className="adsgo-modal-field">
          <span>Your Ad Performance Goal</span>
          <input type="text" value={performanceGoal} onChange={(e) => setPerformanceGoal(e.target.value)} />
        </label>
      </div>

      <div className="promo-objective-row">
        <DropdownField
          label="Ad Platform"
          options={PLATFORM_OPTIONS.map((p) => (p.value === result.marketLocation.recommendedPlatform ? { ...p, label: `${p.label} (Recommended)` } : p))}
          selected={[platform]}
          onChange={([v]) => setPlatform(v as typeof platform)}
        />
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
        <DropdownField
          label="Promotion Type"
          options={PROMOTION_TYPE_OPTIONS}
          selected={[promotionType]}
          onChange={([v]) => setPromotionType(v)}
        />
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
  const activeSessionKey = `adgo_active_research_session_${wsId}`;

  const [pageUrl, setPageUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [session, setSession] = useState<ResearchSession | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [brokenPageImages, setBrokenPageImages] = useState<Set<string>>(new Set());
  const pollRef = useRef<number | null>(null);

  // Research runs server-side (BullMQ worker) regardless of whether this component is
  // mounted — persisting just the session id (not the whole object, which goes stale) means
  // switching to another page and back resumes exactly where it left off instead of
  // silently losing the in-flight/completed session and forcing a re-paste of the URL.
  useEffect(() => {
    const savedId = localStorage.getItem(activeSessionKey);
    if (!savedId) return;
    api
      .getResearchSession(savedId)
      .then(setSession)
      .catch(() => localStorage.removeItem(activeSessionKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function handleStart(urlOverride?: string, force = false) {
    const url = (urlOverride ?? pageUrl).trim();
    if (!url) {
      setError("Please enter a page URL to continue.");
      return;
    }
    setError(null);
    setStarting(true);
    try {
      const created = await api.createResearchSession(wsId, url, undefined, force);
      setSession(created);
      setBrokenPageImages(new Set());
      localStorage.setItem(activeSessionKey, created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start research — check the URL and try again.");
    } finally {
      setStarting(false);
    }
  }

  // force=true so resubmitting always runs a fresh research pass instead of silently
  // cloning the same cached result — otherwise repeated resubmits within the 1hr session
  // cache window (researchSessionService's SESSION_CACHE_WINDOW_MS) return identical data,
  // which reads as "resubmitting doesn't help" when the underlying data was genuinely thin.
  function handleResubmit() {
    if (session) handleStart(session.url, true);
  }

  function handleReset() {
    setSession(null);
    setError(null);
    setPageUrl("");
    setBrokenPageImages(new Set());
    localStorage.removeItem(activeSessionKey);
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

      <button type="button" className="how-to-use-link" onClick={() => setShowHelp((v) => !v)}>
        <span className="how-to-use-icon" aria-hidden="true">📖</span>
        How to use?
      </button>

      {showHelp && (
        <div className="how-to-use-panel">
          Paste any page URL — your website, a social profile, or a product page — and Deep
          Research will analyze it to build a full campaign strategy (product positioning,
          target audience, competitors, budget, and market recommendations). This usually takes
          a few minutes, so feel free to browse other pages while it runs — we'll pick up right
          where you left off when you come back.
        </div>
      )}

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

        {session && (
          <div className="new-campaign-resubmit-bar">
            <div className="new-campaign-resubmit-row">
              <span className="new-campaign-resubmit-input">{session.url}</span>
              <button type="button" className="new-campaign-resubmit-btn" onClick={handleResubmit} disabled={starting}>
                {starting ? "Resubmitting…" : "Resubmit URL"}
              </button>
            </div>
            <button type="button" className="new-campaign-resubmit-chip" onClick={handleReset}>
              {session.url}
            </button>
          </div>
        )}

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
            <button className="btn btn-primary new-campaign-deep-research-btn" onClick={() => handleStart()} disabled={starting}>
              <span aria-hidden="true">✨</span>
              {starting ? "Starting…" : "Deep Research"}
            </button>
          </div>
        )}

        {!session && (
          <div className="new-campaign-value-row">
            <div className="new-campaign-value-item">
              <span className="new-campaign-value-icon"><TargetIcon /></span>
              <span>AI-powered product &amp; audience research</span>
            </div>
            <div className="new-campaign-value-item">
              <span className="new-campaign-value-icon"><LightningIcon /></span>
              <span>Real, calculated budget recommendations</span>
            </div>
            <div className="new-campaign-value-item">
              <span className="new-campaign-value-icon"><SparkleIcon /></span>
              <span>12 ready-to-edit ads, generated for you</span>
            </div>
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
              <span>
                Task received: analyzing <strong>{session.url}</strong> with comprehensive product and audience analysis.
                {session.cacheHit && " (served from a recent cached analysis)"}
              </span>
              <button type="button" className="btn btn-secondary crawler-trace-reenter-btn" onClick={handleReset}>
                Re-enter URL
              </button>
            </div>
            {!session.cacheHit && (
              <p className="crawler-trace-time-note">
                This usually takes a few minutes — feel free to browse other pages, we'll keep working in the background.
              </p>
            )}
            <ul className="crawler-trace-steps">
              {STEP_ORDER.map((step) => {
                const completedBlock = session.blocks.find((b) => b.key === step.key);
                const isCurrent = !completedBlock && session.currentStep === step.label;
                const StepIcon = step.icon;
                return (
                  <li key={step.key} className={completedBlock ? "done" : isCurrent ? "active" : "pending"}>
                    <div className="crawler-trace-step-row">
                      <span className="crawler-trace-step-badge" style={{ "--step-accent": step.accent } as CSSProperties}>
                        {isCurrent ? <span className="crawler-trace-spinner" /> : <StepIcon />}
                      </span>
                      <span>{step.label}</span>
                      {completedBlock && <span className="crawler-trace-step-done-mark" aria-hidden="true">✓</span>}
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
              {session.blocks.map((block) => {
                const step = STEP_ORDER.find((s) => s.key === block.key);
                const StepIcon = step?.icon;
                return (
                  <div key={block.key} className="crawler-result-block">
                    <div className="crawler-block-label" style={step ? ({ "--step-accent": step.accent } as CSSProperties) : undefined}>
                      {StepIcon && (
                        <span className="crawler-block-label-badge">
                          <StepIcon />
                        </span>
                      )}
                      {block.label}
                    </div>
                    {renderBlock(block)}
                  </div>
                );
              })}
            </div>

            {session.result.site.images.filter((src) => !brokenPageImages.has(src)).length > 0 && (
              <div className="crawler-result-images">
                <span className="crawler-result-caption">Images found on the page</span>
                <div className="crawler-result-image-grid">
                  {session.result.site.images.filter((src) => !brokenPageImages.has(src)).slice(0, 8).map((src) => (
                    <img key={src} src={src} alt="" loading="lazy" onError={() => setBrokenPageImages((prev) => new Set(prev).add(src))} />
                  ))}
                </div>
              </div>
            )}

            <div className="all-set-banner">
              <span className="all-set-banner-icon" aria-hidden="true">✓</span>
              <span>All set! Your best ad strategy is ready. Review your goals below and start your campaign with one click!</span>
            </div>

            <PromotionObjectiveCard
              session={session}
              businessId={businessId ?? "demo-business"}
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
