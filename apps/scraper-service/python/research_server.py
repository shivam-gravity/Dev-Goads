"""
FastAPI microservice wrapping scrapegraphai's SmartScraperGraph (Ollama backend) so the
New Campaign research pipeline gets real, locally-extracted data when OPENAI_API_KEY
isn't set, instead of the static hardcoded fallback text in marketResearch.ts.

Mirrors the five-step schema in apps/api/src/modules/onboarding/marketResearch.ts (product
positioning -> audience -> competitor/budget -> market/location -> personas) so the Node
side can slot results straight into the same DeepResearchBlock shapes.

The request carries `text` (the page content apps/api's cheerio-based scraper.ts already
fetched) rather than a bare URL. SmartScraperGraph is given that text directly as `source`,
which skips its own network fetch entirely — deliberately, since letting it re-fetch the URL
itself routes through a headless-browser render that has been observed to hang indefinitely
on JS-heavy modern sites (e.g. stripe.com) with no timeout that reliably bounds it. Passing
already-fetched text is both faster (no second page load) and immune to that hang.

Run:  uvicorn research_server:app --port 5055 --host 0.0.0.0
Requires: `ollama serve` running locally with OLLAMA_MODEL pulled (default llama3.2:latest).
"""

import os
from typing import List

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from scrapegraphai.graphs import SmartScraperGraph

OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:latest")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
SCRAPER_TIMEOUT = int(os.environ.get("SCRAPER_TIMEOUT", "300"))


def graph_config() -> dict:
    return {
        "llm": {
            "model": f"ollama/{OLLAMA_MODEL}",
            "model_tokens": 8192,
            "format": "json",
            "base_url": OLLAMA_BASE_URL,
            "temperature": 0,
        },
        "verbose": False,
        "headless": True,
        "timeout": SCRAPER_TIMEOUT,
    }


app = FastAPI()


class ResearchRequest(BaseModel):
    url: str
    text: str = Field(description="Already-scraped page text (e.g. ScrapedSite.excerpt) — used as the extraction source instead of re-fetching the URL")


# ---- schemas mirroring the OpenAI tool schemas in marketResearch.ts ----

class ProductPositioning(BaseModel):
    productName: str
    category: str = Field(description="e.g. SaaS, e-commerce, local service, mobile app, enterprise software")
    businessType: str = Field(description="e.g. Solution & Online Service, E-commerce, Local Service")
    summary: str = Field(description="2-3 sentences on what the business does and who it targets")
    valueProposition: str
    keyFeatures: List[str] = Field(description="2-6 key features")
    pricingModel: str = Field(description="e.g. Custom/enterprise pricing, Subscription, One-time purchase")
    pricingRange: str = Field(description='e.g. "$5,000-$50,000+/year" or "$29-$99/month"')


class AudienceSegment(BaseModel):
    name: str
    description: str


class AudienceDeep(BaseModel):
    primaryAudience: str
    segments: List[AudienceSegment] = Field(description="2-4 audience segments")
    painPoints: List[str] = Field(description="2-5 pain points")
    buyingMotivations: List[str] = Field(description="2-5 buying motivations")
    ageDistribution: str = Field(description='e.g. "30-39 years 42%, 40-49 years 35%"')
    genderRatio: str = Field(description='e.g. "Male 68%, Female 32%"')
    occupation: str
    consumerCharacteristics: str = Field(description="budget, price sensitivity, brand loyalty, buying cycle")
    interestTags: List[str] = Field(description="3-10 interest tags")
    recommendedObjective: str = Field(description="e.g. Leads, Sales, Traffic, Awareness")
    recommendedPerformanceGoal: str


class CompetitorBudget(BaseModel):
    competitors: List[str] = Field(description="1-6 named real competitors, if identifiable")
    competitionIntensity: str
    differentiators: List[str] = Field(description="2-5 differentiators")
    budgetReasoning: List[str] = Field(
        description="step-by-step math: product value -> CPA target -> CVR -> clicks -> blended CPC -> daily budget"
    )
    recommendedDailyBudgetCents: int


class MarketLocation(BaseModel):
    recommendedRegion: str
    alternativeRegions: List[str] = Field(description="1-5 alternative regions")
    marketTrends: str
    competitionLevel: str
    recommendedPlatform: str = Field(description='one of "meta", "google", "tiktok"')
    placementRationale: str


class Persona(BaseModel):
    name: str
    ageRange: str
    genderSplit: str
    details: str
    interests: List[str] = Field(description="6-12 Meta-ads-style interest categories")


class PersonaList(BaseModel):
    personas: List[Persona]


class FullResearchResponse(BaseModel):
    product: ProductPositioning
    audience: AudienceDeep
    competitor: CompetitorBudget
    market: MarketLocation
    personas: List[Persona]


def run_scraper(prompt: str, text: str, schema):
    graph = SmartScraperGraph(prompt=prompt, source=text, config=graph_config(), schema=schema)
    return schema.model_validate(graph.run())


@app.get("/health")
def health():
    return {"status": "ok", "service": "scrapegraphai-research", "model": OLLAMA_MODEL}


@app.post("/research", response_model=FullResearchResponse)
def research(req: ResearchRequest):
    text = req.text
    try:
        product = run_scraper(
            "Extract this business's product/service positioning: what it is, its category, "
            "business type, a 2-3 sentence summary, its value proposition, key features, "
            "pricing model, and typical price range, based on the page content.",
            text,
            ProductPositioning,
        )

        audience = run_scraper(
            "Based on this page's content and who it appears to target, infer the target "
            "audience: primary audience description, 2-4 segments describing distinct kinds "
            "of buyers (not page sections or blog posts), pain points, buying motivations, "
            "estimated age distribution, gender ratio, occupation, consumer characteristics, "
            "interest tags, and a recommended ad objective/performance goal.",
            text,
            AudienceDeep,
        )

        competitor = run_scraper(
            f"Given this business (product: {product.productName}, category: {product.category}, "
            f"pricing: {product.pricingRange}), identify likely competitors in its category, "
            "competition intensity, differentiators it could lean on, a budget reasoning chain "
            "(product value -> CPA target -> clicks needed -> blended CPC -> daily budget), and "
            "a recommended daily ad budget in cents.",
            text,
            CompetitorBudget,
        )

        market = run_scraper(
            f"Given this business (category: {product.category}), infer the strongest regional "
            "market, alternative regions, market trends, competition level, and which ad platform "
            "(meta, google, or tiktok) would perform best with a rationale.",
            text,
            MarketLocation,
        )

        personas = run_scraper(
            "Based on this page's content plus the product, audience, and competitor analysis "
            "below, mine real Meta-ads-style interest keywords from multiple dimensions "
            "(product-related, competitor-brand, professional-role, technology-trend, use-case) "
            "and group them into 4-6 named audience personas, each with its own interest sublist.\n\n"
            f"Product analysis: {product.model_dump_json()}\n\n"
            f"Audience analysis: {audience.model_dump_json()}\n\n"
            f"Competitor analysis: {competitor.model_dump_json()}",
            text,
            PersonaList,
        )

        return FullResearchResponse(
            product=product,
            audience=audience,
            competitor=competitor,
            market=market,
            personas=personas.personas,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"scrapegraphai research failed: {exc}")
