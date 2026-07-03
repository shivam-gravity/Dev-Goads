import { FormEvent, useState } from "react";
import { api } from "../api/client.js";

export default function Onboarding({ onOnboarded }: { onOnboarded: (businessId: string) => void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState(1000);
  const [goals, setGoals] = useState("More qualified leads");
  const [targetAudience, setTargetAudience] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const business = await api.createBusiness({
        name,
        website: website || undefined,
        industry,
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

  return (
    <div className="onboarding">
      <h1>Set up your business</h1>
      <p className="subtitle">We'll use this to generate an AI ad strategy and launch campaigns for you.</p>
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
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Setting up..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
