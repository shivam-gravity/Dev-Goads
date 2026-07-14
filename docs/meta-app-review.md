# Meta App Review submission draft — Polluxa

Draft only. Everything below is either (a) grounded in what's actually built and
verified in this repo, or (b) an invented placeholder clearly marked `[MADE UP —
replace]`. Do not submit anything marked as made up to Meta as-is — some fields
(App ID, Business Manager ID, production domain, reviewer credentials) must be
real values from your own Meta Business Manager / App Dashboard for the
submission to mean anything; there's no way to usefully fabricate those.

## 1. App identity

| Field | Value |
|---|---|
| App name | Polluxa `[MADE UP — confirm final product name]` |
| Business Manager ID | `[MADE UP — 000000000000000, replace with real ID]` |
| App ID | `[MADE UP — 0000000000000000, replace with real ID]` |
| App type | Business |
| Production domain | `[MADE UP — https://www.polluxa.ai]` |
| Privacy Policy URL | `{domain}/privacy` (real page, built in this repo at `apps/web/src/pages/Privacy.tsx`) |
| Terms of Service URL | `{domain}/terms` (real page, built in this repo at `apps/web/src/pages/Terms.tsx`) |

## 2. One-paragraph description (for the App Review form)

> Polluxa is a self-serve advertising automation platform. A business describes
> itself and its goals; Polluxa's strategy engine (built on Claude) generates a
> recommended audience, budget split, and ad creatives. Once the business
> reviews and approves the strategy, Polluxa uses the Meta Marketing API and
> Google Ads API — under the business's own OAuth authorization — to create
> and launch campaigns on their connected ad account. An optimization engine
> then monitors performance and reallocates budget toward better-performing
> ad variants, pausing high-cost ones, with every automated action logged for
> the business to review.

`[MADE UP — business model]`: drafted as self-serve SaaS (each business
connects its own ad account). If this is actually an agency tool (you manage
client accounts on their behalf), the permission justifications below need to
shift from "the business's own account" to "client accounts under a
management contract" — different review framing.

## 3. Permissions requested and justification

| Permission | Why Polluxa needs it |
|---|---|
| `ads_management` | Create, read, update, and pause campaigns/ad sets/ads on the connected ad account, and update daily budgets, on behalf of the business that authorized the connection. |
| `ads_read` | Pull performance insights (impressions, clicks, conversions, spend) per ad to feed the optimization engine. |
| `business_management` | Let the authorizing user select which ad account(s) under their Business Manager Polluxa should manage. |

`[MADE UP — confirm against what's actually configured in the App Dashboard]`
— I can't see requested/approved permissions from the codebase; these three
are what the built features actually call for, no more.

## 4. Data handling summary

- **Collected**: business profile (name, industry, budget, goals), OAuth
  access/refresh tokens (encrypted at rest — see `OAuthConnection` model in
  `apps/api/prisma/schema.prisma`), campaign/creative data, performance
  metrics pulled from Meta/Google.
- **Used for**: strategy generation, campaign creation/management, budget
  optimization, usage-based billing.
- **Shared with**: Meta Marketing API and Google Ads API (to execute
  authorized actions), Anthropic's Claude API (business description only, for
  strategy generation), payment processor (billing amounts only).
- **Retention**: for the life of the account plus a limited billing/audit
  window; deletable on request; revoking OAuth access in Meta/Google account
  settings immediately cuts off Polluxa's access.
- **Not done**: Polluxa does not sell data, and does not use ad account data for
  anything beyond the connected business's own campaigns.

This matches the real Privacy Policy draft now live at `/privacy`.

## 5. Demo script (grounded in what's actually built and tested)

This flow was run end-to-end against the real API in this repo (see prior
session notes) — it's accurate to current behavior, not aspirational:

1. Visit the landing page, click **Get started**.
2. Fill in the onboarding form: business name, website, industry, monthly
   budget, goals, target audience.
3. On the dashboard, click **Generate strategy** — the strategy engine
   returns recommended networks, a budget split, target audiences, and 2-4 ad
   creatives (via Claude if `ANTHROPIC_API_KEY` is set, otherwise a
   deterministic fallback — both paths work for the demo).
4. Review the generated strategy and creatives on screen.
5. Click **Launch campaign from this strategy** — this calls
   `POST /api/campaigns` then `POST /api/campaigns/:id/launch`, which invokes
   the Meta and Google ad adapters to create one ad variant per
   creative-per-network.
6. Open the campaign detail page, click **Pull latest metrics** — ingests
   performance data per variant.
7. Click **Run optimization pass** — shows the bandit's decisions (increase
   budget on the best-scoring variant, decrease on others, pause anything
   with high CPA), each with a logged reason.
8. Visit **Billing**, click **Generate invoice for current period** — shows
   the flat fee + percentage-of-spend calculation against real recorded
   spend.

`[MADE UP — reviewer access]`: Meta will want either a screen recording of
this flow or a live test account with pre-seeded data. I can't fabricate
real login credentials — you'll need to create a reviewer/test account
yourselves and hand me the credentials if you want me to also produce the
screen recording script/storyboard.

## 6. Known gaps before this can actually be submitted

- Real Meta Business Manager + App (with the above permissions actually
  requested in the App Dashboard).
- Real production domain the Privacy Policy / Terms URLs resolve to (the
  pages exist in this repo now but need to be deployed).
- A demo video or reviewer test account, per Meta's requirement.
- Legal review of the Privacy Policy / Terms drafts before publishing —
  they're a reasonable starting structure, not vetted legal advice.
