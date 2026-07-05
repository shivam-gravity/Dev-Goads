import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import Reveal from "../components/Reveal.js";

const STEPS = [
  "Goal",
  "Platforms",
  "Budget & Schedule",
  "Audience",
  "Creatives",
  "Review & Launch"
] as const;

export default function CampaignWizard({ businessId }: { businessId: string }) {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [goal, setGoal] = useState<"sales" | "leads" | "traffic" | "awareness">("sales");
  const [platforms, setPlatforms] = useState<("meta" | "google" | "tiktok")[]>(["meta", "google"]);
  const [dailyBudget, setDailyBudget] = useState("50");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState("");
  const [locations, setLocations] = useState<string[]>(["United States"]);
  const [locationInput, setLocationInput] = useState("");
  const [demographics, setDemographics] = useState({ ageMin: 18, ageMax: 65, gender: "all" });
  
  // Creative state
  const [headline, setHeadline] = useState("Transform Your Ad Campaigns");
  const [body, setBody] = useState("AI-powered ad management that helps you scale Meta and Google Ads with zero hassle.");
  const [cta, setCta] = useState("Start Free Trial");

  function nextStep() {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  }

  function prevStep() {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }

  function togglePlatform(p: "meta" | "google" | "tiktok") {
    setPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  }

  function addLocation() {
    if (locationInput.trim() && !locations.includes(locationInput.trim())) {
      setLocations([...locations, locationInput.trim()]);
      setLocationInput("");
    }
  }

  function removeLocation(loc: string) {
    setLocations(locations.filter(l => l !== loc));
  }

  async function handleLaunch() {
    setLoading(true);
    setError(null);
    try {
      const budgetCents = Math.round(parseFloat(dailyBudget) * 100);
      
      await api.createDraft(localStorage.getItem("adgo_workspace_id") ?? "demo", {
        name: `CampaignWizard Campaign - ${goal.toUpperCase()}`,
        type: "campaign",
        data: {
          goal,
          platforms,
          dailyBudgetCents: budgetCents,
          startDate,
          endDate: endDate || null,
          targeting: {
            locations,
            ageMin: demographics.ageMin,
            ageMax: demographics.ageMax,
            gender: demographics.gender
          },
          creatives: [{ headline, body, callToAction: cta }]
        },
        aiRecommendation: "Generated through Campaign Wizard. Ready to publish.",
        score: 95
      });

      navigate("/drafts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch campaign draft");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="campaign-wizard">
      <div className="page-header">
        <div>
          <h1>Campaign Wizard</h1>
          <p className="subtitle">Let AI guide you to launch optimized campaigns in minutes.</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="wizard-stepper">
        {STEPS.map((step, idx) => (
          <div
            key={step}
            className={`wizard-step-node ${
              idx === currentStep ? "active" : idx < currentStep ? "completed" : ""
            }`}
          >
            <div className="step-number">{idx < currentStep ? "✓" : idx + 1}</div>
            <span className="step-label">{step}</span>
          </div>
        ))}
      </div>

      <div className="card wizard-content-card">
        <Reveal>
          {currentStep === 0 && (
            <div className="wizard-step-panel">
              <h2>Select Campaign Goal</h2>
              <p className="muted-text mb-4">Choose what you want to achieve with this campaign.</p>
              <div className="goal-grid">
                {[
                  { id: "sales", title: "Sales / Conversions", icon: "💰", desc: "Drive purchases, checkouts, and conversion actions on your website." },
                  { id: "leads", title: "Lead Generation", icon: "📧", desc: "Collect emails, contact info, and sign-ups for your product or newsletter." },
                  { id: "traffic", title: "Website Traffic", icon: "🖱️", desc: "Get more visitors to check out your landing pages or blog posts." },
                  { id: "awareness", title: "Brand Awareness", icon: "📣", desc: "Maximize reach and impressions to build interest in your brand." }
                ].map(item => (
                  <div
                    key={item.id}
                    className={`goal-card ${goal === item.id ? "selected" : ""}`}
                    onClick={() => setGoal(item.id as any)}
                  >
                    <span className="goal-icon">{item.icon}</span>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentStep === 1 && (
            <div className="wizard-step-panel">
              <h2>Choose Platforms</h2>
              <p className="muted-text mb-4">Select where you want your ads to appear. AI will automatically optimize spend between platforms.</p>
              <div className="platform-wizard-grid">
                {[
                  { id: "meta", name: "Meta Ads", sub: "Facebook & Instagram", desc: "Great for visual products, lifestyle brands, and detailed interest targeting." },
                  { id: "google", name: "Google Ads", sub: "Search & Performance Max", desc: "Best for high intent search capture and global placement." },
                  { id: "tiktok", name: "TikTok Ads", sub: "Short-form video", desc: "Highly recommended for younger audiences and viral creative content." }
                ].map(p => (
                  <div
                    key={p.id}
                    className={`platform-wizard-card ${platforms.includes(p.id as any) ? "selected" : ""}`}
                    onClick={() => togglePlatform(p.id as any)}
                  >
                    <div className="platform-header-row">
                      <span className={`network-badge network-badge-${p.id}`}>{p.name}</span>
                      <input
                        type="checkbox"
                        checked={platforms.includes(p.id as any)}
                        onChange={() => {}}
                      />
                    </div>
                    <strong>{p.sub}</strong>
                    <p>{p.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="wizard-step-panel">
              <h2>Budget & Schedule</h2>
              <p className="muted-text mb-4">Configure your daily limits and date ranges.</p>
              <div className="wizard-form">
                <label>
                  Daily Budget (USD)
                  <div className="currency-input-wrap">
                    <span className="currency-symbol">$</span>
                    <input
                      type="number"
                      value={dailyBudget}
                      onChange={(e) => setDailyBudget(e.target.value)}
                      placeholder="e.g. 50"
                      min={5}
                      required
                    />
                  </div>
                  <span className="field-hint">Minimum suggested: $10/day</span>
                </label>
                <div className="form-row-2">
                  <label>
                    Start Date
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    End Date (Optional)
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="wizard-step-panel">
              <h2>Target Audience</h2>
              <p className="muted-text mb-4">Define locations, ages, and demographics.</p>
              <div className="wizard-form">
                <label>
                  Locations
                  <div className="tags-input-row">
                    <input
                      type="text"
                      value={locationInput}
                      onChange={(e) => setLocationInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLocation())}
                      placeholder="Add country, state or city..."
                    />
                    <button type="button" className="btn btn-secondary" onClick={addLocation}>Add</button>
                  </div>
                  <div className="locations-tags-list mt-2">
                    {locations.map(loc => (
                      <span key={loc} className="audience-pill-saved">
                        {loc}
                        <button type="button" onClick={() => removeLocation(loc)}>×</button>
                      </span>
                    ))}
                  </div>
                </label>

                <div className="form-row-3">
                  <label>
                    Min Age
                    <input
                      type="number"
                      value={demographics.ageMin}
                      onChange={(e) => setDemographics({ ...demographics, ageMin: parseInt(e.target.value) || 18 })}
                      min={13}
                      max={65}
                    />
                  </label>
                  <label>
                    Max Age
                    <input
                      type="number"
                      value={demographics.ageMax}
                      onChange={(e) => setDemographics({ ...demographics, ageMax: parseInt(e.target.value) || 65 })}
                      min={18}
                      max={65}
                    />
                  </label>
                  <label>
                    Gender
                    <select
                      value={demographics.gender}
                      onChange={(e) => setDemographics({ ...demographics, gender: e.target.value })}
                    >
                      <option value="all">All</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div className="wizard-step-panel">
              <h2>Ad Creatives</h2>
              <p className="muted-text mb-4">Build your main creative variation. You can add more in the Creative Studio.</p>
              <div className="creative-wizard-grid">
                <div className="wizard-form">
                  <label>
                    Headline
                    <input
                      type="text"
                      value={headline}
                      onChange={(e) => setHeadline(e.target.value)}
                      maxLength={80}
                      required
                    />
                  </label>
                  <label>
                    Ad Text / Body
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      maxLength={300}
                      rows={4}
                      required
                    />
                  </label>
                  <label>
                    Call to Action
                    <select value={cta} onChange={(e) => setCta(e.target.value)}>
                      <option value="Learn More">Learn More</option>
                      <option value="Shop Now">Shop Now</option>
                      <option value="Sign Up">Sign Up</option>
                      <option value="Book Now">Book Now</option>
                      <option value="Start Free Trial">Start Free Trial</option>
                    </select>
                  </label>
                </div>

                <div className="ad-preview-panel">
                  <h3>Preview (Meta Style)</h3>
                  <div className="ad-preview-card-meta">
                    <div className="ad-preview-header">
                      <div className="ad-preview-avatar">📣</div>
                      <div>
                        <strong>Your Business Profile</strong>
                        <span>Sponsored</span>
                      </div>
                    </div>
                    <p className="ad-preview-body">{body}</p>
                    <div className="ad-preview-image-placeholder">
                      <span>Ad Image Preview</span>
                    </div>
                    <div className="ad-preview-footer">
                      <div>
                        <span className="ad-preview-domain">YOURWEBSITE.COM</span>
                        <strong>{headline}</strong>
                      </div>
                      <span className="btn btn-sm btn-secondary">{cta}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 5 && (
            <div className="wizard-step-panel">
              <h2>Review &amp; Launch</h2>
              <p className="muted-text mb-4">Double check your details before sending this campaign configuration to Drafts.</p>
              
              <div className="wizard-review-grid">
                <div className="review-list">
                  <div className="review-item">
                    <span>Goal:</span>
                    <strong>{goal.toUpperCase()}</strong>
                  </div>
                  <div className="review-item">
                    <span>Platforms:</span>
                    <strong>{platforms.map(p => p.toUpperCase()).join(", ")}</strong>
                  </div>
                  <div className="review-item">
                    <span>Daily Budget:</span>
                    <strong>${dailyBudget}/day</strong>
                  </div>
                  <div className="review-item">
                    <span>Schedule:</span>
                    <strong>{startDate} {endDate ? `to ${endDate}` : "(Ongoing)"}</strong>
                  </div>
                  <div className="review-item">
                    <span>Targeting:</span>
                    <strong>{locations.join(", ")}, Age {demographics.ageMin}-{demographics.ageMax}, {demographics.gender}</strong>
                  </div>
                </div>

                <div className="creative-summary-card">
                  <h4>Creative Copy</h4>
                  <p><strong>Headline:</strong> {headline}</p>
                  <p><strong>Text:</strong> {body}</p>
                  <p><strong>CTA:</strong> {cta}</p>
                </div>
              </div>
            </div>
          )}
        </Reveal>

        <div className="wizard-footer-buttons">
          <button
            className="btn btn-secondary"
            onClick={prevStep}
            disabled={currentStep === 0 || loading}
          >
            Back
          </button>
          
          {currentStep === STEPS.length - 1 ? (
            <button
              className="btn btn-primary"
              onClick={handleLaunch}
              disabled={loading || platforms.length === 0}
            >
              {loading ? "Saving Draft..." : "Save Campaign Draft"}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={nextStep}
              disabled={platforms.length === 0 && currentStep === 1}
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
