import { useEffect, useState } from "react";
import { api, AudienceSuggestion } from "../api/client.js";
import Reveal from "../components/Reveal.js";

const INTENT_COLORS: Record<string, string> = {
  high: "var(--accent-2)",
  medium: "var(--accent)",
  low: "var(--muted)",
};

const INTENT_LABELS: Record<string, string> = {
  high: "High Intent",
  medium: "Medium Intent",
  low: "Low Intent",
};

export default function Audiences({ businessId }: { businessId: string }) {
  const [suggestions, setSuggestions] = useState<AudienceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAudiences, setSavedAudiences] = useState<AudienceSuggestion[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`audiences-${businessId}`) ?? "[]");
    } catch {
      return [];
    }
  });

  async function fetchSuggestions() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getAudienceSuggestions(businessId);
      setSuggestions(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch suggestions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSuggestions();
  }, [businessId]);

  function handleSave(audience: AudienceSuggestion) {
    const updated = savedAudiences.some((a) => a.name === audience.name)
      ? savedAudiences.filter((a) => a.name !== audience.name)
      : [...savedAudiences, audience];
    setSavedAudiences(updated);
    localStorage.setItem(`audiences-${businessId}`, JSON.stringify(updated));
  }

  function isSaved(audience: AudienceSuggestion) {
    return savedAudiences.some((a) => a.name === audience.name);
  }

  return (
    <div className="page-audiences">
      <div className="page-header">
        <div>
          <h1>Audience Tools</h1>
          <p className="subtitle">AI-generated audience segments tailored to your business profile.</p>
        </div>
        <button className="btn btn-primary" onClick={fetchSuggestions} disabled={loading}>
          {loading ? "Generating…" : "↻ Regenerate"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {savedAudiences.length > 0 && (
        <section className="card audiences-saved-section">
          <h2>📌 Saved Audiences ({savedAudiences.length})</h2>
          <div className="audience-pills-row">
            {savedAudiences.map((a) => (
              <div key={a.name} className="audience-pill-saved">
                <span>{a.name}</span>
                <button
                  className="audience-pill-remove"
                  onClick={() => handleSave(a)}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading ? (
        <div className="audiences-loading">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="audience-card-skeleton" />
          ))}
        </div>
      ) : (
        <Reveal>
          <div className="audience-grid">
            {suggestions.map((aud) => (
              <div key={aud.name} className="audience-card">
                <div className="audience-card-header">
                  <div>
                    <h3 className="audience-name">{aud.name}</h3>
                    <span
                      className="audience-intent-badge"
                      style={{ background: INTENT_COLORS[aud.buyingIntent] + "22", color: INTENT_COLORS[aud.buyingIntent] }}
                    >
                      {INTENT_LABELS[aud.buyingIntent]}
                    </span>
                  </div>
                  <button
                    className={`btn btn-sm ${isSaved(aud) ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => handleSave(aud)}
                  >
                    {isSaved(aud) ? "✓ Saved" : "Save"}
                  </button>
                </div>

                <p className="audience-description">{aud.description}</p>

                <div className="audience-meta-row">
                  <div className="audience-meta-item">
                    <span className="audience-meta-label">Reach</span>
                    <span className="audience-meta-value">{aud.estimatedReach}</span>
                  </div>
                  <div className="audience-meta-item">
                    <span className="audience-meta-label">Demographics</span>
                    <span className="audience-meta-value">{aud.demographics}</span>
                  </div>
                </div>

                <div className="audience-platforms">
                  {aud.platforms.map((p) => (
                    <span key={p} className={`network-badge network-badge-${p}`}>
                      {p === "meta" ? "Meta" : "Google"}
                    </span>
                  ))}
                </div>

                {aud.interests.length > 0 && (
                  <div className="audience-tags-row">
                    <span className="audience-meta-label">Interests</span>
                    <div className="audience-tags">
                      {aud.interests.map((interest) => (
                        <span key={interest} className="audience-tag">{interest}</span>
                      ))}
                    </div>
                  </div>
                )}

                {aud.painPoints.length > 0 && (
                  <div className="audience-pain-points">
                    <span className="audience-meta-label">Pain Points</span>
                    <ul>
                      {aud.painPoints.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Reveal>
      )}
    </div>
  );
}
