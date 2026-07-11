import { FormEvent, useState } from "react";
import { api, AudienceAnalysis, ProductAnalysis, ScrapedSite } from "../api/client.js";
import { useAuth } from "../context/AuthContext.js";

type Step = "url" | "analyzing-product" | "product" | "analyzing-audience" | "audience" | "details";

export default function Onboarding({ onOnboarded }: { onOnboarded: (businessId: string) => void }) {
  const { workspaceId } = useAuth();
  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState("");
  const [site, setSite] = useState<ScrapedSite | null>(null);
  const [product, setProduct] = useState<ProductAnalysis | null>(null);
  const [audience, setAudience] = useState<AudienceAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState(1000);
  const [goals, setGoals] = useState("More qualified leads");
  const [targetAudience, setTargetAudience] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAnalyzeUrl(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStep("analyzing-product");
    try {
      const scraped = await api.scrapeWebsite(url);
      setSite(scraped);
      const productAnalysis = await api.analyzeProduct(scraped);
      setProduct(productAnalysis);
      setName((n) => n || productAnalysis.productName);
      setIndustry((i) => i || productAnalysis.category);
      setWebsite(scraped.url);
      setStep("product");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't analyze that website");
      setStep("url");
    }
  }

  async function handleAnalyzeAudience() {
    if (!site || !product) return;
    setError(null);
    setStep("analyzing-audience");
    try {
      const audienceAnalysis = await api.analyzeAudience(site, product);
      setAudience(audienceAnalysis);
      setTargetAudience((t) => t || audienceAnalysis.primaryAudience);
      setStep("audience");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't analyze the audience");
      setStep("product");
    }
  }

  function skipToDetails() {
    setError(null);
    setStep("details");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const trimmedName = name.trim();
    const trimmedIndustry = industry.trim();
    if (!trimmedName) { setError("Enter a business name."); return; }
    if (!trimmedIndustry) { setError("Enter an industry."); return; }
    if (!(monthlyBudget > 0)) { setError("Enter a monthly budget greater than 0."); return; }
    if (!workspaceId) { setError("No workspace selected yet — try again in a moment."); return; }

    setSubmitting(true);
    setError(null);
    try {
      const business = await api.createBusiness({
        workspaceId,
        name: trimmedName,
        website: website || undefined,
        industry: trimmedIndustry,
        monthlyBudgetCents: Math.round(monthlyBudget * 100),
        goals: goals.split(",").map((g) => g.trim()).filter(Boolean),
        targetAudience: targetAudience || undefined,
      });
      onOnboarded(business.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const stepIndex = ["url", "analyzing-product", "product", "analyzing-audience", "audience", "details"].indexOf(step);

  return (
    <div className="onboarding">
      <h1>Set up your business</h1>
      <p className="subtitle">Start from your website and AdGo will draft the groundwork for you.</p>

      <div className="onboarding-steps">
        <span className={stepIndex >= 0 ? "onboarding-step-dot active" : "onboarding-step-dot"}>1. Website</span>
        <span className={stepIndex >= 2 ? "onboarding-step-dot active" : "onboarding-step-dot"}>2. Product</span>
        <span className={stepIndex >= 4 ? "onboarding-step-dot active" : "onboarding-step-dot"}>3. Audience</span>
        <span className={stepIndex >= 5 ? "onboarding-step-dot active" : "onboarding-step-dot"}>4. Details</span>
      </div>

      {error && <p className="error">{error}</p>}

      {step === "url" && (
        <form onSubmit={handleAnalyzeUrl} className="card form">
          <label>
            Website URL
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              required
            />
          </label>
          <button className="btn btn-primary" type="submit">
            Analyze my website
          </button>
          <button type="button" className="btn btn-secondary" onClick={skipToDetails}>
            Skip — enter details manually
          </button>
        </form>
      )}

      {step === "analyzing-product" && (
        <div className="card onboarding-loading">
          <div className="onboarding-spinner" />
          <p>Reading your website and identifying what you offer…</p>
        </div>
      )}

      {step === "product" && product && (
        <div className="card">
          <h2>Product analysis</h2>
          <p className="onboarding-analysis-name">{product.productName}</p>
          <span className="pill">{product.category}</span>
          <p>{product.summary}</p>
          <p className="onboarding-value-prop">{product.valueProposition}</p>
          <h3>Key features spotted</h3>
          <ul>
            {product.keyFeatures.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <button className="btn btn-primary" onClick={handleAnalyzeAudience}>
            Looks right — analyze audience
          </button>
          <button type="button" className="btn btn-secondary" onClick={skipToDetails}>
            Skip to details
          </button>
        </div>
      )}

      {step === "analyzing-audience" && (
        <div className="card onboarding-loading">
          <div className="onboarding-spinner" />
          <p>Working out who's likely to buy this…</p>
        </div>
      )}

      {step === "audience" && audience && (
        <div className="card">
          <h2>Audience analysis</h2>
          <p className="onboarding-value-prop">{audience.primaryAudience}</p>
          <h3>Segments</h3>
          <div className="grid-2">
            {audience.segments.map((s) => (
              <div key={s.name} className="creative-card">
                <strong>{s.name}</strong>
                <p>{s.description}</p>
              </div>
            ))}
          </div>
          <h3>Pain points</h3>
          <ul>
            {audience.painPoints.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <h3>What drives the purchase</h3>
          <ul>
            {audience.buyingMotivations.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <button className="btn btn-primary" onClick={() => setStep("details")}>
            Continue to details
          </button>
        </div>
      )}

      {step === "details" && (
        <form onSubmit={handleSubmit} className="card form">
          <label>
            Business name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Website (optional)
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" />
          </label>
          <label>
            Industry
            <input value={industry} onChange={(e) => setIndustry(e.target.value)} required placeholder="e.g. SaaS, e-commerce" />
          </label>
          <label>
            Monthly ad budget (USD)
            <input
              type="number"
              min={1}
              value={monthlyBudget}
              onChange={(e) => setMonthlyBudget(Number(e.target.value))}
              required
            />
          </label>
          <label>
            Goals (comma separated)
            <input value={goals} onChange={(e) => setGoals(e.target.value)} />
          </label>
          <label>
            Target audience (optional)
            <input value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Setting up..." : "Continue"}
          </button>
        </form>
      )}
    </div>
  );
}
