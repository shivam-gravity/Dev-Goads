import { NavLink, Route, Routes, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { MascotIcon, SearchIcon } from "./components/icons.js";
import { AuthProvider, useAuth } from "./context/AuthContext.js";

// Page imports
import Onboarding from "./pages/Onboarding.js";
import Dashboard from "./pages/Dashboard.js";
import CampaignDetail from "./pages/CampaignDetail.js";
import Campaigns from "./pages/Campaigns.js";
import NewCampaign from "./pages/NewCampaign.js";
import CampaignBuilder from "./pages/CampaignBuilder.js";
import Analytics from "./pages/Analytics.js";
import Audiences from "./pages/Audiences.js";
import Creatives from "./pages/Creatives.js";
import Billing from "./pages/Billing.js";
import Privacy from "./pages/Privacy.js";
import Terms from "./pages/Terms.js";
import Features from "./pages/Features.js";
import Pricing from "./pages/Pricing.js";
import Resources from "./pages/Resources.js";
import AutoCreative from "./pages/AutoCreative.js";
import Compare from "./pages/Compare.js";
import AboutUs from "./pages/AboutUs.js";
import Contact from "./pages/Contact.js";
import Blog from "./pages/Blog.js";

// New Pages Imports
import Login from "./pages/Login.js";
import Signup from "./pages/Signup.js";
import CampaignGenerator from "./pages/CampaignGenerator.js";
import CreativeStudio from "./pages/CreativeStudio.js";
import AudienceBuilder from "./pages/AudienceBuilder.js";
import AdsManager from "./pages/AdsManager.js";
import Drafts from "./pages/Drafts.js";
import AIInsights from "./pages/AIInsights.js";
import AssetLibrary from "./pages/AssetLibrary.js";
import Notifications from "./pages/Notifications.js";
import HelpCenter from "./pages/HelpCenter.js";
import Admin from "./pages/Admin/index.js";
import AutomationRules from "./pages/AutomationRules.js";
import MediaPlan from "./pages/MediaPlan.js";
import OptimizeGoal from "./pages/OptimizeGoal.js";
import BrandProfile from "./pages/BrandProfile.js";
import Products from "./pages/Products.js";
import UserCenter from "./pages/UserCenter/index.js";
import { CopilotProvider, useCopilot } from "./providers/CopilotProvider.js";
import CopilotDrawer from "./components/Copilot/Drawer.js";
import ErrorBoundary from "./components/ErrorBoundary.js";
import HelpWidget from "./components/HelpWidget.js";

const MARKETING_ROUTES: Record<string, JSX.Element> = {
  "/features": <Features />,
  "/pricing": <Pricing />,
  "/resources": <Resources />,
  "/auto-creative": <AutoCreative />,
  "/compare": <Compare />,
  "/about-us": <AboutUs />,
  "/contact": <Contact />,
  "/blog": <Blog />,
  "/privacy": <Privacy />,
  "/privacy-policy": <Privacy />,
  "/terms": <Terms />,
};

function AuthenticatedApp() {
  const { businessId, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [brandQuery, setBrandQuery] = useState("");
  const [brands, setBrands] = useState([{ id: "default", name: "Default Brand" }]);
  const [selectedBrandId, setSelectedBrandId] = useState("default");
  const brandMenuRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!brandMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (brandMenuRef.current && !brandMenuRef.current.contains(e.target as Node)) {
        setBrandMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [brandMenuOpen]);

  useEffect(() => {
    if (!helpOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (helpPanelRef.current && !helpPanelRef.current.contains(target) && !(e.target as HTMLElement).closest(".help-widget-trigger")) {
        setHelpOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [helpOpen]);

  const selectedBrand = brands.find((b) => b.id === selectedBrandId) ?? brands[0];
  const filteredBrands = brands.filter((b) => b.name.toLowerCase().includes(brandQuery.toLowerCase()));

  function handleCreateBrand() {
    setBrandMenuOpen(false);
    setBrandQuery("");
    navigate("/brand");
  }

  return (
    <div className="app-shell-sidebar">
      {/* Sidebar */}
      <aside className={`sidebar adsgo-sidebar ${sidebarOpen ? "sidebar-open" : ""} ${brandMenuOpen ? "sidebar-pinned" : ""}`}>
        <div className="sidebar-brand adsgo-brand">
          <NavLink to="/dashboard" className="brand-lockup-adsgo" onClick={() => setSidebarOpen(false)}>
            <span className="brand-logo-badge"><img src="/logo-icon.png" alt="CRM Ads" /></span>
            <span className="brand-text-adsgo">CRM Ads</span>
          </NavLink>
        </div>

        <div className="workspace-selector-wrap" ref={brandMenuRef}>
          <div className="workspace-selector" onClick={() => setBrandMenuOpen((o) => !o)}>
            <div className="workspace-avatar">{selectedBrand.name.charAt(0).toUpperCase()}</div>
            <div className="workspace-info">
              <span className="workspace-title">{selectedBrand.name}</span>
              <span className="workspace-sub">Workspace</span>
            </div>
            <span className={`workspace-chevron ${brandMenuOpen ? "workspace-chevron-open" : ""}`}>▼</span>
          </div>

          {brandMenuOpen && (
            <div className="workspace-dropdown">
              <div className="workspace-dropdown-search">
                <SearchIcon className="workspace-dropdown-search-icon" />
                <input
                  type="text"
                  placeholder="Search brands..."
                  value={brandQuery}
                  onChange={(e) => setBrandQuery(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="workspace-dropdown-list">
                {filteredBrands.map((b) => (
                  <div
                    key={b.id}
                    className="workspace-dropdown-item"
                    onClick={() => {
                      setSelectedBrandId(b.id);
                      setBrandMenuOpen(false);
                      setBrandQuery("");
                    }}
                  >
                    <span>{b.name}</span>
                    {b.id === selectedBrandId && <span className="workspace-dropdown-check">✓</span>}
                  </div>
                ))}
                {filteredBrands.length === 0 && (
                  <div className="workspace-dropdown-empty">No brands found</div>
                )}
              </div>

              <button type="button" className="workspace-dropdown-create" onClick={handleCreateBrand}>
                <span className="workspace-dropdown-create-icon">+</span> Create new brand
              </button>
            </div>
          )}
        </div>

        {businessId && (
          <>
          <nav className="sidebar-nav adsgo-nav" style={{ overflowY: "auto", paddingBottom: "24px" }}>
            <NavLink to="/dashboard" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
                <span className="sidebar-link-label">Home</span>
              </span>
            </NavLink>
            <NavLink to="/media-plan" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                <span className="sidebar-link-label">Media Plan</span>
              </span>
            </NavLink>
            <NavLink to="/campaigns/new" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
                <span className="sidebar-link-label">New Campaign</span>
              </span>
            </NavLink>
            <NavLink to="/wizard" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
                <span className="sidebar-link-label">Campaign Generator</span>
              </span>
            </NavLink>

            <div className="sidebar-nav-group-label adsgo-label">AI OPTIMIZE</div>
            <NavLink to="/manager" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
                <span className="sidebar-link-label">Ads Manager</span>
              </span>
            </NavLink>
            <NavLink to="/drafts" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                <span className="sidebar-link-label">Draft & AI Recs</span>
              </span>
            </NavLink>
            <div className="sidebar-nav-group-label adsgo-label">CREATIVE HUB</div>
            <NavLink to="/studio" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /><path d="M12 8l-2 4 2 4 2-4-2-4z" /></svg>
                <span className="sidebar-link-label">AI Generate</span>
              </span>
            </NavLink>
            <NavLink to="/assets" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                <span className="sidebar-link-label">Creative Library</span>
              </span>
            </NavLink>

            <div className="sidebar-nav-group-label adsgo-label">ANALYTICS</div>
            <NavLink to="/analytics" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
                <span className="sidebar-link-label">Ad Insights</span>
              </span>
            </NavLink>
            <NavLink to="/insights" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                <span className="sidebar-link-label">AI Analysis</span>
              </span>
            </NavLink>

            <div className="sidebar-nav-group-label adsgo-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <span>BRAND CENTER</span>
              <span style={{ fontSize: '10px' }}>▼</span>
            </div>
            <NavLink to="/goal" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>
                <span className="sidebar-link-label">Optimize Goal</span>
              </span>
            </NavLink>
            <NavLink to="/brand" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12l3 5-9 13L3 8Z" /><path d="M3 8h18M9 3l3 5 3-5M12 8l-2 13M12 8l2 13" /></svg>
                <span className="sidebar-link-label">Brand Profile</span>
              </span>
            </NavLink>
            <NavLink to="/products" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
                <span className="sidebar-link-label">Products</span>
              </span>
            </NavLink>

          </nav>
          <div className="sidebar-footer adsgo-footer">
            <button
              type="button"
              className={`sidebar-link adsgo-link help-widget-trigger ${helpOpen ? "active" : ""}`}
              onClick={() => setHelpOpen((o) => !o)}
            >
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" /></svg>
                <span className="sidebar-link-label">Help Center</span>
              </span>
            </button>
            {helpOpen && <HelpWidget onClose={() => setHelpOpen(false)} panelRef={helpPanelRef} />}
          </div>
          </>
        )}
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="sidebar-main adsgo-main">
        {/* Mobile topbar */}
        <header className="mobile-topbar">
          <button
            className="mobile-menu-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle menu"
          >
            ☰
          </button>
          <NavLink to="/" className="brand brand-lockup">
            <MascotIcon className="mascot mascot-sm" />
            <span className="brand-text">AdGo</span>
          </NavLink>
        </header>

        <main className="sidebar-content adsgo-content">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/dashboard"
              element={businessId ? <Dashboard businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/campaigns"
              element={businessId ? <Campaigns businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/campaigns/new"
              element={businessId ? <NewCampaign /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/campaigns/:campaignId/builder"
              element={businessId ? <CampaignBuilder /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/campaigns/:campaignId"
              element={businessId ? <CampaignDetail /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/analytics"
              element={businessId ? <Analytics businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/audiences"
              element={businessId ? <AudienceBuilder businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/creatives"
              element={businessId ? <Creatives businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/billing"
              element={businessId ? <Billing businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            
            {/* New Routes */}
            <Route
              path="/wizard"
              element={businessId ? <CampaignGenerator businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/studio"
              element={businessId ? <CreativeStudio businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/manager"
              element={businessId ? <AdsManager businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/drafts"
              element={businessId ? <Drafts businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/insights"
              element={businessId ? <AIInsights businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/assets"
              element={businessId ? <AssetLibrary businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route path="/integrations" element={<Navigate to="/profile/ad-platform-connection" replace />} />
            <Route
              path="/profile/*"
              element={businessId ? <UserCenter businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/notifications"
              element={businessId ? <Notifications businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/help"
              element={businessId ? <HelpCenter /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/admin/*"
              element={businessId ? <Admin businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/rules"
              element={businessId ? <AutomationRules businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/media-plan"
              element={businessId ? <MediaPlan businessId={businessId} /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/goal"
              element={businessId ? <OptimizeGoal /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/brand"
              element={businessId ? <BrandProfile /> : <Navigate to="/login" replace />}
            />
            <Route
              path="/products"
              element={businessId ? <Products /> : <Navigate to="/login" replace />}
            />
          </Routes>
        </main>
      </div>

      {/* Global AI Copilot Drawer Overlay */}
      <CopilotDrawer />
      
      {/* Global AI Copilot Floating Chat Trigger */}
      <CopilotFab />
    </div>
  );
}

function CopilotFab() {
  const { openCopilot, isOpen } = useCopilot();
  if (isOpen) return null;
  return (
    <div className="chat-fab" onClick={openCopilot} title="Open AI Copilot">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </div>
  );
}

function LoggedOutRoute({ children }: { children: JSX.Element }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return children;
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated, isLoading, businessId } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!businessId) return <Navigate to="/get-started" replace />;
  return children;
}

function OnboardingWrapper() {
  const { isAuthenticated, isLoading, businessId, setBusinessId } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (businessId) return <Navigate to="/dashboard" replace />;
  return <Onboarding onOnboarded={setBusinessId} />;
}

export default function App() {
  const location = useLocation();

  const marketingPage = MARKETING_ROUTES[location.pathname];
  if (marketingPage) {
    return marketingPage;
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <CopilotProvider>
          <Routes>
            <Route path="/login" element={<LoggedOutRoute><Login /></LoggedOutRoute>} />
            <Route path="/signup" element={<LoggedOutRoute><Signup /></LoggedOutRoute>} />
            <Route path="/get-started" element={<OnboardingWrapper />} />
            <Route path="/*" element={<RequireAuth><AuthenticatedApp /></RequireAuth>} />
          </Routes>
        </CopilotProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
