import { useState } from "react";
import PolluxaHeader from "../components/PolluxaHeader.js";
import { api, ProductAnalysis } from "../api/client.js";
import { SparkleIcon, ClockIcon, GlobeIcon, CloseIcon } from "../components/icons.js";

export default function BrandProfile() {
  const [modalOpen, setModalOpen] = useState(true);
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProductAnalysis | null>(null);

  async function handleStartAnalysis() {
    if (!url.trim()) return;
    setError(null);
    setAnalyzing(true);
    try {
      const site = await api.scrapeWebsite(url.trim());
      const analysis = await api.analyzeProduct(site);
      setProfile(analysis);
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't analyze that URL");
    } finally {
      setAnalyzing(false);
    }
  }

  function closeModal() {
    if (analyzing) return;
    setModalOpen(false);
    setError(null);
  }

  return (
    <div className={`page-brand-profile ${modalOpen ? "polluxa-modal-dimmed" : ""}`}>
      <PolluxaHeader breadcrumb={["Brand Center", "Brand Profile"]} />

      {profile ? (
        <section className="card">
          <div className="card-header">
            <h2>{profile.productName}</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModalOpen(true)}>
              Re-analyze
            </button>
          </div>
          <p className="muted-text">{profile.category}</p>
          <p>{profile.summary}</p>
          <p><strong>Value proposition:</strong> {profile.valueProposition}</p>
          {profile.keyFeatures?.length > 0 && (
            <ul className="brand-profile-features">
              {profile.keyFeatures.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
        </section>
      ) : (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">💎</span>
          <p>No brand profile yet. Start an AI analysis to build one from your website.</p>
        </div>
      )}

      {modalOpen && (
        <div className="polluxa-modal-overlay" onClick={closeModal}>
          <div className="polluxa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="polluxa-modal-header">
              <span className="polluxa-modal-icon"><SparkleIcon /></span>
              <h2>Create Brand Profile</h2>
              <button type="button" className="polluxa-modal-close" onClick={closeModal} aria-label="Close">
                <CloseIcon />
              </button>
            </div>

            <div className="polluxa-modal-info-banner">
              <ClockIcon />
              <span>2-3 min for AI to complete brand profile analysis</span>
            </div>

            {error && <p className="error">{error}</p>}

            <label className="polluxa-modal-field">
              <span><GlobeIcon /> Brand Url</span>
              <input
                type="text"
                placeholder="e.g. https://www.yourbrand.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStartAnalysis()}
                autoFocus
              />
            </label>

            <button
              type="button"
              className="btn btn-primary polluxa-modal-submit"
              onClick={handleStartAnalysis}
              disabled={analyzing || !url.trim()}
            >
              <SparkleIcon /> {analyzing ? "Analyzing…" : "Start Analysis"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
