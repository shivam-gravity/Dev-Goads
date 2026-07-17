import { useEffect, useState } from "react";
import { api, Draft } from "../api/client.js";

const PLATFORMS: { key: string; label: string; icon: string; enabled: boolean }[] = [
  { key: "meta", label: "Meta", icon: "meta", enabled: true },
  { key: "google", label: "Google", icon: "google", enabled: true },
  { key: "tiktok", label: "Tiktok", icon: "tiktok", enabled: false },
  { key: "bing", label: "Bing", icon: "bing", enabled: false },
];

interface DraftVariant { network?: string; audienceName?: string }

/** Draft.data is duck-typed per producer — the CampaignBuilder save-draft flow writes
 * dailyBudgetCents/variants/creativeAssets, while older demo-seeded drafts used a
 * looser {budget, platforms, targeting} shape. These helpers read whichever fields
 * are actually present instead of assuming one shape. */
function draftNetworks(data: Record<string, unknown>): string[] {
  const variants = Array.isArray(data.variants) ? (data.variants as DraftVariant[]) : [];
  if (variants.length) return [...new Set(variants.map((v) => v.network).filter((n): n is string => Boolean(n)))];
  if (Array.isArray(data.platforms)) return data.platforms as string[];
  return ["meta"];
}

function draftBudget(data: Record<string, unknown>): string {
  if (typeof data.dailyBudgetCents === "number") return `$${(data.dailyBudgetCents / 100).toFixed(2)}`;
  if (typeof data.dailyBudget === "number") return `$${data.dailyBudget}`;
  if (typeof data.budget === "number") return `$${data.budget}`;
  return "—";
}

function draftAudience(data: Record<string, unknown>): string {
  const variants = Array.isArray(data.variants) ? (data.variants as DraftVariant[]) : [];
  const names = [...new Set(variants.map((v) => v.audienceName).filter((n): n is string => Boolean(n)))];
  if (names.length) return names.join(", ");
  if (typeof data.audience === "string") return data.audience;
  return "—";
}

function draftCreativeCount(data: Record<string, unknown>): number | "—" {
  if (Array.isArray(data.creativeAssets)) return data.creativeAssets.length;
  if (Array.isArray(data.creatives)) return data.creatives.length;
  return "—";
}

function draftProduct(data: Record<string, unknown>, fallbackName: string): string {
  if (typeof data.product === "string") return data.product;
  if (typeof data.goal === "string") return data.goal;
  return fallbackName;
}

type BudgetKey = "dailyBudgetCents" | "dailyBudget" | "budget";

/** Mirrors draftBudget's duck-typing, but returns the raw editable value + which
 * key it came from, so saving writes back to the same field instead of adding a
 * second, conflicting budget key alongside the one the draft's producer already uses. */
function draftEditableFields(data: Record<string, unknown>): { budgetKey: BudgetKey; budgetDollars: string; audience: string; product: string } {
  let budgetKey: BudgetKey = "dailyBudgetCents";
  let budgetDollars = "";
  if (typeof data.dailyBudgetCents === "number") { budgetKey = "dailyBudgetCents"; budgetDollars = String(data.dailyBudgetCents / 100); }
  else if (typeof data.dailyBudget === "number") { budgetKey = "dailyBudget"; budgetDollars = String(data.dailyBudget); }
  else if (typeof data.budget === "number") { budgetKey = "budget"; budgetDollars = String(data.budget); }
  const audience = typeof data.audience === "string" ? data.audience : "";
  const product = typeof data.product === "string" ? data.product : typeof data.goal === "string" ? data.goal : "";
  return { budgetKey, budgetDollars, audience, product };
}

const ICON_ITEMS = [
  { key: "products", label: "Products", icon: "cart", cls: "dap-icon-products" },
  { key: "cta", label: "CTA", icon: "cursor", cls: "dap-icon-cta" },
  { key: "interest", label: "Interest", icon: "target", cls: "dap-icon-interest" },
  { key: "creatives", label: "Creatives", icon: "palette", cls: "dap-icon-creatives" },
  { key: "adcopy", label: "Ad Copy", icon: "type", cls: "dap-icon-adcopy" },
  { key: "age", label: "Age", icon: "cake", cls: "dap-icon-age" },
  { key: "gender", label: "Gender", icon: "users", cls: "dap-icon-gender" },
  { key: "locations", label: "Locations", icon: "pin", cls: "dap-icon-locations" },
];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "chevron":
      return (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      );
    case "meta":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <path d="M6.5 3C3.5 3 1 7 1 11.5S3.2 21 6 21c2 0 3.3-1.6 5-4.4 1.7 2.8 3 4.4 5 4.4 2.8 0 5-5 5-9.5S20.5 3 17.5 3c-2 0-3.4 1.7-5.5 5-2.1-3.3-3.5-5-5.5-5zm0 2.4c1 0 2 1.1 3.6 3.7-1.7 2.8-2.7 4.5-3.6 4.5-1.3 0-2.3-2.9-2.3-6.1 0-1.6.5-2.1 2.3-2.1zm11 0c1.8 0 2.3.5 2.3 2.1 0 3.2-1 6.1-2.3 6.1-.9 0-1.9-1.7-3.6-4.5 1.6-2.6 2.6-3.7 3.6-3.7z" />
        </svg>
      );
    case "google":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4c-.2 1.2-1 2.3-2.1 3v2.5h3.4c2-1.8 3.1-4.5 3.1-7.4z" />
          <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.4-2.5c-.9.6-2 1-3.3 1-2.5 0-4.7-1.7-5.5-4H3.6v2.6C5.3 20 8.4 22 12 22z" />
          <path fill="#FBBC05" d="M6.5 14.1c-.2-.6-.3-1.4-.3-2.1s.1-1.5.3-2.1V7.3H3.6C3 8.7 2.7 10.3 2.7 12s.3 3.3 1 4.7z" />
          <path fill="#EA4335" d="M12 6.6c1.5 0 2.8.5 3.8 1.5l2.9-2.9C16.9 3.5 14.6 2.5 12 2.5c-3.6 0-6.7 2-8.4 5l3.4 2.6c.7-2.3 3-3.5 5.5-3.5z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 3c.6 2.2 2.2 3.7 4.5 3.9v3c-1.6 0-3-.5-4.2-1.4v6.4a5.4 5.4 0 1 1-4.7-5.4v3.1a2.4 2.4 0 1 0 1.7 2.3V3H16z" />
        </svg>
      );
    case "bing":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <path d="M5 2v16.2l4.3 2.4L19 15V11l-8-3v9.4l-2.4-1.4V2H5z" />
        </svg>
      );
    case "diamond":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 3h12l4 6-10 12L2 9l4-6z" />
        </svg>
      );
    case "send":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
        </svg>
      );
    case "infinity":
      return (
        <svg {...common}>
          <path d="M18.6 8.4a4.8 4.8 0 1 0 0 7.2A6.5 6.5 0 0 1 12 12a6.5 6.5 0 0 1-6.6 3.6 4.8 4.8 0 1 1 0-7.2A6.5 6.5 0 0 1 12 12a6.5 6.5 0 0 1 6.6-3.6z" />
        </svg>
      );
    case "cart":
      return (
        <svg {...common}>
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
        </svg>
      );
    case "cursor":
      return (
        <svg {...common}>
          <path d="M4 4l7.1 16.7 2-7 7-2z" />
        </svg>
      );
    case "target":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1" />
        </svg>
      );
    case "palette":
      return (
        <svg {...common}>
          <path d="M12 22a10 10 0 1 1 10-10c0 2-1.5 3-3.5 3H15a2 2 0 0 0-1.5 3.3c.4.5.1 1.3-.5 1.6-.3.1-.7.1-1 .1z" />
          <circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="11" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="16" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "type":
      return (
        <svg {...common}>
          <polyline points="4 7 4 4 20 4 20 7" />
          <line x1="9" y1="20" x2="15" y2="20" />
          <line x1="12" y1="4" x2="12" y2="20" />
        </svg>
      );
    case "cake":
      return (
        <svg {...common}>
          <line x1="12" y1="2" x2="12" y2="6" />
          <path d="M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
          <path d="M3 12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0 3 3 3 3 0 0 0 3-3c0-2-2-4-2-4H5s-2 2-2 4z" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
          <path d="M16 3.1a4 4 0 0 1 0 7.8" />
        </svg>
      );
    case "pin":
      return (
        <svg {...common}>
          <path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case "info":
      return (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="10" x2="12" y2="16" />
          <circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "inbox":
      return (
        <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.5 5h13l3.5 7v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7l3.5-7z" />
        </svg>
      );
    default:
      return null;
  }
}

export default function Drafts({ businessId }: { businessId: string }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState("meta");
  const [autoPublish, setAutoPublish] = useState(() => localStorage.getItem("polluxa_auto_publish") === "1");

  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const [editName, setEditName] = useState("");
  const [editBudgetKey, setEditBudgetKey] = useState<BudgetKey>("dailyBudgetCents");
  const [editBudget, setEditBudget] = useState("");
  const [editAudience, setEditAudience] = useState("");
  const [editProduct, setEditProduct] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const wsId = localStorage.getItem("polluxa_workspace_id") ?? "demo-workspace";

  async function loadDrafts() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listDrafts(wsId);
      setDrafts(data);
    } catch (err) {
      setError("Failed to fetch campaign drafts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDrafts();
  }, [businessId]);

  function toggleAutoPublish() {
    setAutoPublish(prev => {
      const next = !prev;
      localStorage.setItem("polluxa_auto_publish", next ? "1" : "0");
      return next;
    });
  }

  async function handlePublish(id: string) {
    setError(null);
    try {
      await api.publishDraft(id);
      setDrafts(prev => prev.map(d => (d.id === id ? { ...d, status: "published" } : d)));
    } catch (err) {
      setError("Failed to publish draft.");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this draft?")) return;
    try {
      await api.deleteDraft(id);
      setDrafts(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      setError("Failed to delete draft.");
    }
  }

  function handleOpenEdit(draft: Draft) {
    const fields = draftEditableFields((draft.data ?? {}) as Record<string, unknown>);
    setEditingDraft(draft);
    setEditName(draft.name);
    setEditBudgetKey(fields.budgetKey);
    setEditBudget(fields.budgetDollars);
    setEditAudience(fields.audience);
    setEditProduct(fields.product);
    setEditError(null);
  }

  function handleCloseEdit() {
    setEditingDraft(null);
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!editingDraft) return;
    if (!editName.trim()) { setEditError("Name is required."); return; }
    const budgetValue = editBudget.trim() ? Number(editBudget) : NaN;
    if (!Number.isFinite(budgetValue) || budgetValue < 0) { setEditError("Daily budget must be a positive number."); return; }

    setSaving(true);
    setEditError(null);
    try {
      const existingData = (editingDraft.data ?? {}) as Record<string, unknown>;
      const data: Record<string, unknown> = { ...existingData, audience: editAudience, product: editProduct };
      data[editBudgetKey] = editBudgetKey === "dailyBudgetCents" ? Math.round(budgetValue * 100) : budgetValue;

      const updated = await api.updateDraft(editingDraft.id, { name: editName.trim(), data });
      setDrafts(prev => prev.map(d => (d.id === updated.id ? updated : d)));
      setEditingDraft(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update draft.");
    } finally {
      setSaving(false);
    }
  }

  const unpublished = drafts.filter(d => d.status !== "published" && draftNetworks((d.data ?? {}) as Record<string, unknown>).includes(platform));
  const recommendationsCount = drafts.filter(d => d.score !== undefined && d.status !== "published").length;
  const publishedCount = drafts.filter(d => d.status === "published").length;

  return (
    <div className="dap-page">
      <div className="dap-breadcrumb">
        <span>AI Optimize</span>
        <Icon name="chevron" />
        <span className="dap-breadcrumb-current">Draft &amp; AI Recs</span>
      </div>

      <div className="dap-tabs">
        {PLATFORMS.map(p => (
          <button
            key={p.key}
            type="button"
            className={`dap-tab ${platform === p.key ? "active" : ""}`}
            disabled={!p.enabled}
            onClick={() => p.enabled && setPlatform(p.key)}
          >
            <Icon name={p.icon} size={16} />
            {p.label}
          </button>
        ))}
      </div>

      <div className="dap-rec-card">
        <div className="dap-rec-top">
          <div>
            <h2>Recommended Ads</h2>
            <p className="dap-rec-sub">
              <strong>Top campaigns</strong> recommended. Select one to view structure.
            </p>
          </div>

          <div className="dap-rec-stats">
            <div className="dap-stat">
              <span className="dap-stat-icon dap-stat-icon-blue">
                <Icon name="diamond" size={18} />
              </span>
              <div>
                <span className="dap-stat-label">Recommendations</span>
                <strong className="dap-stat-val">{recommendationsCount}</strong>
              </div>
            </div>

            <div className="dap-divider" />

            <div className="dap-stat">
              <span className="dap-stat-icon dap-stat-icon-green">
                <Icon name="send" size={16} />
              </span>
              <div>
                <span className="dap-stat-label">Published</span>
                <strong className="dap-stat-val">{publishedCount}</strong>
              </div>
            </div>

            <button type="button" className="dap-toggle-btn" onClick={toggleAutoPublish}>
              <Icon name="infinity" size={16} />
              <span>Auto-Publish</span>
              <span className={`dap-toggle-pill ${autoPublish ? "active" : ""}`}>{autoPublish ? "Active" : "Paused"}</span>
            </button>
          </div>
        </div>

        <div className="dap-icon-grid-wrap">
          <div className="dap-icon-grid">
            {ICON_ITEMS.map(item => (
              <div key={item.key} className="dap-icon-item">
                <span className={`dap-icon-circle ${item.cls}`}>
                  <Icon name={item.icon} size={18} />
                </span>
                <span className="dap-icon-label">{item.label}</span>
              </div>
            ))}
          </div>

          <p className="dap-info-text">
            <strong>24 hours</strong> after your first campaign is published, We&apos;ll recommend new campaigns based on performance.
            <br />
            Turn on <strong>Auto-publish ↗</strong> CRM Ads will launch them automatically at the best time.
          </p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="dap-drafts-section">
        <h2 className="dap-drafts-title">Unpublished Drafts</h2>

        <div className="dap-table-card">
          <div className="dap-table-wrap">
            <table className="dap-table">
              <thead>
                <tr>
                  <th>
                    Queues <span className="dap-th-info"><Icon name="info" /></span>
                  </th>
                  <th>Campaign</th>
                  <th>Daily budget</th>
                  <th>Audience</th>
                  <th>Creatives</th>
                  <th>Product</th>
                  <th>Update time</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="dap-table-loading">Loading…</td>
                  </tr>
                ) : unpublished.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="dap-empty">
                        <Icon name="inbox" size={40} />
                        <span>No data</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  unpublished.map((d, i) => {
                    const data = (d.data ?? {}) as Record<string, unknown>;
                    return (
                      <tr key={d.id}>
                        <td>{i + 1}</td>
                        <td>{d.name}</td>
                        <td>{draftBudget(data)}</td>
                        <td>{draftAudience(data)}</td>
                        <td>{draftCreativeCount(data)}</td>
                        <td>{draftProduct(data, d.name)}</td>
                        <td>{new Date(d.updatedAt).toLocaleString()}</td>
                        <td className="dap-row-actions">
                          <button type="button" className="dap-row-btn" onClick={() => handleOpenEdit(d)}>Edit</button>
                          <button type="button" className="dap-row-btn" onClick={() => handlePublish(d.id)}>Publish</button>
                          <button type="button" className="dap-row-btn dap-row-btn-danger" onClick={() => handleDelete(d.id)}>Delete</button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editingDraft && (
        <div className="polluxa-modal-overlay" onClick={handleCloseEdit}>
          <div className="polluxa-modal" onClick={(e) => e.stopPropagation()}>
            <div className="polluxa-modal-header">
              <h2>Edit Draft</h2>
              <button type="button" className="polluxa-modal-close" onClick={handleCloseEdit} aria-label="Close">×</button>
            </div>

            {editError && <p className="error">{editError}</p>}

            <label className="polluxa-modal-field">
              <span>Name</span>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
            </label>
            <label className="polluxa-modal-field">
              <span>Daily budget (USD)</span>
              <input type="number" min="0" step="0.01" value={editBudget} onChange={(e) => setEditBudget(e.target.value)} />
            </label>
            <label className="polluxa-modal-field">
              <span>Audience</span>
              <input type="text" value={editAudience} onChange={(e) => setEditAudience(e.target.value)} placeholder="e.g. Lookalike — Purchasers" />
            </label>
            <label className="polluxa-modal-field">
              <span>Product</span>
              <input type="text" value={editProduct} onChange={(e) => setEditProduct(e.target.value)} placeholder="e.g. Aurora Wireless Earbuds" />
            </label>

            <button type="button" className="btn btn-primary polluxa-modal-submit" onClick={handleSaveEdit} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
