import { FormEvent, useEffect, useState } from "react";
import { api, CreativeAsset, CreativeVariation } from "../api/client.js";
import Reveal from "../components/Reveal.js";

export default function Creatives({ businessId }: { businessId: string }) {
  const [creatives, setCreatives] = useState<CreativeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [cta, setCta] = useState("Get Started");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Variation generator
  const [variationSource, setVariationSource] = useState<CreativeAsset | null>(null);
  const [variations, setVariations] = useState<CreativeVariation[]>([]);
  const [generatingVariations, setGeneratingVariations] = useState(false);

  // Deleting
  const [deleting, setDeleting] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const data = await api.listCreatives(businessId);
      setCreatives(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load creatives");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [businessId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createCreative(businessId, {
        headline,
        body,
        callToAction: cta,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      setHeadline("");
      setBody("");
      setCta("Get Started");
      setTags("");
      setShowCreate(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create creative");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await api.deleteCreative(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  async function handleGenerateVariations(creative: CreativeAsset) {
    setVariationSource(creative);
    setVariations([]);
    setGeneratingVariations(true);
    setError(null);
    try {
      const vars = await api.generateCreativeVariations({
        headline: creative.headline,
        body: creative.body,
        callToAction: creative.callToAction,
      });
      setVariations(vars);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Variation generation failed");
    } finally {
      setGeneratingVariations(false);
    }
  }

  async function handleSaveVariation(v: CreativeVariation) {
    try {
      await api.createCreative(businessId, {
        headline: v.headline,
        body: v.body,
        callToAction: v.callToAction,
        tags: [v.angle, "ai-generated"],
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save variation");
    }
  }

  return (
    <div className="page-creatives">
      <div className="page-header">
        <div>
          <h1>Creative Management</h1>
          <p className="subtitle">Build, manage, and generate AI variations of your ad creatives.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "+ New Creative"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {/* Create form */}
      {showCreate && (
        <section className="card creative-create-card">
          <h2>New Creative</h2>
          <form onSubmit={handleCreate} className="creative-form">
            <label>
              Headline
              <input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Stop losing leads to bad ads"
                maxLength={100}
                required
              />
              <span className="field-hint">{headline.length}/100</span>
            </label>
            <label>
              Body Copy
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe your offer compellingly…"
                rows={3}
                maxLength={500}
                required
              />
              <span className="field-hint">{body.length}/500</span>
            </label>
            <label>
              Call to Action
              <input
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="Get Started"
                maxLength={50}
                required
              />
            </label>
            <label>
              Tags (comma separated)
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="e.g. seasonal, product-launch"
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save Creative"}
            </button>
          </form>
        </section>
      )}

      {/* Variation panel */}
      {variationSource && (
        <section className="card variations-panel">
          <div className="variations-panel-header">
            <h2>AI Variations of "{variationSource.headline}"</h2>
            <button className="btn btn-sm btn-secondary" onClick={() => { setVariationSource(null); setVariations([]); }}>
              Close
            </button>
          </div>
          {generatingVariations ? (
            <div className="variations-loading">
              <div className="onboarding-spinner" />
              <p>Generating creative angles with AI…</p>
            </div>
          ) : (
            <div className="variations-grid">
              {variations.map((v, i) => (
                <div key={i} className="variation-card">
                  <span className="variation-angle-badge">{v.angle}</span>
                  <strong className="variation-headline">{v.headline}</strong>
                  <p className="variation-body">{v.body}</p>
                  <span className="pill">{v.callToAction}</span>
                  <button className="btn btn-sm btn-secondary" onClick={() => handleSaveVariation(v)}>
                    Save to Library
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Creative library */}
      {loading ? (
        <div className="creatives-loading">
          {[1, 2, 3].map((i) => (
            <div key={i} className="creative-asset-skeleton" />
          ))}
        </div>
      ) : creatives.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">🎨</span>
          <p>No creatives yet. Create your first one above, or let the AI strategy generator build them for you.</p>
        </div>
      ) : (
        <Reveal>
          <div className="creatives-library">
            <h2>Creative Library ({creatives.length})</h2>
            <div className="creatives-grid">
              {creatives.map((c) => (
                <div key={c.id} className="creative-asset-card">
                  <div className="creative-asset-header">
                    <span className={`creative-format-badge format-${c.format}`}>{c.format}</span>
                    <div className="creative-asset-actions">
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleGenerateVariations(c)}
                        title="Generate AI variations"
                      >
                        ✨ Variations
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDelete(c.id)}
                        disabled={deleting === c.id}
                        title="Delete"
                      >
                        {deleting === c.id ? "…" : "🗑"}
                      </button>
                    </div>
                  </div>
                  <strong className="creative-asset-headline">{c.headline}</strong>
                  <p className="creative-asset-body">{c.body}</p>
                  <div className="creative-asset-footer">
                    <span className="pill">{c.callToAction}</span>
                    {c.tags.map((tag) => (
                      <span key={tag} className="creative-tag">{tag}</span>
                    ))}
                  </div>
                  <span className="creative-asset-date">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      )}
    </div>
  );
}
