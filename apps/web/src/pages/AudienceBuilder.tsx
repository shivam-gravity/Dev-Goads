import { useState } from "react";
import Reveal from "../components/Reveal.js";

interface SavedAudience {
  id: string;
  name: string;
  reach: string;
  interests: string[];
  locations: string[];
  age: string;
}

export default function AudienceBuilder({ businessId }: { businessId: string }) {
  const [audienceName, setAudienceName] = useState("");
  
  // Demographics
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [gender, setGender] = useState("all");

  // Inclusions/Exclusions
  const [locations, setLocations] = useState<string[]>(["United States"]);
  const [locationInput, setLocationInput] = useState("");
  
  const [interests, setInterests] = useState<string[]>(["Marketing", "E-commerce"]);
  const [interestInput, setInterestInput] = useState("");

  const [exclusions, setExclusions] = useState<string[]>([]);
  const [exclusionInput, setExclusionInput] = useState("");

  // Lookalikes
  const [lookalikeSource, setLookalikeSource] = useState("");
  const [lookalikePercentage, setLookalikePercentage] = useState("1");

  // Saved segments
  const [savedAudiences, setSavedAudiences] = useState<SavedAudience[]>([]);

  function addLocation() {
    if (locationInput.trim() && !locations.includes(locationInput.trim())) {
      setLocations([...locations, locationInput.trim()]);
      setLocationInput("");
    }
  }

  function addInterest() {
    if (interestInput.trim() && !interests.includes(interestInput.trim())) {
      setInterests([...interests, interestInput.trim()]);
      setInterestInput("");
    }
  }

  function addExclusion() {
    if (exclusionInput.trim() && !exclusions.includes(exclusionInput.trim())) {
      setExclusions([...exclusions, exclusionInput.trim()]);
      setExclusionInput("");
    }
  }

  function handleSaveAudience() {
    if (!audienceName.trim()) {
      alert("Please name your audience segment.");
      return;
    }
    const newAud: SavedAudience = {
      id: Math.random().toString(36).substring(7),
      name: audienceName,
      reach: `${(Math.floor(Math.random() * 8) + 1).toFixed(1)}M - ${(Math.floor(Math.random() * 12) + 9).toFixed(1)}M`,
      interests,
      locations,
      age: `${ageMin}-${ageMax === 65 ? "65+" : ageMax}`
    };
    setSavedAudiences([...savedAudiences, newAud]);
    setAudienceName("");
    alert("Audience saved successfully!");
  }

  // Calculate reach estimation meter
  const interestScore = interests.length * 1.5;
  const locationScore = locations.length * 3;
  const rawReach = Math.max(1, 20 - interestScore - locationScore);
  const reachPercentage = Math.min(100, Math.max(10, rawReach * 5));

  return (
    <div className="audience-builder">
      <div className="page-header">
        <div>
          <h1>Audience Builder</h1>
          <p className="subtitle">Design specific segments and generate lookalike targets for your campaigns.</p>
        </div>
      </div>

      <div className="audience-builder-layout">
        {/* Left Side: Setup Forms */}
        <div className="audience-setup flex-col gap-4">
          <section className="card">
            <h2>Demographics</h2>
            <div className="wizard-form mt-3">
              <label>
                Audience Segment Name
                <input
                  type="text"
                  value={audienceName}
                  onChange={(e) => setAudienceName(e.target.value)}
                  placeholder="e.g. US Tech Marketers 25-45"
                />
              </label>

              <div className="form-row-3">
                <label>
                  Min Age
                  <input
                    type="number"
                    value={ageMin}
                    onChange={(e) => setAgeMin(parseInt(e.target.value) || 18)}
                    min={13}
                    max={65}
                  />
                </label>
                <label>
                  Max Age
                  <input
                    type="number"
                    value={ageMax}
                    onChange={(e) => setAgeMax(parseInt(e.target.value) || 65)}
                    min={18}
                    max={65}
                  />
                </label>
                <label>
                  Gender
                  <select value={gender} onChange={(e) => setGender(e.target.value)}>
                    <option value="all">All</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </label>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>Detailed Targeting</h2>
            <div className="wizard-form mt-3">
              {/* Locations */}
              <label>
                Target Locations
                <div className="tags-input-row">
                  <input
                    type="text"
                    value={locationInput}
                    onChange={(e) => setLocationInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLocation())}
                    placeholder="e.g. United States, France"
                  />
                  <button type="button" className="btn btn-secondary" onClick={addLocation}>Add</button>
                </div>
                <div className="audience-pills-row mt-2">
                  {locations.map((loc) => (
                    <span key={loc} className="audience-pill-saved">
                      {loc}
                      <button type="button" onClick={() => setLocations(locations.filter(x => x !== loc))}>×</button>
                    </span>
                  ))}
                </div>
              </label>

              {/* Interests */}
              <label>
                Include Interests / Demographics
                <div className="tags-input-row">
                  <input
                    type="text"
                    value={interestInput}
                    onChange={(e) => setInterestInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addInterest())}
                    placeholder="e.g. Advertising, Marketing, Retail"
                  />
                  <button type="button" className="btn btn-secondary" onClick={addInterest}>Add</button>
                </div>
                <div className="audience-pills-row mt-2">
                  {interests.map((int) => (
                    <span key={int} className="audience-pill-saved">
                      {int}
                      <button type="button" onClick={() => setInterests(interests.filter(x => x !== int))}>×</button>
                    </span>
                  ))}
                </div>
              </label>

              {/* Exclusions */}
              <label>
                Exclude Interests / Behaviors
                <div className="tags-input-row">
                  <input
                    type="text"
                    value={exclusionInput}
                    onChange={(e) => setExclusionInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExclusion())}
                    placeholder="e.g. Competitors, Existing Customers"
                  />
                  <button type="button" className="btn btn-secondary" onClick={addExclusion}>Exclude</button>
                </div>
                <div className="audience-pills-row mt-2">
                  {exclusions.map((ex) => (
                    <span key={ex} className="audience-pill-saved">
                      {ex}
                      <button type="button" onClick={() => setExclusions(exclusions.filter(x => x !== ex))}>×</button>
                    </span>
                  ))}
                </div>
              </label>
            </div>
          </section>

          <section className="card">
            <h2>Lookalike Audiences</h2>
            <div className="wizard-form mt-3">
              <label>
                Source Custom Audience
                <select value={lookalikeSource} onChange={(e) => setLookalikeSource(e.target.value)}>
                  <option value="">Select source custom segment...</option>
                  <option value="purchasers">All Website Purchasers (Last 180 Days)</option>
                  <option value="visitors">All Website Visitors (Last 30 Days)</option>
                  <option value="leads">Captured Lead Leads Form (All Time)</option>
                </select>
              </label>

              {lookalikeSource && (
                <label className="mt-3">
                  Lookalike Percentage: {lookalikePercentage}%
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={lookalikePercentage}
                    onChange={(e) => setLookalikePercentage(e.target.value)}
                    className="calculator-slider"
                  />
                  <span className="field-hint">Smaller percentage focuses on maximum similarity. Larger focuses on maximum reach.</span>
                </label>
              )}
            </div>
          </section>
        </div>

        {/* Right Side: Estimated Reach & Saved Library */}
        <div className="audience-insights flex-col gap-4">
          <section className="card reach-estimation-card">
            <h2>Estimated Audience Size</h2>
            
            <div className="reach-gauge mt-4">
              <div className="reach-gauge-bar" style={{ width: `${reachPercentage}%` }} />
              <div className="reach-labels">
                <span>Specific</span>
                <span>Broad</span>
              </div>
            </div>

            <div className="reach-metrics mt-4">
              <div className="reach-metric-row">
                <span>Total Est. Reach:</span>
                <strong>{(rawReach * 0.9).toFixed(1)}M - {(rawReach * 1.5).toFixed(1)}M people</strong>
              </div>
              <div className="reach-metric-row">
                <span>Targeting Accuracy:</span>
                <span className="live-dot" style={{ background: reachPercentage > 30 && reachPercentage < 75 ? "var(--accent-2)" : "var(--danger)" }}>
                  {reachPercentage > 30 && reachPercentage < 75 ? " Balanced" : " Broad/Narrow"}
                </span>
              </div>
            </div>

            <button className="btn btn-primary btn-full mt-4" onClick={handleSaveAudience}>
              Save Target Segment
            </button>
          </section>

          {/* Saved Audience Library */}
          <section className="card">
            <h2>Audience Segments Library</h2>
            {savedAudiences.length === 0 ? (
              <p className="muted-text mt-3">No custom saved segments yet. Set one up above and click Save.</p>
            ) : (
              <Reveal>
                <div className="saved-audiences-list mt-3">
                  {savedAudiences.map((aud) => (
                    <div key={aud.id} className="audience-library-item">
                      <div className="audience-lib-header">
                        <strong>{aud.name}</strong>
                        <span>{aud.reach} reach</span>
                      </div>
                      <div className="audience-lib-details mt-2">
                        <p><strong>Locations:</strong> {aud.locations.join(", ")}</p>
                        <p><strong>Interests:</strong> {aud.interests.join(", ")}</p>
                        <p><strong>Age:</strong> {aud.age}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Reveal>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
