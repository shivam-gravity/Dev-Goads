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

**Agent output that runs but isn't consumed.** All 20 agents run and are persisted, but only
`campaign-agent` (required), `budget-agent`, `pricing-offer-agent`, `objection-handling-agent`,
and `compliance-agent` are read downstream into the strategy. The other 15 — including
`critic-agent` — are computed and persisted but **not currently consumed** by the campaign build.

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

**Uncommitted working-tree changes (this session).** HEAD is unchanged (`50580e4`), so the
following are staged-in-working-tree only, not yet committed:
- **`@anthropic-ai/sdk` removed** from `apps/api/package.json` (+ `package-lock.json`),
  completing the migration off Anthropic — no source file imports it anymore. This is the
  dependency-level finish of the earlier OpenAI→Groq facade swap; the runtime LLM stack is now
  Groq/Ollama/Mistral/Gemini exclusively.
- **Five architecture/roadmap docs deleted** from `docs/`: `CURRENT_ARCHITECTURE.md`,
  `GAP_ANALYSIS_AND_ROADMAP.md`, `architecture-roadmap.md`, `architecture-spec.json`,
  `meta-app-review.md`. This `PROJECT_STATUS.md` was created to consolidate/replace them as the
  single quick-context reference.
- Runtime/build artifacts touched: `apps/api/data/llm-usage.json` (token-usage ledger),
  `apps/web/tsconfig.tsbuildinfo`.

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
checks, robots.txt, dead-letter queues, telemetry) layered on. The next natural work items are
consuming the currently-unused agent outputs, retiring the legacy `ResearchSession` pipeline and
the empty `campaign-intelligence/` folder, wiring real image generation + real revenue tracking,
and reconciling the stale "10 agents / 9 providers / OpenAI" comments with reality.
