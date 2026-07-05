# Architecture Roadmap: Monolith → Target Microservices

## Context

This document compares the target architecture below against what exists in this repo today, and lays out a phased, strangler-fig migration path — extracting services and adding infrastructure incrementally rather than rewriting.

Target architecture:

```
                           +----------------------+
                           |     Next.js UI       |
                           +----------+-----------+
                                      |
                                HTTPS / GraphQL
                                      |
                         +------------v------------+
                         |      API Gateway        |
                         | Authentication          |
                         | Rate Limiting           |
                         | API Versioning          |
                         +------------+------------+
                                      |
              ------------------------------------------------------
              |          |          |          |          |          |
     Auth Service  Workspace   Campaign   AI Agent   Billing   Notification
                   Service     Service    Service    Service      Service
              |          |          |          |          |          |
              ------------------------------------------------------
                                      |
                            Event Bus (Kafka)
                                      |
          ----------------------------------------------------------------
          |              |               |               |                |
    Creative Engine  Deep Research  Audience AI  Budget Optimizer  Analytics
          |              |               |               |                |
          ----------------------------------------------------------------
                                      |
                          Integration Layer
      --------------------------------------------------------------
      |             |              |             |                  |
 Google Ads     Meta Ads      TikTok Ads    Shopify API      WooCommerce
      |             |              |             |                  |
      --------------------------------------------------------------
                                      |
                          Data Processing Layer
      --------------------------------------------------------------
      PostgreSQL      Redis       ClickHouse      Vector DB
      Object Store    Elasticsearch
```

Infra provider choices (AWS/GCP/self-hosted) are deliberately left open — this roadmap flags where that choice matters rather than committing to one.

## Gap Analysis (target vs. current)

| Target component | Current state |
|---|---|
| Next.js UI | React 18 + Vite SPA (`apps/web`), not Next.js — no SSR/routing-on-server today |
| API Gateway (auth, rate limiting, versioning) | Single Express app (`apps/api/src/index.ts`) with one mounted router (`apps/api/src/gateway/router.ts`); has `requireAuth` and a rate-limit middleware, but no API versioning and no service-to-service routing — it *is* the whole backend |
| Auth Service | `apps/api/src/modules/auth/` — custom JWT register/login/google-auth, in-process, not a separate service |
| Workspace Service | `apps/api/src/modules/workspace/` — multi-tenant workspace/members/roles, in-process module |
| Campaign Service | `apps/api/src/modules/orchestrator/campaignOrchestrator.ts` + `strategy/strategyEngine.ts` + `drafts/` — campaign build/launch/pause logic, in-process |
| AI Agent Service | Split across `onboarding/analysis.ts` (Claude-driven product/audience analysis), `orchestrator/creativesService.ts` (creative generation), `insights/` — no dedicated service boundary |
| Billing Service | `apps/api/src/modules/billing/` — invoice generation from spend, in-process |
| Notification Service | `apps/api/src/modules/notifications/` — per-workspace feed, in-process, no push/email delivery |
| Event Bus (Kafka) | **Does not exist.** No message queue of any kind; everything is synchronous in-process function calls |
| Creative Engine (worker) | `orchestrator/creativesService.ts` — runs synchronously inside a request, not an async worker |
| Deep Research (worker) | `onboarding/scraper.ts` + `analysis.ts` (`runDeepResearch`) — cheerio scrape + Claude calls, synchronous |
| Audience AI (worker) | Partially present as `strategyEngine.ts` audience suggestions; not a separate worker |
| Budget Optimizer (worker) | `optimization/optimizationEngine.ts` — pause/reallocate logic, run synchronously/on-demand, not event-driven |
| Analytics (worker) | `pipeline/performancePipeline.ts` + `analytics/` — metric ingestion/summary, synchronous |
| Integration Layer | `adapters/` defines an `AdAdapter` interface with `googleAdapter.ts` + `metaAdapter.ts`; **both fall back to fully mocked responses when live credentials are absent** — real API wiring exists but is unverified. **No TikTok Ads, Shopify, or WooCommerce adapters exist.** |
| PostgreSQL | `apps/api/prisma/schema.prisma` defines a full normalized Postgres schema (Organization, User, Business, Campaign, Metric, etc.) but **it is not wired up** — the running app uses `better-sqlite3` against `apps/api/data/adgo.sqlite` with hand-written JSON-blob tables instead |
| Redis | Does not exist — no caching or session store beyond JWT |
| ClickHouse | Does not exist — the Prisma schema has a comment noting `Metric` is intended to become a TimescaleDB hypertable eventually, not ClickHouse |
| Vector DB | Does not exist — no embeddings/vector search anywhere |
| Object Store | Does not exist — `assets/` module manages creative asset *metadata* only, no blob storage backend found |
| Elasticsearch | Does not exist |
| Docker / CI / IaC | **None found anywhere in the repo** — no Dockerfile, docker-compose.yml, GitHub Actions workflow, or Terraform/Pulumi. Pure local-dev today. |

**Bottom line:** this is a well-organized modular monolith with genuinely reusable business logic (adapters interface, strategy engine, orchestrator, onboarding/research pipeline) but zero distributed-systems infrastructure. The migration is much more about *adding infrastructure incrementally* and *extracting module boundaries into services* than rewriting business logic.

## Phased Roadmap

### Phase 0 — Foundations (no architecture change, de-risks everything after)
- Add Docker Compose for local dev (Postgres, Redis) and a basic CI workflow (lint/typecheck/test) — currently completely absent, and every later phase depends on having a repeatable environment.
- Decide real vs. mock ad-adapter testing strategy; add integration tests around `googleAdapter.ts`/`metaAdapter.ts` before they're relied on by more services.

### Phase 1 — Real database, still a monolith
- Wire up the existing `apps/api/prisma/schema.prisma` against real Postgres, replacing `better-sqlite3`/`adgo.sqlite`. Write a one-time migration script to move existing SQLite JSON-blob rows into the normalized schema.
- Introduce Redis for session/cache and as a lightweight job queue (e.g. BullMQ) so long-running work (scraping, Claude analysis, creative generation) moves off the request thread — this is a prerequisite for later event-driven workers and costs nothing architecturally since it stays in-process.
- No service extraction yet; this phase is purely "swap the data layer, add async job execution."

### Phase 2 — Extract first services behind the gateway
- Turn the existing Express app into a real **API Gateway**: keep it as the single ingress, but move Auth and Workspace modules into a separate deployable service (they're the most self-contained and least coupled to campaign/creative logic).
- Add API versioning (`/api/v1/...`) at the gateway.
- Campaign Service and Billing Service extracted next, since `campaignOrchestrator.ts`/`billing/` already have clean module boundaries.

### Phase 3 — Event bus + async workers
- Introduce Kafka (or a managed equivalent) once there are ≥2 services that need to react to the same event (e.g. "campaign launched" triggering both Analytics and Notifications) — don't introduce it earlier, since a job queue covers single-consumer async work more cheaply.
- Convert `optimizationEngine.ts` (Budget Optimizer) and `performancePipeline.ts` (Analytics) into event-driven consumers off the bus.
- Convert `onboarding/analysis.ts` (Deep Research) and `orchestrator/creativesService.ts` (Creative Engine) into workers triggered by events rather than synchronous calls.

### Phase 4 — Specialized data stores
- Add ClickHouse (or TimescaleDB, matching the existing Prisma comment) once metric volume/query patterns justify it — `Metric`/`NormalizedPerformance` data is the only candidate today.
- Add a Vector DB when Deep Research needs semantic search/embeddings (not needed for the current keyword/rule-based analysis fallback).
- Add Object Store for `assets/` module blobs (currently metadata-only).
- Add Elasticsearch only if/when full-text search across campaigns/creatives becomes a real requirement — nothing today needs it.

### Phase 5 — Expand integration layer
- Add a TikTok Ads adapter following the existing `AdAdapter` interface pattern from `googleAdapter.ts`/`metaAdapter.ts`.
- Add Shopify and WooCommerce adapters for product/catalog sync, feeding the Campaign/Creative services.

### Sequencing notes
- Frontend migration (Vite SPA → Next.js) is independent of the backend phases and lowest priority — nothing in the target backend architecture requires it, and the current SPA works with any of the phases above via the API Gateway.
- Each phase should ship independently deployable and reversible; don't start Phase N+1 until Phase N is running in production, per strangler-fig practice.
- Infra provider choice (AWS/GCP/self-hosted) mainly affects *how* Phases 0, 3, and 4 are implemented (managed Kafka/Postgres/ClickHouse vs. self-hosted) — deferred for now, but should be decided before Phase 3 since Kafka is the highest-cost/highest-effort infra decision.
