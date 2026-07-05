import { useState } from "react";
import { api, CreativeVariation } from "../api/client.js";
import Reveal from "../components/Reveal.js";

const TEMPLATES = [
  { id: "meta-feed", name: "Meta Feed Ad", platform: "meta", format: "1:1 Square" },
  { id: "meta-story", name: "Meta Story Ad", platform: "meta", format: "9:16 Vertical" },
  { id: "google-search", name: "Google Text Ad", platform: "google", format: "Text-Only" },
  { id: "tiktok-video", name: "TikTok Video Ad", platform: "tiktok", format: "9:16 Video" }
];

export default function CreativeStudio({ businessId }: { businessId: string }) {
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [cta, setCta] = useState("Learn More");
  
  // AI Variation states
  const [variations, setVariations] = useState<CreativeVariation[]>([]);
  const [generating, setGenerating] = useState(false);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageUrl, setImageUrl] = useState("https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=800&q=80");
  const [error, setError] = useState<string | null>(null);
  const [activeTemplate, setActiveTemplate] = useState("meta-feed");

  async function handleGenerateCopy() {
    if (!headline || !body) {
      setError("Please input initial headline and body to create variations.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const vars = await api.generateCreativeVariations({ headline, body, callToAction: cta });
      setVariations(vars);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate variations");
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateImage() {
    setImageGenerating(true);
    setError(null);
    try {
      // Simulate AI generation delay
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      const pool = [
        "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&q=80",
        "https://images.unsplash.com/photo-1542744094-3a31f103e35f?w=800&q=80",
        "https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&q=80",
        "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80"
      ];
      const randomImage = pool[Math.floor(Math.random() * pool.length)];
      setImageUrl(randomImage);

      // Save generated image as asset in library
      const wsId = localStorage.getItem("adgo_workspace_id") ?? "demo";
      await api.createAsset(wsId, {
        name: `AI Generated Ad Creative - ${Date.now()}`,
        type: "image",
        url: randomImage,
        thumbnailUrl: randomImage,
        size: 145000,
        mimeType: "image/jpeg",
        tags: ["ai-generated", "creative-studio"]
      });
    } catch (err) {
      setError("Failed to generate AI image. Please try again.");
    } finally {
      setImageGenerating(false);
    }
  }

  async function handleSaveVariation(v: CreativeVariation) {
    setError(null);
    try {
      await api.createCreative(businessId, {
        headline: v.headline,
        body: v.body,
        callToAction: v.callToAction,
        format: "image",
        tags: ["ai-generated", v.angle]
      });
      alert("Creative saved to library!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save creative");
    }
  }

  const selectedTemplateObj = TEMPLATES.find(t => t.id === activeTemplate) || TEMPLATES[0];

  return (
    <div className="creative-studio">
      <div className="page-header">
        <div>
          <h1>AI Creative Studio</h1>
          <p className="subtitle">Craft, iterate, and preview high-performance ad copy and visuals using AI.</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="creative-studio-layout">
        {/* Left Control Panel */}
        <div className="studio-controls flex-col gap-4">
          <section className="card">
            <h2>1. Base Creative</h2>
            <div className="wizard-form mt-3">
              <label>
                Headline / Hook
                <input
                  type="text"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="e.g. Scale your startup faster"
                  maxLength={100}
                />
              </label>
              <label>
                Ad Body Text
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="e.g. Try our automatic budgeting tool..."
                  maxLength={500}
                  rows={3}
                />
              </label>
              <label>
                Call to Action
                <select value={cta} onChange={(e) => setCta(e.target.value)}>
                  <option value="Learn More">Learn More</option>
                  <option value="Shop Now">Shop Now</option>
                  <option value="Sign Up">Sign Up</option>
                  <option value="Get Quote">Get Quote</option>
                </select>
              </label>

              <div className="button-group-row mt-3">
                <button
                  className="btn btn-secondary flex-1"
                  onClick={handleGenerateCopy}
                  disabled={generating}
                >
                  {generating ? "Generating..." : "✨ AI Copy Variations"}
                </button>
                <button
                  className="btn btn-secondary flex-1"
                  onClick={handleGenerateImage}
                  disabled={imageGenerating}
                >
                  {imageGenerating ? "Generating..." : "🖼️ AI Image Generator"}
                </button>
              </div>
            </div>
          </section>

          {/* AI Variations Panel */}
          {variations.length > 0 && (
            <Reveal>
              <section className="card">
                <h2>AI Variations</h2>
                <div className="studio-variations-list mt-3">
                  {variations.map((v, i) => (
                    <div key={i} className="variation-item-inline">
                      <span className="badge-small">{v.angle}</span>
                      <h4>{v.headline}</h4>
                      <p>{v.body}</p>
                      <div className="button-group-row justify-between mt-2">
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => {
                            setHeadline(v.headline);
                            setBody(v.body);
                            setCta(v.callToAction);
                          }}
                        >
                          Use for Preview
                        </button>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => handleSaveVariation(v)}
                        >
                          Save to Library
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </Reveal>
          )}
        </div>

        {/* Right Preview Panel */}
        <div className="studio-preview-panel">
          <section className="card">
            <div className="card-header">
              <h2>2. Live Ad Preview</h2>
              <div className="template-picker-row">
                {TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    className={`btn btn-sm ${activeTemplate === t.id ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setActiveTemplate(t.id)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="ad-preview-container-box mt-4">
              {selectedTemplateObj.platform === "meta" && (
                <div className={`ad-preview-card-meta ${activeTemplate === "meta-story" ? "meta-story-format" : ""}`}>
                  <div className="ad-preview-header">
                    <div className="ad-preview-avatar">✨</div>
                    <div>
                      <strong>AdGo Creative</strong>
                      <span>Sponsored • Instagram &amp; Facebook</span>
                    </div>
                  </div>
                  <p className="ad-preview-body">{body || "Ad copy body text goes here..."}</p>
                  
                  <div className="ad-preview-media">
                    {imageGenerating ? (
                      <div className="image-loading-skeleton">
                        <div className="onboarding-spinner" />
                        <span>Generating custom asset...</span>
                      </div>
                    ) : (
                      <img src={imageUrl} alt="Ad Visual" />
                    )}
                  </div>

                  <div className="ad-preview-footer">
                    <div>
                      <span className="ad-preview-domain">WWW.ADGO.IO</span>
                      <strong>{headline || "Ad headline goes here..."}</strong>
                    </div>
                    <span className="btn btn-sm btn-secondary">{cta}</span>
                  </div>
                </div>
              )}

              {selectedTemplateObj.platform === "google" && (
                <div className="ad-preview-card-google">
                  <div className="google-ad-badge">Ad</div>
                  <span className="google-url">https://www.adgo.io</span>
                  <h3 className="google-headline">
                    {headline || "Ad Headline Goes Here"} | Maximize Your Growth
                  </h3>
                  <p className="google-description">
                    {body || "This is a mockup description text of your search campaign. Highly optimized keywords will deliver direct clicks."}
                  </p>
                </div>
              )}

              {selectedTemplateObj.platform === "tiktok" && (
                <div className="ad-preview-card-tiktok">
                  <div className="tiktok-video-mock">
                    <img src={imageUrl} alt="TikTok Background Mock" className="tiktok-video-bg" />
                    <div className="tiktok-overlay">
                      <div className="tiktok-user-info">
                        <strong>@adgo_studio</strong>
                        <p>{body || "Short body copy fits best for video ad overlays."}</p>
                      </div>
                      <div className="tiktok-cta-bar">
                        <span>{headline || "Headline"}</span>
                        <button className="btn btn-sm btn-primary">{cta}</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
