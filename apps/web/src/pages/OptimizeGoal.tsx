import { useState } from "react";
import AdsGoHeader from "../components/AdsGoHeader.js";
import {
  PinIcon,
  PlusIcon,
  InboxIcon,
  CloseIcon,
  LinkIcon,
  PencilIcon,
  MetaInfinityIcon,
  GoogleIcon,
  TikTokIcon,
  BingIcon,
} from "../components/icons.js";

const PLATFORMS = [
  { id: "meta", label: "Meta", icon: <MetaInfinityIcon /> },
  { id: "google", label: "Google", icon: <GoogleIcon /> },
  { id: "tiktok", label: "TikTok", icon: <TikTokIcon /> },
  { id: "bing", label: "Bing", icon: <BingIcon /> },
];

const KPI_OPTIONS = ["Lowest CPA", "Highest ROAS", "Most Conversions", "Most Clicks"];

export default function OptimizeGoal() {
  const [locations, setLocations] = useState<string[]>([]);
  const [locationInput, setLocationInput] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [kpi, setKpi] = useState(KPI_OPTIONS[0]);

  const [selectedPlatform, setSelectedPlatform] = useState(PLATFORMS[0].id);
  const [connectedPlatforms, setConnectedPlatforms] = useState<Record<string, boolean>>({});
  const [connecting, setConnecting] = useState(false);

  const [skills, setSkills] = useState("");
  const [skillsDraft, setSkillsDraft] = useState("");
  const [editingSkills, setEditingSkills] = useState(false);

  function addLocation() {
    const value = locationInput.trim();
    if (!value || locations.includes(value)) return;
    setLocations((prev) => [...prev, value]);
    setLocationInput("");
  }

  function removeLocation(loc: string) {
    setLocations((prev) => prev.filter((l) => l !== loc));
  }

  async function handleConnectPlatform() {
    setConnecting(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    setConnectedPlatforms((prev) => ({ ...prev, [selectedPlatform]: true }));
    setConnecting(false);
  }

  function startEditingSkills() {
    setSkillsDraft(skills);
    setEditingSkills(true);
  }

  function saveSkills() {
    setSkills(skillsDraft.trim());
    setEditingSkills(false);
  }

  const strategiesCount = locations.length > 0 ? 1 : 0;
  const isPlatformConnected = connectedPlatforms[selectedPlatform];

  return (
    <div className="page-optimize-goal">
      <AdsGoHeader breadcrumb={["Brand Center", "Optimize Goal"]} />

      <div className="optimize-goal-layout">
        <section className="gen-card optimize-goal-overview">
          <h2>Strategy Overview</h2>
          <p className="muted-text">{strategiesCount} Strategies</p>

          <div className="optimize-goal-illustration">
            <PinIcon />
          </div>

          <a className="optimize-goal-step-link" href="#optimize-goal-strategy">
            Start 1: Add target locations →
          </a>
          <p className="optimize-goal-step-desc">Start by selecting locations to activate this strategy.</p>

          <div className="optimize-goal-divider" />

          <div className="optimize-goal-info-box">
            <span aria-hidden="true">ℹ️</span>
            <div>
              <strong>Why need strategy?</strong>
              <p>Set budget, scope and rules to optimize performance with AI.</p>
            </div>
          </div>
        </section>

        <div>
          <section className="gen-card" id="optimize-goal-strategy">
            <h2>Budget &amp; Performance KPI <span className="adsgo-required">*</span></h2>
            <p className="optimize-goal-section-desc">Define the core logic and positioning to guide AI content depth.</p>

            <div className="optimize-goal-kpi-row">
              <div className="optimize-goal-box">
                <div className="optimize-goal-box-header">
                  <h3>Strategy 1</h3>
                  <button type="button" className="optimize-goal-add-strategy" aria-label="Add strategy">
                    <PlusIcon />
                  </button>
                </div>

                <div className="optimize-goal-location-search">
                  <PinIcon />
                  <input
                    type="text"
                    placeholder="You can type in specific countries, state/regions, ..."
                    value={locationInput}
                    onChange={(e) => setLocationInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addLocation()}
                  />
                </div>

                {locations.length === 0 ? (
                  <div className="optimize-goal-box-empty">
                    <InboxIcon />
                    <span>No location added</span>
                  </div>
                ) : (
                  <div className="optimize-goal-location-tags">
                    {locations.map((loc) => (
                      <span key={loc} className="optimize-goal-location-tag">
                        {loc}
                        <button type="button" onClick={() => removeLocation(loc)} aria-label={`Remove ${loc}`}>
                          <CloseIcon />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="optimize-goal-box">
                {locations.length === 0 ? (
                  <div className="optimize-goal-box-empty">
                    <span aria-hidden="true" style={{ fontSize: 32 }}>🌐</span>
                    <span>Please select target locations on the left to configure budgets and KPI goals for this strategy</span>
                  </div>
                ) : (
                  <div className="optimize-goal-budget-form">
                    <label>
                      Daily Budget (USD)
                      <input
                        type="number"
                        min="0"
                        placeholder="e.g. 50"
                        value={dailyBudget}
                        onChange={(e) => setDailyBudget(e.target.value)}
                      />
                    </label>
                    <label>
                      Primary KPI
                      <select value={kpi} onChange={(e) => setKpi(e.target.value)}>
                        {KPI_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="gen-card">
            <h2>Ad Scope(Assigned account)</h2>
            <p className="optimize-goal-section-desc">Define the core logic and positioning to guide AI content depth.</p>

            <div className="optimize-goal-platform-tabs">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`optimize-goal-platform-tab ${selectedPlatform === p.id ? "active" : ""}`}
                  onClick={() => setSelectedPlatform(p.id)}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>

            <div className="optimize-goal-connect-row">
              <button
                type="button"
                className="optimize-goal-connect-btn"
                onClick={handleConnectPlatform}
                disabled={connecting || isPlatformConnected}
              >
                <LinkIcon />
                {isPlatformConnected ? "Connected" : connecting ? "Connecting…" : "Connect Ad Platform"}
              </button>
            </div>
          </section>

          <section className="gen-card">
            <div className="optimize-goal-skills-header">
              <div>
                <h2>Optimize Skills</h2>
                <p className="optimize-goal-section-desc">Define the core logic and positioning to guide AI content depth.</p>
              </div>
              {!editingSkills && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={startEditingSkills}>
                  <PencilIcon /> Edit
                </button>
              )}
            </div>

            {editingSkills ? (
              <>
                <textarea
                  className="optimize-goal-skills-textarea"
                  value={skillsDraft}
                  onChange={(e) => setSkillsDraft(e.target.value)}
                  placeholder="Describe how AI should prioritize budget, bidding, and creative decisions..."
                  autoFocus
                />
                <div className="button-group-row justify-between mt-3">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingSkills(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={saveSkills}>
                    Save
                  </button>
                </div>
              </>
            ) : (
              <div className={`optimize-goal-skills-box ${skills ? "has-content" : ""}`}>
                {skills || "No optimization skill configured yet."}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
