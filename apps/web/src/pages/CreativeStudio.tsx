import { useState } from "react";
import { SparkleIcon } from "../components/icons.js";
import AdsGoHeader from "../components/AdsGoHeader.js";

const SELECT_TYPES = [
  { value: "upload", label: "User upload" },
  { value: "product-url", label: "Product URL" },
  { value: "text-prompt", label: "Text prompt" },
];

const IMAGE_POOL = [
  "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80",
  "https://images.unsplash.com/photo-1542744094-3a31f103e35f?w=800&q=80",
  "https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&q=80",
  "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80",
  "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=800&q=80",
];

function RegenerateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

interface GeneratedResult {
  id: string;
  imageUrl: string;
  ratio: string;
  createdAt: number;
  regenerating: boolean;
}

function randomImage() {
  return IMAGE_POOL[Math.floor(Math.random() * IMAGE_POOL.length)];
}

function formatTimestamp(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CreativeStudio({ businessId }: { businessId: string }) {
  const [selectType, setSelectType] = useState(SELECT_TYPES[0].value);
  const [productUrl, setProductUrl] = useState("");
  const [fetchingImages, setFetchingImages] = useState(false);
  const [fetchedCount, setFetchedCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [freeImagesLeft, setFreeImagesLeft] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedResult[]>([]);

  async function handleFetchImages() {
    if (!productUrl.trim()) return;
    setError(null);
    setFetchingImages(true);
    setFetchedCount(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 900));
      setFetchedCount(Math.floor(Math.random() * 3) + 2);
    } finally {
      setFetchingImages(false);
    }
  }

  async function handleSubmit() {
    if (!productUrl.trim()) {
      setError("Please enter a product URL to continue.");
      return;
    }
    if (freeImagesLeft <= 0) {
      setError("You've used all your free images.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const next: GeneratedResult = {
        id: `${Date.now()}`,
        imageUrl: randomImage(),
        ratio: "1:1 (1024*1024)",
        createdAt: Date.now(),
        regenerating: false,
      };
      setResults((prev) => [next, ...prev]);
      setFreeImagesLeft((prev) => Math.max(0, prev - 1));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegenerate(id: string) {
    if (freeImagesLeft <= 0) {
      setError("You've used all your free images.");
      return;
    }
    setError(null);
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, regenerating: true } : r)));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    setResults((prev) =>
      prev.map((r) => (r.id === id ? { ...r, imageUrl: randomImage(), regenerating: false, createdAt: Date.now() } : r))
    );
    setFreeImagesLeft((prev) => Math.max(0, prev - 1));
  }

  return (
    <div className="ai-generate-page" data-business-id={businessId}>
      <AdsGoHeader breadcrumb={["Creative Hub", "AI Generate"]} />

      <div className="ai-generate-toolbar">
        <span className="ai-generate-free-badge">
          Free <strong>{freeImagesLeft}</strong> images
          <span className="ai-generate-info-icon" title="Every generation or regeneration uses one free image credit.">?</span>
        </span>
        <a className="how-to-use-link" href="#" onClick={(e) => e.preventDefault()}>
          <span className="how-to-use-icon" aria-hidden="true">📖</span>
          How to use?
        </a>
      </div>

      <div className="ai-generate-layout">
        <section className="ai-generate-form gen-card">
          <label className="ai-generate-field">
            <span className="ai-generate-field-label">Select Type</span>
            <select
              className="ai-generate-select"
              value={selectType}
              onChange={(e) => setSelectType(e.target.value)}
            >
              {SELECT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          <label className="ai-generate-field">
            <span className="ai-generate-field-label">
              <span className="adsgo-required">*</span> Product URL
              <span className="ai-generate-info-icon" title="Paste a link to the product page you want to advertise.">i</span>
            </span>
            <div className="ai-generate-url-row">
              <input
                type="text"
                className="ai-generate-url-input"
                placeholder="Please enter product URL"
                value={productUrl}
                onChange={(e) => { setProductUrl(e.target.value); setFetchedCount(null); }}
              />
              <button
                type="button"
                className="btn btn-secondary ai-generate-fetch-btn"
                onClick={handleFetchImages}
                disabled={!productUrl.trim() || fetchingImages}
              >
                {fetchingImages ? "Fetching…" : "Fetch Images"}
              </button>
            </div>
            {fetchedCount !== null && (
              <span className="ai-generate-fetch-note">Found {fetchedCount} images on this page.</span>
            )}
          </label>

          {error && <p className="error">{error}</p>}

          <button
            type="button"
            className="btn btn-primary ai-generate-submit-btn"
            onClick={handleSubmit}
            disabled={submitting || freeImagesLeft <= 0}
          >
            {submitting ? "Generating…" : freeImagesLeft <= 0 ? "No free images left" : "Submit Now"}
          </button>
        </section>

        <div className="ai-generate-results-feed">
          {results.length === 0 && (
            <div className="ai-generate-empty empty-state">
              <span className="empty-icon" aria-hidden="true">✨</span>
              <p>Your AI-generated creatives will show up here after you submit a product URL.</p>
            </div>
          )}

          {results.map((r) => (
            <section key={r.id} className="ai-generate-result-card gen-card">
              <div className="ai-generate-result-header">
                <span className="ai-generate-result-avatar" aria-hidden="true">
                  <SparkleIcon />
                </span>
                <div className="ai-generate-result-meta">
                  <strong>AdsGo Creative Expert</strong>
                  <span>{r.ratio}</span>
                </div>
                <span className="ai-generate-result-timestamp">{formatTimestamp(r.createdAt)}</span>
              </div>

              <div className="ai-generate-result-image-wrap">
                {r.regenerating ? (
                  <div className="image-loading-skeleton">
                    <div className="onboarding-spinner" />
                    <span>Generating custom asset…</span>
                  </div>
                ) : (
                  <img src={r.imageUrl} alt="AI generated creative" />
                )}
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-sm ai-generate-regenerate-btn"
                onClick={() => handleRegenerate(r.id)}
                disabled={r.regenerating}
              >
                <RegenerateIcon />
                Regenerate
              </button>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
