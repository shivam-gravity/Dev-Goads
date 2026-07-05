import { useEffect, useState } from "react";
import { api, Asset } from "../api/client.js";
import Reveal from "../components/Reveal.js";

const FILE_TYPES = ["all", "image", "video", "logo", "template"] as const;

export default function AssetLibrary({ businessId }: { businessId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activeFilter, setActiveFilter] = useState<(typeof FILE_TYPES)[number]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload Form State
  const [showUpload, setShowUpload] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [assetType, setAssetType] = useState<Asset["type"]>("image");
  const [assetTags, setAssetTags] = useState("");
  const [uploading, setUploading] = useState(false);

  // Brand Configuration States
  const [primaryColor, setPrimaryColor] = useState("#4f46e5");
  const [secondaryColor, setSecondaryColor] = useState("#10b981");
  const [fontFamily, setFontFamily] = useState("Inter, sans-serif");

  const wsId = localStorage.getItem("adgo_workspace_id") ?? "demo";

  async function loadAssets() {
    setLoading(true);
    setError(null);
    try {
      const filterParam = activeFilter === "all" ? undefined : activeFilter;
      const data = await api.listAssets(wsId, filterParam);
      setAssets(data);
    } catch {
      setError("Failed to fetch assets library.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssets();
  }, [businessId, activeFilter]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!assetName.trim() || !assetUrl.trim()) return;

    setUploading(true);
    setError(null);
    try {
      await api.createAsset(wsId, {
        name: assetName,
        type: assetType,
        url: assetUrl,
        thumbnailUrl: assetUrl,
        size: 210000,
        mimeType: assetType === "video" ? "video/mp4" : "image/jpeg",
        tags: assetTags.split(",").map(t => t.trim()).filter(Boolean),
        width: 1080,
        height: 1080
      });
      setAssetName("");
      setAssetUrl("");
      setAssetTags("");
      setShowUpload(false);
      await loadAssets();
    } catch {
      setError("Failed to add asset to library.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this asset from library?")) return;
    try {
      await api.deleteAsset(id);
      await loadAssets();
    } catch {
      setError("Failed to delete asset.");
    }
  }

  return (
    <div className="asset-library">
      <div className="page-header">
        <div>
          <h1>Asset Library</h1>
          <p className="subtitle">Manage brand visual resources, copy templates, and track asset usage.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowUpload(!showUpload)}>
          {showUpload ? "Cancel Upload" : "+ Add Asset"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {/* Brand Configuration Card */}
      <section className="card mb-4">
        <h2>🎨 Brand Style Kit</h2>
        <p className="muted-text mt-1">Configure style parameters, approved messaging guidelines, and design directives to keep AI ad creatives on-brand.</p>
        
        <div className="brand-kit-grid mt-4">
          <label>
            Primary Brand Color
            <div className="color-picker-row">
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
              <span>{primaryColor}</span>
            </div>
          </label>
          <label>
            Secondary Brand Color
            <div className="color-picker-row">
              <input type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} />
              <span>{secondaryColor}</span>
            </div>
          </label>
          <label>
            Primary Font Family
            <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
              <option value="Inter, sans-serif">Inter (Modern Sans)</option>
              <option value="'Outfit', sans-serif">Outfit (Premium Sans)</option>
              <option value="system-ui, sans-serif">System UI</option>
            </select>
          </label>
          <label>
            Brand Voice &amp; Tone
            <select defaultValue="professional">
              <option value="professional">Professional / Authoritative</option>
              <option value="casual">Casual / Friendly</option>
              <option value="energetic">Energetic / Bold</option>
              <option value="luxury">Luxury / Sophisticated</option>
            </select>
          </label>
        </div>

        {/* Logo variants */}
        <div className="mt-4">
          <span className="font-size-13 font-weight-600 block text-secondary mb-2">Logo Asset Variants</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
            {[
              { type: "Horizontal Logo", spec: "250x60px PNG" },
              { type: "Square Icon / Avatar", spec: "512x512px PNG" },
              { type: "Light Background Logo", spec: "Vector SVG" },
              { type: "Dark Background Logo", spec: "Vector SVG" }
            ].map(v => (
              <div key={v.type} style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "12px", background: "#f9fafb" }}>
                <strong className="block font-size-12">{v.type}</strong>
                <span className="muted-text font-size-11 block mt-1">{v.spec}</span>
                <button className="btn btn-sm btn-secondary mt-2 w-full" onClick={() => alert("Upload dialog simulated.")}>Upload Asset</button>
              </div>
            ))}
          </div>
        </div>

        {/* Approved Copywriting Blocks */}
        <div className="mt-4">
          <span className="font-size-13 font-weight-600 block text-secondary mb-2">Approved Copywriting &amp; Slogans</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <label>
              Core Brand Tagline
              <textarea
                style={{ width: "100%", height: "60px", padding: "8px", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "12px", outline: "none", resize: "none", marginTop: "4px" }}
                defaultValue="Unlock high-efficiency campaign optimization with epsilon-greedy AI agents."
              />
            </label>
            <label>
              Value Proposition Copy
              <textarea
                style={{ width: "100%", height: "60px", padding: "8px", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "12px", outline: "none", resize: "none", marginTop: "4px" }}
                defaultValue="Stop wasting six hours a week adjusting ad budgets manually. AdsGo automates budget split and copy variations on autpilot."
              />
            </label>
          </div>
        </div>

        {/* Design guidelines */}
        <div className="mt-4" style={{ display: "flex", gap: "24px" }}>
          <div>
            <span className="font-size-12 font-weight-600 block text-secondary mb-1">Image Aspect Ratio Guidelines</span>
            <span className="pill font-size-11" style={{ marginRight: "4px" }}>1:1 Square</span>
            <span className="pill font-size-11" style={{ marginRight: "4px" }}>9:16 Stories</span>
            <span className="pill font-size-11">16:9 Landscape</span>
          </div>
          <div>
            <span className="font-size-12 font-weight-600 block text-secondary mb-1">Brand Creative Mood Direction</span>
            <span className="status status-active" style={{ background: "rgba(112, 51, 245, 0.08)", color: "#7033f5", fontWeight: 700 }}>Minimalist &amp; Premium</span>
          </div>
        </div>
      </section>

      {/* Add Asset Form */}
      {showUpload && (
        <section className="card mb-4 creative-create-card">
          <h2>Upload Brand Asset</h2>
          <form onSubmit={handleUpload} className="creative-form mt-3">
            <label>
              Asset Name
              <input
                type="text"
                value={assetName}
                onChange={(e) => setAssetName(e.target.value)}
                placeholder="e.g. Summer Promo Square"
                required
              />
            </label>
            <label>
              Asset Image/Video URL
              <input
                type="url"
                value={assetUrl}
                onChange={(e) => setAssetUrl(e.target.value)}
                placeholder="e.g. https://unsplash.com/photo..."
                required
              />
            </label>
            <label>
              Asset Type
              <select value={assetType} onChange={(e) => setAssetType(e.target.value as any)}>
                <option value="image">Image</option>
                <option value="video">Video</option>
                <option value="logo">Logo</option>
                <option value="template">Template</option>
              </select>
            </label>
            <label>
              Tags (comma separated)
              <input
                type="text"
                value={assetTags}
                onChange={(e) => setAssetTags(e.target.value)}
                placeholder="e.g. promo, background"
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={uploading}>
              {uploading ? "Saving..." : "Save Asset"}
            </button>
          </form>
        </section>
      )}

      {/* Filters */}
      <div className="status-tabs">
        {FILE_TYPES.map((t) => (
          <button
            key={t}
            className={`status-tab ${activeFilter === t ? "active" : ""}`}
            onClick={() => setActiveFilter(t)}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Assets Grid */}
      {loading ? (
        <div className="campaigns-loading">
          {[1, 2].map(i => <div key={i} className="creative-asset-skeleton" />)}
        </div>
      ) : assets.length === 0 ? (
        <p className="muted-text mt-3">No assets found in library matching this filter.</p>
      ) : (
        <Reveal>
          <div className="assets-grid-layout mt-3">
            {assets.map((asset) => (
              <div key={asset.id} className="asset-grid-card">
                <div className="asset-grid-preview">
                  {asset.type === "video" ? (
                    <div className="video-asset-mock">
                      <span>📹 Video</span>
                    </div>
                  ) : (
                    <img src={asset.url} alt={asset.name} />
                  )}
                  <button className="delete-asset-btn" onClick={() => handleDelete(asset.id)}>×</button>
                </div>
                <div className="asset-grid-info">
                  <strong>{asset.name}</strong>
                  <span className="asset-format-badge format-text">{asset.type}</span>
                  <div className="asset-tags-row mt-2">
                    {asset.tags.map(t => <span key={t} className="creative-tag">{t}</span>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      )}
    </div>
  );
}
