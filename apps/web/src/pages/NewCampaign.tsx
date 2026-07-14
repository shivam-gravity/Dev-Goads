import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.js";
import { TargetIcon, UserIcon, LightningIcon, GlobeIcon, SparkleIcon } from "../components/icons.js";
import type {
  AudiencePersonaCard,
  CampaignGenerationCitations,
  CampaignGenerationFacts,
  CampaignGenerationJobStatus,
  CampaignGenerationPipelineStatus,
  CampaignStrategyOption,
  CompetitorAdsData,
  DecisionContext,
  RankedRecommendation,
  StrategySimulationResult,
} from "../api/client.js";

const AVATAR_EMOJIS = ["🤖", "👨", "👩", "👩‍🦰", "🧑", "👩🏾"];
const POLL_INTERVAL_MS = 1500;

/**
 * Mirrors the pipeline's real phases (modules/orchestrator/campaignGenerationPipeline.ts) —
 * research -> decision + agents (concurrent) -> campaign build. Unlike the old sequential
 * ResearchSession flow, there's no manual "confirm brand info" / "set promotion objective"
 * checkpoint in between: research, ranking, strategy simulation, and real ad generation all
 * happen in one autonomous run, and the ONLY thing left for the user to do afterward is
 * review the result in the Campaign Builder before actually launching it.
 */
const PHASE_ORDER: { key: CampaignGenerationPipelineStatus; label: string; icon: typeof TargetIcon }[] = [
  { key: "researching", label: "Researching the business across 9 parallel research providers", icon: GlobeIcon },
  { key: "aggregating", label: "Fusing research into one confidence-scored context", icon: TargetIcon },
  { key: "running_agents", label: "Ranking recommendations and simulating campaign strategies", icon: LightningIcon },
  { key: "building_campaign", label: "Building your campaign and generating real ad creative", icon: SparkleIcon },
];

function phaseIndex(status: CampaignGenerationPipelineStatus): number {
  if (status === "completed") return PHASE_ORDER.length;
  if (status === "pending" || status === "failed") return -1;
  return PHASE_ORDER.findIndex((p) => p.key === status);
}

// Truthful, generic descriptions of what each phase is actually doing — rotates every few
// seconds so the loading state doesn't sit static for minutes at a time on slower runs.
const PHASE_SUBLINES: Record<CampaignGenerationPipelineStatus, string[]> = {
  pending: [],
  researching: [
    "Crawling the site, screenshotting pages, and reading competitor + market signals…",
    "Cross-checking sources for conflicting claims…",
    "Gathering audience, keyword, and news data in parallel…",
  ],
  aggregating: [
    "Merging 9 providers into one confidence-scored context…",
    "Resolving conflicts between sources…",
  ],
  running_agents: [
    "Scoring and ranking candidate recommendations…",
    "Simulating 3 campaign strategies head-to-head…",
    "Picking the strategy with the best expected ROI…",
  ],
  building_campaign: [
    "Generating real ad copy and creative…",
    "Assembling the campaign for review…",
  ],
  completed: [],
  failed: [],
};

function phaseSubline(key: CampaignGenerationPipelineStatus): string {
  const lines = PHASE_SUBLINES[key];
  if (!lines || lines.length === 0) return "";
  return lines[Math.floor(Date.now() / 2500) % lines.length];
}

// Human-readable labels for the real step names GET /campaigns/generate/:id/progress
// returns (research provider names, then agent names, then phase-boundary markers) — falls
// back to the raw name for anything added on the backend before this map is updated, so a
// new provider/agent shows up as slightly-less-polished text instead of nothing.
const STEP_LABELS: Record<string, string> = {
  website: "Reading your website",
  company: "Researching your company",
  market: "Analyzing the market",
  technology: "Detecting your tech stack",
  competitor: "Searching competitors",
  seo: "Finding keywords",
  audience: "Building your audience profile",
  news: "Checking recent news",
  "social-media": "Checking social presence",
  reviews: "Reading customer reviews",
  funding: "Checking funding signals",
  "hiring-signals": "Checking hiring activity",
  "content-marketing": "Analyzing content marketing",
  "backlink-authority": "Checking domain authority",
  "app-store": "Checking app store presence",
  "video-presence": "Checking video presence",
  "local-presence": "Checking local presence",
  partnerships: "Checking partnerships",
  "legal-regulatory": "Checking legal & regulatory risk",
  search: "Searching the web",
  product: "Crawling product & pricing pages",
  navigation: "Mapping your site structure",
  "search-ranking": "Checking real search rankings",
  "ad-library": "Checking competitor ad libraries",
  autocomplete: "Checking search autocomplete",
  "serp-features": "Checking related searches",
  reddit: "Checking community discussion",
  aggregating: "Fusing research into one context",
  "product-agent": "Defining your product positioning",
  "audience-agent": "Refining your audience",
  "competitor-agent": "Mapping competitive differentiation",
  "market-agent": "Scoring market opportunity",
  "keyword-agent": "Building keyword strategy",
  "creative-agent": "Writing ad creative",
  "budget-agent": "Calculating your budget",
  "persona-agent": "Building personas",
  "campaign-agent": "Synthesizing your campaign strategy",
  "landing-page-agent": "Reviewing your landing page",
  "pricing-offer-agent": "Analyzing pricing",
  "localization-agent": "Planning localization",
  "seo-content-agent": "Planning SEO content",
  "seasonality-timing-agent": "Timing your launch",
  "channel-placement-agent": "Choosing ad placements",
  "funnel-retargeting-agent": "Planning your funnel",
  "objection-handling-agent": "Preparing objection handling",
  "forecasting-kpi-agent": "Forecasting performance",
  "critic-agent": "Reviewing for quality",
  "compliance-agent": "Reviewing for compliance",
  "campaign-built": "Assembling your campaign",
};

function stepLabel(step: string): string {
  return STEP_LABELS[step] ?? step;
}

function formatRelativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days <= 0) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    return hours <= 0 ? "just now" : `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "Researched N days ago" — surfaces `researchedAt`/`researchIsStale`, computed server-side
 * (router.ts, reusing research/knowledge/freshness.ts) against a 14-day horizon. Past that
 * horizon, offers a one-click re-run rather than leaving the user to guess whether a 3-week-old
 * campaign still reflects the business's current market/competitor/pricing landscape. */
function FreshnessBadge({ job, onRefresh, refreshing }: { job: CampaignGenerationJobStatus; onRefresh: () => void; refreshing: boolean }) {
  if (!job.researchedAt) return null;
  return (
    <div className={`freshness-badge${job.researchIsStale ? " stale" : ""}`}>
      <span>Researched {formatRelativeAge(job.researchedAt)}</span>
      {job.researchIsStale && (
        <button type="button" className="freshness-refresh-btn" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "May be outdated — refresh"}
        </button>
      )}
    </div>
  );
}

function formatCents(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function AssistantTag({ time }: { time: string }) {
  const stamp = formatTimestamp(time);
  return (
    <div className="decision-assistant-tag">
      <span className="copilot-avatar">🤖</span>
      <span className="decision-assistant-name">Polluxa AI</span>
      {stamp && <span className="decision-assistant-time">{stamp}</span>}
    </div>
  );
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function scoreTier(score: number): "score-high" | "score-mid" | "score-low" {
  if (score >= 75) return "score-high";
  if (score >= 50) return "score-mid";
  return "score-low";
}

function RecommendationRow({ rec, rank }: { rec: RankedRecommendation; rank: number }) {
  const evidence = rec.evidence ?? [];
  const score = Math.round(rec.finalScore);
  return (
    <div className="rec-item">
      <div className="rec-item-head">
        <span className="rec-item-rank">#{rank}</span>
        <span className="category-tag">{rec.category}</span>
        <span className="rec-item-title">{rec.title}</span>
        <span className={`score-badge ${scoreTier(score)}`}>{score}/100</span>
      </div>
      <p className="rec-item-reason">{rec.reason}</p>
      <p className="rec-item-outcome"><strong>Expected outcome:</strong> {rec.expectedOutcome}</p>
      {evidence.length > 0 && (
        <details>
          <summary>Why ({evidence.length} source{evidence.length === 1 ? "" : "s"})</summary>
          <ul className="rec-item-evidence">
            {evidence.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Direction matters for the color read: higher reach/ROI/budget-efficiency is good (green),
 * higher competition/risk is bad (amber) — a plain "bigger bar = better" would mislead on
 * the latter two. */
const METRIC_ROWS: { key: keyof StrategySimulationResult; label: string; goodHigh: boolean }[] = [
  { key: "reach", label: "Reach", goodHigh: true },
  { key: "competition", label: "Competition", goodHigh: false },
  { key: "expectedRoi", label: "Exp. ROI", goodHigh: true },
  { key: "risk", label: "Risk", goodHigh: false },
  { key: "budgetEfficiency", label: "Budget eff.", goodHigh: true },
];

function StrategyCard({ strategy, simulation, isWinner }: { strategy: CampaignStrategyOption; simulation?: StrategySimulationResult; isWinner: boolean }) {
  const platforms = strategy.platforms ?? [];
  const strengths = strategy.strengths ?? [];
  const weaknesses = strategy.weaknesses ?? [];
  return (
    <div className={`strategy-card-v2 ${isWinner ? "winner" : ""}`}>
      <div className="strategy-card-v2-head">
        <span className="strategy-card-v2-label">{strategy.label}</span>
        {isWinner && <span className="decision-winner-badge">★ Winner</span>}
      </div>

      {simulation && (
        <div className="metric-bars">
          {METRIC_ROWS.map(({ key, label, goodHigh }) => {
            const value = Math.max(0, Math.min(100, Math.round(simulation[key] as number)));
            const isGood = goodHigh ? value >= 60 : value <= 40;
            return (
              <div className="metric-bar-row" key={key}>
                <span>{label}</span>
                <span className="metric-bar-track">
                  <span
                    className="metric-bar-fill"
                    style={{ width: `${value}%`, background: isGood ? "var(--accent-2)" : value > 66 && !goodHigh ? "var(--danger)" : undefined }}
                  />
                </span>
                <span className="metric-bar-value">{value}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="strategy-card-v2-field"><strong>Target Audience</strong>{strategy.targetAudience}</div>
      <div className="strategy-card-v2-field"><strong>Platforms &amp; Objective</strong>{platforms.join(", ") || "—"} · {strategy.objective}</div>
      <div className="strategy-card-v2-field"><strong>Budget</strong>{formatCents(strategy.budgetDailyCents)}/day · KPI: {strategy.expectedKpi}</div>
      <div className="strategy-card-v2-field"><strong>Creative Direction</strong>{strategy.creativeDirection}</div>
      <div className="strategy-card-v2-field"><strong>Messaging</strong>{strategy.messaging}</div>
      <div className="strategy-card-v2-field"><strong>Offer</strong>{strategy.offer}</div>
      {strengths.length > 0 && <div className="strategy-card-v2-field"><strong>Strengths</strong>{strengths.join("; ")}</div>}
      {weaknesses.length > 0 && <div className="strategy-card-v2-field"><strong>Weaknesses</strong>{weaknesses.join("; ")}</div>}
    </div>
  );
}

const PERSONA_AVATAR_COLORS = [
  { bg: "#e8f0fe", color: "#4285f4" },
  { bg: "#e6f4ea", color: "#34a853" },
  { bg: "#fef7e0", color: "#f9ab00" },
  { bg: "#fce8e6", color: "#ea4335" },
  { bg: "#f3e8fd", color: "#7033f5" },
];

function PersonaCarousel({ personas }: { personas: AudiencePersonaCard[] }) {
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
      <p>Who's actually going to see this — {personas.length} audience persona{personas.length === 1 ? "" : "s"} built from the research:</p>
      <div className="persona-carousel">
        <button type="button" className="persona-carousel-nav" onClick={() => scrollByCard(-1)} aria-label="Previous personas">‹</button>
        <div className="persona-carousel-track" ref={scrollRef}>
          {personas.map((p, i) => {
            const avatar = PERSONA_AVATAR_COLORS[i % PERSONA_AVATAR_COLORS.length];
            return (
              <div key={p.name} className="persona-card">
                <div className="persona-card-avatar" style={{ background: avatar.bg, color: avatar.color }}>
                  <UserIcon />
                </div>
                <div className="persona-card-name">{p.name}</div>
                {(p.ageRange || p.genderSplit) && (
                  <div className="persona-card-meta">
                    {p.ageRange && <span><strong>Age:</strong> {p.ageRange}</span>}
                    {p.genderSplit && <span><strong>Gender:</strong> {p.genderSplit}</span>}
                  </div>
                )}
                <p className="persona-card-details">{p.description}</p>
                {(p.interests ?? []).length > 0 && (
                  <div className="persona-card-interest-chips">
                    {(p.interests ?? []).map((tag) => (
                      <span key={tag} className="persona-card-interest-chip" style={{ color: avatar.color, borderColor: avatar.color }}>{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" className="persona-carousel-nav" onClick={() => scrollByCard(1)} aria-label="Next personas">›</button>
      </div>
    </div>
  );
}

/**
 * DecisionContext is persisted as a plain JSON blob (CampaignGenerationJob.decisionContext) —
 * a job completed by an older version of decision-engine.ts (e.g. before audiencePersonas
 * existed) has no way to retroactively gain new fields, so every array/record field here is
 * defaulted rather than trusted, even though the TS type says they're required. Real bug this
 * fixes: an old completed job's missing `audiencePersonas` crashed the whole page with
 * "Cannot read properties of undefined (reading 'length')".
 */
function normalizeDecision(decision: DecisionContext) {
  return {
    ...decision,
    recommendations: decision.recommendations ?? [],
    strategies: decision.strategies ?? [],
    simulations: decision.simulations ?? [],
    topOpportunities: decision.topOpportunities ?? [],
    topRisks: decision.topRisks ?? [],
    evidence: decision.evidence ?? [],
    audiencePersonas: decision.audiencePersonas ?? [],
    recommendedChannels: decision.recommendedChannels ?? [],
    recommendedBudgetAllocation: decision.recommendedBudgetAllocation ?? {},
    pricingTiers: decision.pricingTiers ?? [],
    notableCustomers: decision.notableCustomers ?? [],
    quantifiedProofPoints: decision.quantifiedProofPoints ?? [],
    regionalMarketDepth: decision.regionalMarketDepth ?? null,
    recommendedDailyBudgetCents: decision.recommendedDailyBudgetCents ?? 0,
    budgetReasoning: decision.budgetReasoning ?? [],
  };
}

const BUDGET_COLORS = ["var(--accent)", "var(--accent-2)", "#f9ab00", "#ea4335", "var(--accent-light)"];

function DecisionContextView({ decision: raw, url }: { decision: DecisionContext; url: string }) {
  const decision = normalizeDecision(raw);
  const simByStrategy = new Map(decision.simulations.map((s) => [s.strategyId, s]));
  const sortedStrategies = [...decision.strategies].sort(
    (a, b) => (simByStrategy.get(a.id)?.rank ?? 99) - (simByStrategy.get(b.id)?.rank ?? 99)
  );
  const topRecommendations = decision.recommendations.slice(0, 5);
  const budgetEntries = Object.entries(decision.recommendedBudgetAllocation);
  const winnerId = sortedStrategies[0]?.id;
  const confidencePct = Math.round(decision.confidence * 100);
  const region = decision.regionalMarketDepth;

  const sectionsShown = [
    true, // hero
    decision.recommendedDailyBudgetCents > 0,
    decision.audiencePersonas.length > 0,
    decision.topOpportunities.length > 0 || decision.topRisks.length > 0,
    true, // recommended direction
    decision.pricingTiers.length > 0,
    topRecommendations.length > 0,
    sortedStrategies.length > 0,
  ].filter(Boolean).length;

  return (
    <div className="decision-results-shell">
    <div className="decision-results">
      <AssistantTag time={decision.generatedAt} />

      <div className="decision-hero">
        {decision.websiteScreenshot && (
          <div className="decision-hero-shot">
            <img src={decision.websiteScreenshot} alt={`Screenshot of ${url}`} />
          </div>
        )}
        <div className="decision-hero-body">
          <p className="decision-hero-eyebrow">{url || "Your page"}</p>
          <p className="decision-hero-summary">{decision.businessSummary}</p>

          {decision.quantifiedProofPoints.length > 0 && (
            <div className="proof-chip-row">
              {decision.quantifiedProofPoints.map((p) => <span key={p} className="proof-chip">{p}</span>)}
            </div>
          )}

          {decision.notableCustomers.length > 0 && (
            <p className="trusted-by-row">
              Trusted by <strong>{decision.notableCustomers.join(", ")}</strong>
            </p>
          )}

          <div className="decision-hero-meta">
            <div className="decision-confidence">
              <div className="decision-confidence-ring" style={{ "--pct": confidencePct } as CSSProperties} />
              <div>
                <div className="decision-confidence-label">Confidence</div>
                <div className="decision-confidence-value">{confidencePct}%</div>
              </div>
            </div>
            {sortedStrategies[0] && <span className="decision-winner-badge">★ {sortedStrategies[0].label} wins</span>}
          </div>
        </div>
      </div>

      {decision.recommendedDailyBudgetCents > 0 && (
        <div className="decision-section budget-hero">
          <div className="budget-hero-figure-wrap">
            <div className="budget-hero-figure">{formatCents(decision.recommendedDailyBudgetCents)}/day</div>
            <div className="budget-hero-figure-label">Recommended Daily Budget</div>
          </div>
          {decision.budgetReasoning.length > 0 && (
            <ul className="budget-hero-reasoning">
              {decision.budgetReasoning.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
        </div>
      )}

      {decision.audiencePersonas.length > 0 && (
        <div className="decision-section">
          <p className="decision-section-title"><span className="icon-badge"><UserIcon /></span>Who You're Talking To</p>
          <PersonaCarousel personas={decision.audiencePersonas} />
        </div>
      )}

      {(decision.topOpportunities.length > 0 || decision.topRisks.length > 0) && (
        <div className="decision-section">
          <p className="decision-section-title"><span className="icon-badge"><LightningIcon /></span>Opportunities &amp; Risks</p>
          <div className="callout-grid">
            {decision.topOpportunities.length > 0 && (
              <div className="callout-card good">
                <p className="callout-card-title">↑ Opportunities</p>
                <ul>{decision.topOpportunities.map((o) => <li key={o}>{o}</li>)}</ul>
              </div>
            )}
            {decision.topRisks.length > 0 && (
              <div className="callout-card risk">
                <p className="callout-card-title">⚠ Risks</p>
                <ul>{decision.topRisks.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="decision-section">
        <p className="decision-section-title"><span className="icon-badge"><GlobeIcon /></span>Recommended Direction</p>
        {region && (
          <div className="regional-depth-row">
            <span className="regional-depth-stat"><strong>Region</strong>{region.region}</span>
            {region.marketSize && <span className="regional-depth-stat"><strong>Market Size</strong>{region.marketSize}</span>}
            {region.growthRate && <span className="regional-depth-stat"><strong>Growth Rate</strong>{region.growthRate}</span>}
            {region.policyDrivers.length > 0 && (
              <span className="regional-depth-stat"><strong>Policy Drivers</strong>{region.policyDrivers.join(", ")}</span>
            )}
          </div>
        )}
        <dl className="field-grid">
          <div><dt>Positioning</dt><dd>{decision.recommendedPositioning}</dd></div>
          <div><dt>Audience Priority</dt><dd>{decision.recommendedAudiencePriority}</dd></div>
          <div>
            <dt>Channels</dt>
            <dd>
              {decision.recommendedChannels.length > 0 ? (
                <span className="channel-chip-row">
                  {decision.recommendedChannels.map((c) => <span key={c} className="channel-chip">{c}</span>)}
                </span>
              ) : "—"}
            </dd>
          </div>
          {budgetEntries.length > 0 && (
            <div>
              <dt>Budget Allocation</dt>
              <dd>
                <span className="budget-bar">
                  {budgetEntries.map(([k, v], i) => (
                    <span key={k} className="budget-bar-segment" style={{ width: `${v * 100}%`, background: BUDGET_COLORS[i % BUDGET_COLORS.length] }} />
                  ))}
                </span>
                <span className="budget-bar-legend">
                  {budgetEntries.map(([k, v], i) => (
                    <span key={k}><span className="budget-bar-legend-dot" style={{ background: BUDGET_COLORS[i % BUDGET_COLORS.length] }} />{k} {pct(v)}</span>
                  ))}
                </span>
              </dd>
            </div>
          )}
          <div className="field-full"><dt>Creative Direction</dt><dd>{decision.recommendedCreativeDirection}</dd></div>
          <div><dt>Offer</dt><dd>{decision.recommendedOffer}</dd></div>
          <div><dt>Messaging</dt><dd>{decision.recommendedMessaging}</dd></div>
        </dl>
      </div>

      {decision.pricingTiers.length > 0 && (
        <div className="decision-section">
          <p className="decision-section-title"><span className="icon-badge"><SparkleIcon /></span>Pricing &amp; Monetization</p>
          <div className="pricing-table">
            {decision.pricingTiers.map((t) => (
              <div key={t.tier} className="pricing-tile">
                <div className="pricing-tile-name">{t.tier}</div>
                <div className="pricing-tile-range">{t.priceRange}</div>
                <div className="pricing-tile-details">{t.details}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {topRecommendations.length > 0 && (
        <div className="decision-section">
          <p className="decision-section-title"><span className="icon-badge"><SparkleIcon /></span>Top Ranked Recommendations</p>
          <div className="rec-list">
            {topRecommendations.map((r, i) => <RecommendationRow key={r.id} rec={r} rank={i + 1} />)}
          </div>
        </div>
      )}

      {sortedStrategies.length > 0 && (
        <div className="decision-section">
          <AssistantTag time={decision.generatedAt} />
          <p className="decision-section-title"><span className="icon-badge"><TargetIcon /></span>Candidate Strategies (ranked)</p>
          <div className="strategy-grid">
            {sortedStrategies.map((s) => (
              <StrategyCard key={s.id} strategy={s} simulation={simByStrategy.get(s.id)} isWinner={s.id === winnerId} />
            ))}
          </div>
        </div>
      )}

      {decision.evidence.length > 0 && (
        <details className="decision-evidence-toggle">
          <summary>Show all supporting evidence ({decision.evidence.length})</summary>
          <ul>{decision.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
        </details>
      )}
    </div>
    <div className="decision-progress-rail" aria-hidden="true">
      {Array.from({ length: sectionsShown }).map((_, i) => (
        <span key={i} className="decision-progress-dot filled" />
      ))}
    </div>
    </div>
  );
}

const FACTS_PREVIEW_COUNT = 6;

/** `new URL()` throws on a bare hostname with no scheme (e.g. legacy CrawlJob/CrawlPage
 * rows persisted before WebsiteProvider started normalizing input.url) — parse defensively
 * so one bad row can't crash the whole facts panel. */
function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** "Grounded in N verified facts from your website" — the trust panel. Every concrete
 * claim the AI agents used (prices, named customers, guarantees) is shown with the exact
 * page it was read from, so the campaign is auditable rather than take-our-word-for-it.
 * Renders nothing while facts are loading or when the run produced none. */
function VerifiedFactsSection({ jobId }: { jobId: string }) {
  const [data, setData] = useState<CampaignGenerationFacts | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getCampaignGenerationFacts(jobId).then((d) => { if (!cancelled) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [jobId]);

  if (!data || data.facts.length === 0) return null;
  const shown = expanded ? data.facts : data.facts.slice(0, FACTS_PREVIEW_COUNT);
  const crawlHost = data.crawl ? (safeParseUrl(data.crawl.url)?.hostname.replace(/^www\./, "") ?? data.crawl.url) : null;

  return (
    <div className="verified-facts-section">
      <p className="decision-section-title">
        <span className="icon-badge verified-facts-badge" aria-hidden="true">✓</span>
        Grounded in {data.facts.length} verified facts from your website
      </p>
      {data.crawl && (
        <p className="verified-facts-subline">
          We crawled {data.crawl.pagesCrawled} pages of {crawlHost} — every concrete claim in this campaign traces back
          to one of the facts below, so nothing is invented.
        </p>
      )}
      <ul className="verified-facts-list">
        {shown.map((f, i) => (
          <li key={`${f.field}-${i}`} className="verified-fact-row">
            <span className="verified-fact-value">{f.value}</span>
            <span className="verified-fact-meta">
              {f.sourceUrl && (
                <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="verified-fact-source">
                  {f.sourcePageType && f.sourcePageType !== "other" ? f.sourcePageType : (safeParseUrl(f.sourceUrl)?.pathname ?? f.sourceUrl)}
                </a>
              )}
              <span className="verified-fact-confidence">{Math.round(f.confidence * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
      {data.facts.length > FACTS_PREVIEW_COUNT && (
        <button type="button" className="verified-facts-toggle" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show fewer" : `Show all ${data.facts.length} facts`}
        </button>
      )}
    </div>
  );
}

/** Real competitor ad creative (Meta Ad Library API + Google Ads Transparency Center) — the one
 * new field that doesn't fit the generic evidence-link display, since each entry is a
 * headline/body/preview object rather than a narrative string. */
function CompetitorAdsCard({ competitorAds }: { competitorAds: CompetitorAdsData }) {
  if (competitorAds.ads.length === 0) return null;
  return (
    <div className="decision-section competitor-ads-card">
      <p className="decision-section-title"><span className="icon-badge"><TargetIcon /></span>Competitor Ads — {competitorAds.ads.length} found</p>
      <ul className="competitor-ads-list">
        {competitorAds.ads.slice(0, 10).map((ad, i) => (
          <li key={`${ad.sourceUrl}-${i}`} className="competitor-ad-row">
            <span className={`competitor-ad-platform-badge competitor-ad-platform-${ad.platform}`}>{ad.platform === "meta" ? "Meta" : "Google"}</span>
            <span className="competitor-ad-advertiser">{ad.advertiserName}</span>
            {ad.headline && <span className="competitor-ad-headline">{ad.headline}</span>}
            {ad.bodyText && <span className="competitor-ad-body">{ad.bodyText}</span>}
            <a href={ad.sourceUrl} target="_blank" rel="noreferrer" className="competitor-ad-link">View ad</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Fetches real citation data (same one-shot pattern as VerifiedFactsSection above) and
 * renders the Competitor Ads card. A citations-fetch failure just means the card doesn't
 * render, never a broken page. */
function CompetitorAdsSection({ jobId }: { jobId: string }) {
  const [citations, setCitations] = useState<CampaignGenerationCitations | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getCampaignGenerationCitations(jobId).then((d) => { if (!cancelled) setCitations(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [jobId]);

  return citations?.competitorAds ? <CompetitorAdsCard competitorAds={citations.competitorAds} /> : null;
}

export default function NewCampaign() {
  const { workspaceId, businessId } = useAuth();
  const navigate = useNavigate();
  const wsId = workspaceId ?? localStorage.getItem("polluxa_workspace_id") ?? "demo-workspace";
  const activeJobKey = `polluxa_active_campaign_generation_${wsId}`;
  const activeJobUrlKey = `${activeJobKey}_url`;

  const [pageUrl, setPageUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<CampaignGenerationJobStatus | null>(null);
  const [progressSteps, setProgressSteps] = useState<string[]>([]);
  const [progressTotal, setProgressTotal] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<number | null>(null);

  // Same resumability contract as the old flow: generation runs server-side (BullMQ worker)
  // regardless of whether this component is mounted — persisting just the job id means
  // switching pages and back resumes exactly where it left off. The URL is persisted
  // alongside it purely for display (the resubmit bar / decision hero eyebrow) — the job
  // itself doesn't need it re-sent, since generation is already running server-side.
  useEffect(() => {
    const savedId = localStorage.getItem(activeJobKey);
    if (!savedId) return;
    const savedUrl = localStorage.getItem(activeJobUrlKey);
    if (savedUrl) setPageUrl(savedUrl);
    api
      .getCampaignGenerationStatus(savedId)
      .then(setJob)
      .catch(() => {
        localStorage.removeItem(activeJobKey);
        localStorage.removeItem(activeJobUrlKey);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const factsVisible = job?.status === "completed" || job?.status === "building_campaign";

  useEffect(() => {
    if (!job || job.status === "completed" || job.status === "failed") {
      if (pollRef.current) window.clearInterval(pollRef.current);
      return;
    }
    pollRef.current = window.setInterval(async () => {
      try {
        const updated = await api.getCampaignGenerationStatus(job.id);
        setJob(updated);
      } catch {
        // transient poll failure — the next tick will retry
      }
      try {
        const progress = await api.getCampaignGenerationProgress(job.id);
        setProgressSteps(progress.completedSteps);
        setProgressTotal(progress.total);
      } catch {
        // no live progress available (older job, Redis miss) — the static fallback messaging still shows
      }
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  async function handleStart() {
    const url = pageUrl.trim();
    if (!url) {
      setError("Please enter a page URL to continue.");
      return;
    }
    if (!businessId) {
      setError("No business selected yet — try again in a moment.");
      return;
    }
    setError(null);
    setStarting(true);
    try {
      const created = await api.generateCampaign({ workspaceId: wsId, businessId, url });
      setJob(created);
      setProgressSteps([]);
      setProgressTotal(null);
      localStorage.setItem(activeJobKey, created.id);
      localStorage.setItem(activeJobUrlKey, url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start research — check the URL and try again.");
    } finally {
      setStarting(false);
    }
  }

  // Re-runs the exact same generation pipeline against the same URL/business — deliberately
  // just another POST /campaigns/generate call (same path `handleStart` uses), not a separate
  // "refresh" endpoint: there's no caching/invalidation to bypass, staleness here just means
  // "the last run is old," so the fix is running the same real pipeline again.
  async function handleRefresh() {
    if (!job?.url || !businessId) return;
    setRefreshing(true);
    setError(null);
    try {
      const created = await api.generateCampaign({ workspaceId: wsId, businessId, url: job.url });
      setJob(created);
      setProgressSteps([]);
      setProgressTotal(null);
      localStorage.setItem(activeJobKey, created.id);
      localStorage.setItem(activeJobUrlKey, job.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't refresh research — try again in a moment.");
    } finally {
      setRefreshing(false);
    }
  }

  function handleReset() {
    setJob(null);
    setError(null);
    setPageUrl("");
    setProgressSteps([]);
    setProgressTotal(null);
    localStorage.removeItem(activeJobKey);
    localStorage.removeItem(activeJobUrlKey);
  }

  const isActive = Boolean(job) && job!.status !== "completed" && job!.status !== "failed";
  const isDone = job?.status === "completed";
  const isFailed = job?.status === "failed";
  const currentPhaseIndex = job ? phaseIndex(job.status) : -1;

  return (
    <div className="page-new-campaign">
      <div className="page-header">
        <div>
          <h1>New Campaign</h1>
        </div>
      </div>

      {!job && (
        <div className="new-campaign-hero">
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
            Paste your link below — the Research Orchestrator (9 parallel research providers) and Decision Engine
            will analyze it and build a ranked, evidence-backed campaign strategy, then generate real ads for you.
          </p>

          {error && <p className="error">{error}</p>}

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

          <div className="new-campaign-value-row">
            <div className="new-campaign-value-item">
              <span className="new-campaign-value-icon"><TargetIcon /></span>
              <span>Ranked, explainable recommendations</span>
            </div>
            <div className="new-campaign-value-item">
              <span className="new-campaign-value-icon"><LightningIcon /></span>
              <span>3 simulated strategies — the best one wins</span>
            </div>
            <div className="new-campaign-value-item">
              <span className="new-campaign-value-icon"><SparkleIcon /></span>
              <span>Real ads generated automatically</span>
            </div>
          </div>
        </div>
      )}

      {job && (
        <div className="new-campaign-hero">
          <div className="new-campaign-resubmit-bar">
            <div className="new-campaign-resubmit-row">
              <span className="new-campaign-resubmit-input">{pageUrl || "Your campaign"}</span>
              <button type="button" className="new-campaign-resubmit-btn" onClick={handleReset}>
                Start over
              </button>
            </div>
          </div>

          {error && <p className="error">{error}</p>}

          {isFailed && (
            <div className="crawler-trace">
              <p className="error">{job.error ?? "Campaign generation failed — try a different URL."}</p>
              <button className="btn btn-secondary" onClick={handleReset}>Try again</button>
            </div>
          )}

          {isActive && (
            <div className="crawler-trace">
              <div className="crawler-trace-header">
                <span>Generating your campaign — research, ranking, and ad creation all happen automatically.</span>
              </div>
              <p className="crawler-trace-time-note">
                This usually takes a few minutes — feel free to browse other pages, we'll keep working in the background.
              </p>
              <ul className="crawler-trace-steps">
                {PHASE_ORDER.map((phase, i) => {
                  const done = currentPhaseIndex > i;
                  const active = currentPhaseIndex === i;
                  const PhaseIcon = phase.icon;
                  // Real steps as they actually complete (GET /campaigns/generate/:id/progress)
                  // take over from the static rotating message the moment any exist — an older
                  // job or a Redis miss just leaves progressSteps empty and the static message
                  // still shows, so this never regresses to a blank line.
                  const liveLine = active && progressSteps.length > 0 ? stepLabel(progressSteps[progressSteps.length - 1]) : null;
                  return (
                    <li key={phase.key} className={done ? "done" : active ? "active" : "pending"}>
                      <div className="crawler-trace-step-row">
                        <span className="crawler-trace-step-badge">
                          {active ? <span className="crawler-trace-spinner" /> : <PhaseIcon />}
                        </span>
                        <span>{phase.label}</span>
                        {done && <span className="crawler-trace-step-done-mark" aria-hidden="true">✓</span>}
                      </div>
                      {active && <p className="phase-subline">{liveLine ? `${liveLine}…` : phaseSubline(phase.key)}</p>}
                    </li>
                  );
                })}
              </ul>
              {progressSteps.length > 0 && progressTotal !== null && (
                <p className="crawler-trace-progress-count">{progressSteps.length} of {progressTotal} steps complete</p>
              )}
            </div>
          )}

          {isDone && <FreshnessBadge job={job} onRefresh={handleRefresh} refreshing={refreshing} />}

          {job.decisionContext && <DecisionContextView decision={job.decisionContext} url={pageUrl} />}

          {factsVisible && <VerifiedFactsSection jobId={job.id} />}

          {factsVisible && <CompetitorAdsSection jobId={job.id} />}

          {isDone && (
            <div className="all-set-banner">
              <span className="all-set-banner-icon" aria-hidden="true">✓</span>
              <span>Your campaign is ready — real ads have been generated. Review and launch it in the builder.</span>
            </div>
          )}

          {isDone && job.campaignId && (
            <div className="crawler-result-actions">
              <button className="btn btn-primary" onClick={() => navigate(`/campaigns/${job.campaignId}/builder`)}>
                Review in Campaign Builder
              </button>
              <button className="btn btn-secondary" onClick={handleReset}>Try a different page</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
