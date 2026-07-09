import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, CatalogSourceResult, Draft, GenerationJob, ProductAnalysis, ProductCatalogItem } from "../api/client.js";
import {
  ClockIcon as HistoryIcon,
  LightningIcon,
  LinkIcon,
  PlusIcon,
  ShoppingBagIcon,
  TargetIcon,
  PinIcon,
  MetaInfinityIcon,
  CubeIcon,
  FacebookIcon,
  GoogleGmcIcon,
  XIcon,
  SearchIcon,
} from "../components/icons.js";
import { GoogleIcon } from "../components/icons.js";
import { DropdownField, type Option } from "../components/DropdownField.js";

const COUNTRY_OPTIONS: Option[] = [
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "CA", label: "Canada" },
  { value: "AU", label: "Australia" },
  { value: "IN", label: "India" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "BR", label: "Brazil" },
  { value: "JP", label: "Japan" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "SG", label: "Singapore" },
  { value: "MX", label: "Mexico" },
];

const CHANNEL_OPTIONS: Option[] = [
  { value: "meta", label: "Meta", icon: <MetaInfinityIcon /> },
  { value: "google", label: "Google", icon: <GoogleIcon /> },
  { value: "tiktok", label: "TikTok" },
];

const OBJECTIVE_OPTIONS: Option[] = [
  { value: "sales", label: "Sales / Conversions" },
  { value: "leads", label: "Lead Generation" },
  { value: "traffic", label: "Website Traffic" },
  { value: "awareness", label: "Brand Awareness" },
];

const CONVERSION_EVENT_OPTIONS: Option[] = [
  { value: "purchase", label: "Purchase" },
  { value: "add_to_cart", label: "Add to Cart" },
  { value: "lead", label: "Lead" },
  { value: "complete_registration", label: "Complete Registration" },
  { value: "landing_page_view", label: "Landing Page View" },
];

const PRODUCT_SOURCE_TABS: { value: "all" | "shopify" | "facebook" | "google"; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "All", icon: <CubeIcon /> },
  { value: "shopify", label: "Shopify", icon: <ShoppingBagIcon /> },
  { value: "facebook", label: "Facebook feeds", icon: <FacebookIcon /> },
  { value: "google", label: "Google GMC", icon: <GoogleGmcIcon /> },
];

interface PromotedProduct {
  id: string;
  url?: string;
  name: string;
  category: string;
  summary: string;
}

export default function CampaignGenerator({ businessId }: { businessId: string }) {
  const navigate = useNavigate();
  const workspaceId = localStorage.getItem("adgo_workspace_id") ?? "demo";

  const [countries, setCountries] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>(["meta"]);
  const [objective, setObjective] = useState<string[]>([]);
  const [conversionEvent, setConversionEvent] = useState<string[]>([]);

  const [productUrl, setProductUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [products, setProducts] = useState<PromotedProduct[]>([]);

  const [historicalOpen, setHistoricalOpen] = useState(false);
  const [historicalDrafts, setHistoricalDrafts] = useState<Draft[] | null>(null);
  const [historicalLoading, setHistoricalLoading] = useState(false);

  const [productsModalOpen, setProductsModalOpen] = useState(false);
  const [productsModalTab, setProductsModalTab] = useState<"all" | "shopify" | "facebook" | "google">("all");
  const [productSearch, setProductSearch] = useState("");
  const [catalog, setCatalog] = useState<CatalogSourceResult[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [dailyBudget, setDailyBudget] = useState("50");
  const [generating, setGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const headerRef = useRef<HTMLElement>(null);
  const [modalOverlayTop, setModalOverlayTop] = useState(0);

  useLayoutEffect(() => {
    function measure() {
      if (headerRef.current) {
        setModalOverlayTop(headerRef.current.getBoundingClientRect().bottom);
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [productsModalOpen]);

  useEffect(() => {
    const deepResearchRaw = sessionStorage.getItem("adgo_deep_research");
    if (deepResearchRaw) {
      sessionStorage.removeItem("adgo_deep_research");
      try {
        const parsed = JSON.parse(deepResearchRaw) as {
          url: string;
          product: ProductAnalysis;
        };
        setProducts((prev) => [
          ...prev,
          {
            id: `url-${prev.length}-${Date.now()}`,
            url: parsed.url,
            name: parsed.product.productName,
            category: parsed.product.category,
            summary: parsed.product.summary,
          },
        ]);
      } catch {
        // Malformed payload — fall through, nothing to prefill.
      }
      return;
    }

    const prefillUrl = sessionStorage.getItem("adgo_new_campaign_url");
    if (prefillUrl) {
      setProductUrl(prefillUrl);
      sessionStorage.removeItem("adgo_new_campaign_url");
    }
  }, []);

  useEffect(() => {
    if (!productsModalOpen) return;
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);
    api
      .listProductCatalog(workspaceId, productsModalTab)
      .then((result) => {
        if (!cancelled) setCatalog(result);
      })
      .catch((err) => {
        if (!cancelled) setCatalogError(err instanceof Error ? err.message : "Couldn't load products");
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productsModalOpen, productsModalTab, workspaceId]);

  async function handleParseUrl() {
    const url = productUrl.trim();
    if (!url) return;
    setParseError(null);
    setParsing(true);
    try {
      const site = await api.scrapeWebsite(url);
      const analysis: ProductAnalysis = await api.analyzeProduct(site);
      setProducts((prev) => [
        ...prev,
        { id: `url-${prev.length}-${Date.now()}`, url, name: analysis.productName, category: analysis.category, summary: analysis.summary },
      ]);
      setProductUrl("");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Couldn't parse that URL");
    } finally {
      setParsing(false);
    }
  }

  function removeProduct(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  function toggleCatalogItem(item: ProductCatalogItem) {
    const id = `catalog-${item.id}`;
    setProducts((prev) =>
      prev.some((p) => p.id === id)
        ? prev.filter((p) => p.id !== id)
        : [
            ...prev,
            {
              id,
              url: item.url,
              name: item.name,
              category: item.category,
              summary: `$${(item.priceCents / 100).toFixed(2)} · via ${item.source}`,
            },
          ]
    );
  }

  async function toggleHistorical() {
    const next = !historicalOpen;
    setHistoricalOpen(next);
    setProductsModalOpen(false);
    if (next && historicalDrafts === null) {
      setHistoricalLoading(true);
      try {
        const drafts = await api.listDrafts(workspaceId);
        setHistoricalDrafts(drafts);
      } catch {
        setHistoricalDrafts([]);
      } finally {
        setHistoricalLoading(false);
      }
    }
  }

  function pickHistoricalDraft(draft: Draft) {
    setProducts((prev) => [
      ...prev,
      { id: `draft-${draft.id}`, name: draft.name, category: "Historical campaign", summary: draft.aiRecommendation ?? "Reused from a previous draft." },
    ]);
    setHistoricalOpen(false);
  }

  function openProductsModal(tab: "all" | "shopify" | "facebook" | "google") {
    setHistoricalOpen(false);
    setProductsModalTab(tab);
    setProductsModalOpen(true);
  }

  function goConnectDataSource() {
    setProductsModalOpen(false);
    navigate("/profile/ad-platform-connection");
  }

  async function pollGenerationJob(jobId: string, timeoutMs = 120000): Promise<GenerationJob> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const job = await api.getGenerationJob(jobId);
      if (job.status === "done" || job.status === "failed") return job;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("Creative generation timed out — check /studio for its status");
  }

  async function handleGenerate() {
    setGenerateError(null);
    if (channels.length === 0) {
      setGenerateError("Choose at least one placement channel.");
      return;
    }
    if (products.length === 0) {
      setGenerateError("Add at least one product to promote.");
      return;
    }
    const dailyBudgetCents = Math.round(parseFloat(dailyBudget) * 100);
    if (!dailyBudgetCents || dailyBudgetCents <= 0) {
      setGenerateError("Enter a valid daily budget.");
      return;
    }

    setGenerating(true);
    try {
      setGenerationStage("Generating AI strategy…");
      const strategy = await api.generateStrategy(businessId);

      setGenerationStage("Generating AI creative (image + copy)…");
      const primaryProduct = products[0];
      const job = await api.createGenerationJob(workspaceId, {
        businessId,
        productUrl: primaryProduct.url,
        prompt: primaryProduct.url ? undefined : primaryProduct.summary,
        wantVideo: false,
      });
      const completedJob = await pollGenerationJob(job.id);
      if (completedJob.status === "failed") {
        throw new Error(completedJob.error ?? "Creative generation failed");
      }

      setGenerationStage("Building campaign…");
      const campaign = await api.createCampaign({
        strategyId: strategy.id,
        name: `Campaign Generator - ${(objective[0] ?? "sales").toUpperCase()}`,
        dailyBudgetCents,
      });

      if (completedJob.result) {
        await api.applyCreativeMedia(campaign.id, {
          imageUrl: completedJob.result.imageUrl,
          videoUrl: completedJob.result.videoUrl,
        });
      }

      setGenerationStage("Launching on Meta (starts paused for your review)…");
      await api.launchCampaign(campaign.id, workspaceId);

      navigate(`/campaigns/${campaign.id}`);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Failed to generate campaign");
    } finally {
      setGenerating(false);
      setGenerationStage(null);
    }
  }

  return (
    <div className="page-campaign-generator">
      <header className="adsgo-header" ref={headerRef}>
        <h1 className="adsgo-header-title">Campaign Generator</h1>
        <div className="adsgo-header-right">
          <div className="header-meta-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>UTC+5.5</span>
          </div>
          <div className="header-meta-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>English</span>
          </div>
          <div className="header-bell">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>
          <div className="header-profile-dropdown">
            <div className="profile-avatar">SS</div>
            <div className="profile-info">
              <span className="profile-name">ssrivastava</span>
              <span className="profile-username">ssrivastava</span>
            </div>
            <span style={{ fontSize: "10px", color: "#9ca3af", marginLeft: "4px" }}>▼</span>
          </div>
        </div>
      </header>

      <section className="gen-card">
        <div className="gen-card-header">
          <span className="gen-card-icon gen-card-icon-purple">
            <TargetIcon />
          </span>
          <h2>Goals &amp; channels</h2>
        </div>
        <div className="gen-fields-grid">
          <DropdownField
            label="Target countries / regions"
            icon={<PinIcon />}
            options={COUNTRY_OPTIONS}
            selected={countries}
            onChange={setCountries}
            multi
          />
          <DropdownField
            label="Placement channels"
            icon={<MetaInfinityIcon />}
            options={CHANNEL_OPTIONS}
            selected={channels}
            onChange={setChannels}
            multi
          />
          <DropdownField
            label="Primary objective"
            icon={<TargetIcon />}
            options={OBJECTIVE_OPTIONS}
            selected={objective}
            onChange={setObjective}
          />
          <DropdownField
            label="Conversion optimization event"
            icon={<LightningIcon />}
            options={CONVERSION_EVENT_OPTIONS}
            selected={conversionEvent}
            onChange={setConversionEvent}
          />
          <div className="gen-field">
            <span className="gen-field-label">Daily budget (USD)</span>
            <input
              type="number"
              min="1"
              step="1"
              className="gen-field-control"
              value={dailyBudget}
              onChange={(e) => setDailyBudget(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="gen-card">
        <div className="gen-card-header">
          <span className="gen-card-icon gen-card-icon-purple">
            <ShoppingBagIcon />
          </span>
          <h2>Add products to promote</h2>
        </div>

        {parseError && <p className="error mb-2">{parseError}</p>}

        <div className="gen-url-drop">
          <span className="gen-url-drop-icon">
            <LinkIcon />
          </span>
          <input
            type="text"
            placeholder="Paste target URL and press Enter to parse..."
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleParseUrl()}
            disabled={parsing}
          />
          <button type="button" className="gen-url-drop-add" onClick={handleParseUrl} disabled={parsing || !productUrl.trim()} aria-label="Parse URL">
            <PlusIcon />
          </button>
        </div>

        <div className="gen-catalog-actions">
          <div className="gen-catalog-action-wrap">
            <button type="button" className="btn btn-secondary" onClick={toggleHistorical}>
              <HistoryIcon />
              Pick from historical catalog
            </button>
            {historicalOpen && (
              <div className="gen-catalog-panel">
                {historicalLoading && <p className="muted-text">Loading past drafts…</p>}
                {!historicalLoading && historicalDrafts?.length === 0 && (
                  <p className="muted-text">No historical drafts found yet.</p>
                )}
                {!historicalLoading && historicalDrafts?.map((d) => (
                  <div key={d.id} className="gen-catalog-panel-item" onClick={() => pickHistoricalDraft(d)}>
                    {d.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="gen-catalog-action-wrap">
            <button type="button" className="btn btn-secondary" onClick={() => openProductsModal("shopify")}>
              <ShoppingBagIcon />
              Pick from Shopify
            </button>
          </div>
        </div>

        {products.length > 0 && (
          <div className="gen-products-list">
            {products.map((p) => (
              <div key={p.id} className="gen-product-card">
                <div>
                  <strong>{p.name}</strong>
                  <span className="gen-product-category">{p.category}</span>
                  <p>{p.summary}</p>
                </div>
                <button type="button" className="gen-product-remove" onClick={() => removeProduct(p.id)} aria-label={`Remove ${p.name}`}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {generateError && <p className="error mb-2">{generateError}</p>}

      <div className="gen-footer-actions">
        {generationStage && <span className="muted-text mr-2">{generationStage}</span>}
        <button type="button" className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating..." : "Generate Campaign"}
        </button>
      </div>

      {productsModalOpen && (
        <div className="gen-modal-overlay" style={{ top: modalOverlayTop }} onClick={() => setProductsModalOpen(false)}>
          <div className="gen-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gen-modal-header">
              <h2>Select products</h2>
              <button type="button" className="gen-modal-close" onClick={() => setProductsModalOpen(false)} aria-label="Close">
                <XIcon />
              </button>
            </div>

            <div className="gen-modal-toolbar">
              <div className="gen-modal-tabs">
                {PRODUCT_SOURCE_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    data-tab={tab.value}
                    className={`gen-modal-tab ${productsModalTab === tab.value ? "active" : ""}`}
                    onClick={() => setProductsModalTab(tab.value)}
                  >
                    <span className="gen-modal-tab-icon">{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="gen-modal-search">
                <SearchIcon />
                <input
                  type="text"
                  placeholder="Search by product name or URL..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
              </div>
            </div>

            {(() => {
              const catalogItems = (catalog ?? []).flatMap((r) => r.items);
              const catalogConnected = (catalog ?? []).some((r) => r.connected);
              const query = productSearch.trim().toLowerCase();
              const filteredItems = query
                ? catalogItems.filter((item) => item.name.toLowerCase().includes(query) || item.url.toLowerCase().includes(query))
                : catalogItems;
              const showGrid = !catalogLoading && !catalogError && catalogConnected;

              return (
                <div className={`gen-modal-body ${showGrid ? "gen-modal-body-grid" : ""}`}>
                  {catalogLoading && <p className="muted-text">Loading products…</p>}

                  {!catalogLoading && catalogError && <p className="error">{catalogError}</p>}

                  {!catalogLoading && !catalogError && !catalogConnected && (
                    <div className="gen-modal-empty">
                      <span className="gen-modal-empty-icon">
                        <ShoppingBagIcon />
                      </span>
                      <p>Connect your store to sync products automatically or manually set up a product for analysis.</p>
                      <button type="button" className="btn btn-primary gen-modal-connect-btn" onClick={goConnectDataSource}>
                        <PlusIcon />
                        Connect product data source
                      </button>
                    </div>
                  )}

                  {showGrid && filteredItems.length === 0 && (
                    <p className="muted-text">No products match your search.</p>
                  )}

                  {showGrid && filteredItems.length > 0 && (
                    <div className="gen-modal-grid">
                      {filteredItems.map((item) => {
                        const selected = products.some((p) => p.id === `catalog-${item.id}`);
                        return (
                          <button
                            type="button"
                            key={item.id}
                            className={`gen-modal-product ${selected ? "selected" : ""}`}
                            onClick={() => toggleCatalogItem(item)}
                          >
                            <img src={item.imageUrl} alt={item.name} />
                            <div className="gen-modal-product-info">
                              <strong>{item.name}</strong>
                              <span>{item.category} · ${(item.priceCents / 100).toFixed(2)}</span>
                            </div>
                            <span className="gen-modal-product-check">{selected ? "✓ Added" : "Add"}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
