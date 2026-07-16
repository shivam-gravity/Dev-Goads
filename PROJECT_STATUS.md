# PROJECT_STATUS.md

> A zero-context orientation to this platform, read from the actual codebase (not from
> historical notes) on 2026-07-16. Where the code and its comments disagree with each other,
> that drift is called out explicitly rather than smoothed over.

**A naming note up front:** this product is referred to by several names across the tree.
The npm workspace root is `polluxa-platform` and the API logs itself as `Polluxa`; the
`readme` and the Prisma schema comments call it **AdGo**; the web UI brands itself "CRM Ads"
/ "polluxa account". They are all the same product. This doc uses "the platform."

---

## 1. What the platform does

An AI-driven ad-automation platform. A business supplies its website URL; the platform
crawls and researches it across dozens of dimensions, runs a fleet of AI agents to turn
that research into an advertising strategy (audiences, budget split, creatives, offers,
compliance checks), builds a campaign from that strategy, and can launch it across ad
networks (Meta, Google, TikTok). Once live, a performance pipeline ingests results, an
epsilon-greedy bandit reallocates budget toward winners, a lead-gen pipeline syncs inbound
leads to the business's own CRM, and a usage-based billing layer invoices a flat fee plus a
percentage of ad spend. A learning loop feeds real campaign performance back into a research
memory so future recommendations improve.

---

## 2. High-level architecture

### Services (npm-workspace monorepo under `apps/`, all in `docker-compose.yml`)

| Service | Port | Role |
|---|---|---|
| `apps/web` | 8080 | React 18 + Vite + react-router + Recharts dashboard (nginx in Docker). No CSS framework (hand-written `styles.css`), no state library (Context + hooks). |
| `apps/api` | 4000 | **The gateway + all core domain logic.** Express + Prisma/Postgres. Hosts auth middleware, all feature modules, the research→agents→campaign pipeline, and the 8 background workers. |
| `apps/auth-service` | 4001 | Extracted auth + workspace/membership HTTP endpoints. Shared Postgres; imports `apps/api`'s own `authService`/`workspaceService` in-process. |
| `apps/campaign-service` | 4002 | Extracted campaign CRUD/launch/optimize + billing endpoints. Shared Postgres; imports `apps/api` modules in-process. |
| `apps/scraper-service` | 4003 | Node + real Playwright/Chromium scraper (product import + research-scrape fallback). Has an **optional dev-only** Python FastAPI/`scrapegraphai`/Ollama sidecar (`python/`) that is **not** in Docker. |

Auth-service and campaign-service use a deliberate **shared-database extraction pattern**
(documented in-code as "roadmap Phase 2"): the gateway proxies specific route groups to them
via `proxyTo(...)`, but the business logic still physically lives in `apps/api/src/modules/*`
and is imported, not duplicated.

**Infrastructure:** Postgres 16, Redis 7 (BullMQ queues + Redis Streams event bus + distributed
locks), and a self-hosted SearXNG. Object storage and vector store are local-file/in-memory
reference implementations behind provider-agnostic interfaces.

### The pipeline (`POST /api/campaigns/generate` → `campaignGenerationWorker` → `runCampaignGenerationPipeline`)

The core flow, sequenced in `modules/orchestrator/campaignGenerationPipeline.ts`, is
**Research → Brain (Decision + Enrichment + Agents) → Campaign Builder**:

1. **Research Orchestrator** (`research/research-orchestrator/`) fans out **27 research
   providers in parallel** (each independently retried/timed-out, every attempt persisted as
   a `ProviderExecution` audit row), then the **Knowledge Aggregator** validates each result
   against a Zod schema and fuses them (authority × confidence × freshness) into one
   strongly-typed `ResearchContext`.
2. **Crawl fact extraction** runs before the agents so the fact-grounded agents can read
   verified `CrawlFact` rows; **Company Knowledge Builder** assembles a persisted
   `CompanyProfile`.
3. **PlatformBrain.think()** (`brain/PlatformBrain.ts`) runs three things concurrently off the
   same `ResearchContext`: the **Decision Engine** (→ `DecisionContext`: recommendations,
   rankings, tradeoffs, SWOT, simulated strategies), the **Intelligence Enrichment** pass
   (Creative/Pricing/Landing-Page engines), and the **Agent Coordinator** (20 agents).
4. **Agent Coordinator** (`agents/AgentCoordinator.ts`) runs 18 producer agents in parallel,
   then 2 reviewer agents (critic, compliance) in parallel over the producers' output.
5. **Campaign Builder** turns the agent output + decision context into a `Strategy`, then a
   `Campaign` (`buildCampaignFromStrategy`), and additively generates 6 ranked
   `CampaignRecommendation` packages.

Progress across all three phases is reported on one unified scale (27 providers + 20 agents + 1
build step = 48 units). The whole run is guarded by a per-business distributed lock.

### Key data models (`apps/api/prisma/schema.prisma`)

Most tables follow a `{ id, workspaceId, data Json }` blob convention (a SQLite→Postgres driver
swap, not a redesign). Notable relational models:

- **Tenancy:** `User`, `Workspace`, `WorkspaceMember`, `Business` (+ `domain`).
- **Campaign chain:** `Strategy`, `Campaign`, `AdSet`, `Ad`, `Creative`, `Metric`, `Draft`, `Asset`.
- **Research (new pipeline):** `ResearchJob` → `ProviderExecution` / `ResearchSnapshot` / `ResearchEvidence`.
- **Research (legacy pipeline):** `ResearchSession` (see gaps below).
- **Crawl:** `CrawlJob` → `CrawlPage` → `CrawlFact` (facts with provenance + confidence).
- **Intelligence layer:** `CompanyProfile`, `Competitor` → `CompetitorProfile` / `CompetitorAd` → `AdCreativeAnalysis`, `CampaignRecommendation`, `ResearchMemoryEntry` (RAG embeddings as `Float[]`, app-side cosine — no pgvector).
- **Learning loop:** `CampaignPerformanceSnapshot`, `RecommendationFeedback`, `SuccessPattern`.
- **Lead-gen/CRM:** `LeadForm` → `Lead` → `Contact`.
- **Ops/meta:** `GenerationJob`, `CampaignGenerationJob`, `DeadLetterEntry`, `AiEvaluationRun`, `AutomationRule`, `OptimizationGoal`, plus developer-portal/RBAC/notification/billing tables.

---

## 3. What's built and working

**Core pipeline**
- Research Orchestrator — 27 providers, parallel fan-out, per-provider retry/timeout/audit. ✅ Working.
- Knowledge Aggregator + Fusion — Zod-validated, confidence/authority/freshness fusion into `ResearchContext`. ✅ Working.
- Agent Coordinator — 20 agents (18 producers + critic + compliance), two-phase parallel. ✅ Working.
- Decision Engine — deterministic scoring/ranking/tradeoffs/SWOT + simulated strategies. ✅ Working.
- Campaign Builder — strategy → campaign + 6 ranked recommendation packages. ✅ Working.
- Crawl + fact extraction — real crawler (Playwright/cheerio + Firecrawl fallback), honors robots.txt. ✅ Working.
- Research caching (campaign path) — a completed `ResearchJob`'s `ResearchContext` is reused for a repeat generation of the same (workspace, business, url) within a 7-day TTL (`CAMPAIGN_RESEARCH_CACHE_TTL_MS`), skipping the 27-provider fan-out + fact re-extraction while still building the campaign fresh. `forceRefresh: true` in the request body bypasses it; a defense-in-depth identity check prevents ever serving another business's research. ✅ Working (new this session; see §5).

**Ad-network + e-commerce integrations** (all real API clients with a credential-gated fallback to mock)
- Meta — real Graph API OAuth, ad create, reach estimate, lead sync, webhook HMAC. ✅ Real when configured.
- Google Ads — real OAuth + ads client + lead sync. ✅ Real when configured.
- TikTok — real Marketing API OAuth + adapter. ✅ Real when configured.
- Shopify / WooCommerce — real OAuth + live product catalog + webhook HMAC. ✅ Real when configured.

**Application features**
- Lead-gen → CRM: lead-form/lead ingestion, contact dedupe, outbound CRM webhook delivery. ✅ Working.
- Optimization: epsilon-greedy bandit + creative-fatigue detection + optimization goals. ✅ Working.
- Performance pipeline: normalizes per-variant CTR/CVR/CPA (revenue/ROAS is estimated — see gaps). ✅ Working (estimated revenue).
- Billing: usage-based invoicing + masked payment-method storage. ✅ Working (mock payment rails).
- Automation rules, analytics/ad-insights dashboards, saved audiences, AI copilot/strategist chat, admin RBAC/audit/developer-portal. ✅ Working.
- Creative generation: jobs + video via Runway when keyed. ✅ Working (images are mock-only — see gaps).

**Platform infrastructure**
- BullMQ queues, distributed locks, dead-letter persistence, Redis Streams event bus, graceful shutdown, OpenTelemetry spans, Sentry error tracking, per-request rate limiting, monthly LLM token ceiling. ✅ Working.
- Multi-provider LLM router (Groq/Ollama/Mistral/Gemini) with per-task assignment + fallback chain. ✅ Working. The `@anthropic-ai/sdk` and OpenAI clients are now fully removed from dependencies (see §5).
- Multi-provider search router (Tavily/Serper/SearXNG) + Firecrawl scrape/crawl. ✅ Working.
- AI evaluation harness (`eval/`) — golden-dataset grading of real provider/agent calls. ✅ Working (run manually; billed, so not in CI).
- Test suite: ~105 test files across the workspaces.

---

## 4. Known gaps / incomplete areas / dead code

**Two research pipelines coexist (intentionally).** The legacy `ResearchSession` model +
`researchSessionWorker` (sequential scraper→LLM "deep research", flat `blocks` array) still
exists and works for callers on it. The current pipeline is `ResearchJob` + the parallel
27-provider orchestrator. New work targets the latter; `ResearchSession` is legacy-but-live.

**Superseded-but-retained providers.** `CompetitorProvider`, `MarketProvider`, and
`AudienceProvider` are exported and unit-tested but **not** in the registered provider array —
their `…IntelligenceProvider` counterparts replaced them in the production slots. Kept as
lighter-weight reference implementations, not deleted.

**Empty/dead directory.** `apps/api/src/campaign-intelligence/` is an **empty folder**. The
real, live campaign-intelligence code lives elsewhere:
`research/decision/campaign-intelligence-store.ts` and `campaign-learning-engine.ts`. Easy to
confuse; the top-level folder is dead.

**Dead / superseded code paths**
- `modules/billing/billingEngine.ts` is **dead inside `apps/api`** — billing moved to
  campaign-service; only `apps/campaign-service` imports it. (`paymentMethodService.ts` next to it is still live.)
- `firecrawlClient.ts`'s `firecrawlSearch` (`/search`) is superseded by the search router
  (Firecrawl hit its credit limit); Firecrawl is now used only for scrape/map/crawl.
- `pullpushClient.searchRedditComments` — present, called by nothing ("kept for future use").
- `infra/vectorStore.ts` `hashEmbedding` — a deterministic **pseudo-embedding stub**,
  explicitly not semantic. Real RAG embeddings actually go through `mistral-embed` in
  `llmClient.createEmbedding` / `MemoryCoordinator`, so this vector store is a placeholder.

**Mock/demo surfaces (intentional dev behavior, not bugs)**
- **No login/signup flow in the web app.** Unauthenticated requests resolve to a seeded
  `demo-user` via a backend dev bypass; the only client-side gate is "has this workspace
  onboarded". `/login` and `/signup` now 404.
- **Ad networks fall back to mock** when no app credentials are set — every "Connect" completes
  a labeled `(mock)` connection and every launch/pause/insights call returns synthetic data.
  The API logs a loud startup warning if `NODE_ENV=production` with no ad-network app configured.
- **Image generation is mock-only** — `MockImageProvider` is the only backend (OpenAI
  `gpt-image-1` was removed; Groq/Mistral/Gemini aren't wired for images). Video is real via Runway when keyed.
- **Revenue/ROAS is estimated**, not tracked — `ESTIMATED_REVENUE_CENTS_PER_CONVERSION = 5000`
  (a hardcoded $50 AOV) in `performancePipeline.ts`.
- Facebook/Google **product catalog** sources are demo-only ("until Phase 5"); only
  Shopify/WooCommerce have live adapters.

**Agent output: 10 of 20 now consumed.** All 20 agents run and are persisted. As of this
session **10** are read downstream into the strategy (`createStrategyFromAgentResults`, plus
`budget-agent` feeding the daily budget): `campaign-agent` (required), `budget-agent`,
`pricing-offer-agent`, `objection-handling-agent`, `compliance-agent`, and — newly wired this
session — `creative-agent`, `critic-agent`, `keyword-agent`, `persona-agent`, and
`audience-agent`. The remaining **10** are computed and persisted but **not currently consumed**
by the campaign build: `channel-placement`, `competitor`, `forecasting-kpi`, `funnel-retargeting`,
`landing-page`, `localization`, `market`, `product`, `seo-content`, and `seasonality-timing`.

**Measured scaling bottleneck — Ollama-absent-in-prod → Groq 429s.** `infra/llmTaskConfig.ts`
assigns all 20 agents and the 27 research-structuring steps to **Ollama** as their primary
model, but Ollama is dev-only and **not** in `docker-compose.yml`. In a containerized deploy every
one of those ~47 per-campaign calls fails Ollama and falls through to the shared free-tier
**Groq** key, which has no client-side rate limiting (and the OpenAI-compatible SDK's default
retries amplify the burst) — the root cause of the observed 429 storms (526 Groq 429s in one job;
a live test in this session's suite also hit Groq's 100k-tokens/day ceiling). Secondary measured
ceilings: the global **5M-token/month** LLM budget is a hard stop with no fallback (~7–16
campaigns/month at ~300–700k tokens each), and Tavily's ~**1,000 free searches/month** (~20
campaigns at ~50 searches each). The research cache (§5) relieves all three by not re-spending on
repeat generations of the same business. Scraping concurrency (4 Playwright pages via
`SCRAPER_MAX_CONCURRENT_PAGES`, single scraper-service instance) is a latency wall, not the first
hard break.

**Reference-only infra implementations** awaiting real backends (all behind interfaces):
`InMemoryEventBus` (tests only; prod uses Redis Streams), `LocalFileObjectStorage` (awaits
S3/GCS/R2 + signed URLs), `InMemoryVectorStore` (awaits a real vector DB). Postgres has **no
pgvector**, so `ResearchMemoryEntry.embedding` is a `Float[]` scored with app-side cosine
similarity.

**Documentation drift to be aware of** (stale comments, not broken code):
- Comments in the agents folder still say "10 agents" (`AgentCoordinator.ts`, `support.ts`);
  there are actually **20**.
- Several research comments say "9-provider pipeline"; there are actually **27**
  (`researchOrchestratorWorker`'s comment also says "9-provider").
- Multiple infra comments still name **OpenAI/Claude/Anthropic** as live providers
  (`tokenMeter.ts`, `llmUsageBoundary.ts`, `geminiClient.ts`, `queue.ts`,
  `researchSessionWorker.ts`). Both providers are genuinely gone: there is no OpenAI client,
  and as of this session `@anthropic-ai/sdk` has been **removed from `apps/api/package.json`
  with zero remaining source references** (the `openai` npm package survives only as an
  OpenAI-compatible SDK pointed at Groq/Ollama base URLs). These references are therefore now
  definitively comment-only drift. The `readme` similarly still describes Claude as the
  strategy LLM; the actual default is Groq.
- `apps/api/src/agents/agents/` contains 20 registered agents; 3 providers on disk (30 files)
  aren't registered (the superseded trio above).

**Worker wiring gap.** There are **8 worker files** but **7 workers in `docker-compose.yml`** —
`competitorAdRefreshWorker.ts` is not listed in compose (verify how/whether it's started in a
deployed environment).

---

## 5. Recent significant changes (last ~20 commits)

**Now committed (`3d571e8`).** The batch this doc previously listed as uncommitted has since
been committed: the **`@anthropic-ai/sdk` removal** (completing the migration off Anthropic — no
source file imports it anymore; the runtime LLM stack is now Groq/Ollama/Mistral/Gemini
exclusively) and the consolidation of **five deleted `docs/` architecture files** into this
`PROJECT_STATUS.md`.

**This session (uncommitted working tree).**
- **Research caching on the campaign path.** `POST /campaigns/generate` no longer re-runs the
  full research pipeline for a repeat of the same (workspace, business, url): a completed
  `ResearchJob`'s `ResearchContext` is reused within a 7-day TTL (`CAMPAIGN_RESEARCH_CACHE_TTL_MS`,
  `findReusableResearch`), skipping the 27-provider fan-out **and** crawl-fact re-extraction
  (`persistCrawlFacts` is a non-idempotent `createMany`, so re-running would double fact rows),
  while still building the campaign fresh. `forceRefresh: true` (request body → BullMQ payload →
  pipeline option, zero schema migration) bypasses it; a defense-in-depth identity check
  (`context.businessId`/`url` must match the job, with a tripwire warning) prevents serving
  another business's research. Adds pipeline unit tests (a–f) and a DB-backed `findReusableResearch`
  test (TTL boundary / status filter / null-context / cross-business+workspace isolation /
  newest-first). `apps/api/src/test/findReusableResearch.test.ts` is a new untracked file.
- **Five more agents wired into the campaign.** `creative`, `critic`, `keyword`, `persona`, and
  `audience` agent outputs are now consumed by `createStrategyFromAgentResults`/`strategyEngine`
  (previously computed-but-unused), taking the consumed count from 5 → 10 (see §4).
- **Placeholder/demo business-name search guard.** `sanitizeBusinessName`
  (`research/providers/support.ts`) strips generic/placeholder/legal tokens ("Polluxa Demo
  Business" → "Polluxa") before a name anchors a live search, so seed/demo records don't produce
  empty exact-phrase queries or seed a market-engine hallucination off the word "Demo"; falls
  back to the domain when nothing distinctive remains. Applied in `buildSearchQuery` and
  `MarketIntelligenceEngine`.
- **Competitor enrichment cap raised 6 → 8** (`CompetitorIntelligenceEngine.ts`) — a larger
  corroborated competitive set, at one extra search + extraction call per added name.
- **`googleAdapter.test.ts` typecheck fix** — closure-captured `capturedOps` read through a typed
  local so `tsc` passes (runtime was always fine; the `tsx` test runner doesn't type-check).
- Other working-tree changes not detailed here: Meta/Google targeting mappers, image provider,
  `llmUsageBoundary`, and their tests.

**Also recently committed (same arc).**
- **RedditProvider now sources via PullPush.** `RedditProvider` fetches real Reddit threads
  through `infra/pullpushClient.ts` (`searchRedditThreads`) instead of Firecrawl. (`searchRedditComments`
  in that client remains unused — see §4.)
- **Fabricated-competitor-URL guard + one-time migration.** Competitor discovery (`discovery.ts`)
  no longer lets the name-extraction LLM invent a `url` for a discovered competitor — it
  consistently attached the citation page's URL (g2.com/forbes.com/owler.com), not the
  competitor's own site. `scripts/migrateCompetitorMemoryUrls.ts` is the idempotent one-time
  cleanup that nulls those fabricated URLs on existing `research_memory_entries` rows (76/76
  flagged), writing a timestamped JSON backup first (`data/migrations/competitor-memory-url-backup-*.json`).

**Committed history** — the recent commits center on a **major research-architecture buildout
and an LLM-provider swap**:

1. **Research architecture (multiple commits, the dominant theme).**
   `feat: initialize monorepo with core API research agents…`, `feat: implement comprehensive
   research intelligence layer, competitor ad discovery, and campaign generation pipeline`,
   `feat: implement comprehensive research architecture with modular LLM clients, specialized
   intelligence engines, and multi-provider data sourcing`, and `feat: implement multi-provider
   research architecture with search infrastructure, specialized providers, and comprehensive
   test suites`. This is the build-out of the 27-provider orchestrator, the intelligence
   engines, competitor/ad discovery, and the campaign-generation pipeline.

2. **LLM provider swap: OpenAI → Groq-routed facade.**
   `refactor: implement robust dynamic fetch middleware and replace OpenAI client with a
   Groq-routed LLM facade`. OpenAI was removed as a provider; `infra/llmClient.ts` became a
   drop-in facade routing legacy call sites through the Groq/Mistral/Gemini/Ollama router. The
   `dynamicFetch` middleware exists so the OpenAI-compatible SDK doesn't defeat test fetch mocks.

3. **Web scraping / onboarding.**
   `feat: implement web scraper and sitemap discovery for site onboarding workflows` and the
   crawl-data storage work (`CrawlJob`/`CrawlPage`/`CrawlFact`, `Business.domain`).

4. **Agent framework + fact-grounding.**
   `feat: implement core agentic framework, research engines, and integration modules`,
   `feat: put 3 of the 20 agents' output to actual use in the built campaign`, and
   `feat: ground creative/campaign/critic agents in verified crawl facts` — agents were wired
   into the pipeline and progressively grounded in extracted `CrawlFact` rows.

5. **Campaign-generation UI.**
   `feat: implement campaign generation UI with real-time status tracking and strategy
   simulation dashboard` — the wizard + live-progress front end.

6. **Production hardening.**
   `feat: bare-id ownership checks, crawler robots.txt + rate limiting…`,
   `fix(docker): install openssl in the shared node-service image`, and
   `fix: resolve 6 bugs found in full-stack QA pass`.

7. **Data honesty fix.**
   `fix: remove fabricated research data and fix cross-provider LLM/search failures` — removed
   synthetic research output in favor of honest AI-estimate fallbacks + real cross-provider fixes.

8. **Ongoing noise.** Several `feat: initialize llm-usage tracking…` commits and an uncommitted
   working change to `apps/api/data/llm-usage.json` (the local token-usage ledger).

**Net direction:** the platform has moved from an OpenAI/Claude-centric MVP toward a
multi-provider, research-heavy, fact-grounded pipeline with production-hardening (ownership
checks, robots.txt, dead-letter queues, telemetry) layered on, and — this session — a research
cache that starts to address the measured scaling ceilings. The next natural work items are
fixing the Ollama-absent-in-prod → Groq 429 root cause (run Ollama in prod or reassign primaries
off the free Groq key; see §4), consuming the remaining 10 unused agent outputs, retiring the
legacy `ResearchSession` pipeline and the empty `campaign-intelligence/` folder, wiring real
image generation + real revenue tracking, and reconciling the stale "10 agents / 9 providers /
OpenAI" comments with reality.
