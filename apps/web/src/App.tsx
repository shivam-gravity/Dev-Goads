import { NavLink, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { MascotIcon } from "./components/icons.js";
import { AuthProvider, useAuth } from "./context/AuthContext.js";

// Page imports
import Landing from "./pages/Landing.js";
import Onboarding from "./pages/Onboarding.js";
import Dashboard from "./pages/Dashboard.js";
import CampaignDetail from "./pages/CampaignDetail.js";
import Campaigns from "./pages/Campaigns.js";
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
import CampaignWizard from "./pages/CampaignWizard.js";
import CreativeStudio from "./pages/CreativeStudio.js";
import AudienceBuilder from "./pages/AudienceBuilder.js";
import AdsManager from "./pages/AdsManager.js";
import Drafts from "./pages/Drafts.js";
import AIInsights from "./pages/AIInsights.js";
import AssetLibrary from "./pages/AssetLibrary.js";
import Integrations from "./pages/Integrations.js";
import Notifications from "./pages/Notifications.js";
import HelpCenter from "./pages/HelpCenter.js";
import Admin from "./pages/Admin/index.js";
import AutomationRules from "./pages/AutomationRules.js";
import { CopilotProvider, useCopilot } from "./providers/CopilotProvider.js";
import CopilotDrawer from "./components/Copilot/Drawer.js";

const MARKETING_ROUTES: Record<string, JSX.Element> = {
  "/": <Landing />,
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-shell-sidebar">
      {/* Sidebar */}
      <aside className={`sidebar adsgo-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand adsgo-brand">
          <NavLink to="/dashboard" className="brand-lockup-adsgo" onClick={() => setSidebarOpen(false)}>
            <svg className="brand-logo-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Overlapping geometric sparkle shape for the purple logo */}
              <path d="M12 2C12 2 13 8 18 12C13 16 12 22 12 22C12 22 11 16 6 12C11 8 12 2 12 2Z" fill="#7033f5" />
              <path d="M12 6C12 6 12.5 9 15 11C12.5 13 12 18 12 18C12 18 11.5 13 9 11C11.5 9 12 6 12 6Z" fill="#a78bfa" />
              <circle cx="12" cy="12" r="2.5" fill="#ffffff" />
            </svg>
            <span className="brand-text-adsgo">AdsGo<span>.ai</span></span>
          </NavLink>
        </div>

        <div className="workspace-selector">
          <div className="workspace-avatar">D</div>
          <div className="workspace-info">
            <span className="workspace-title">Default Brand</span>
            <span className="workspace-sub">Workspace</span>
          </div>
          <span className="workspace-chevron">▼</span>
        </div>

        {businessId && (
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
            <NavLink to="/campaigns" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
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
            <NavLink to="/rules" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
                <span className="sidebar-link-label">Automation Rules</span>
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

            <NavLink to="/admin/workspace" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} style={{ marginTop: 'auto' }} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                <span className="sidebar-link-label">Workspace Settings</span>
              </span>
            </NavLink>

            <NavLink to="/help" className={({ isActive }) => `sidebar-link adsgo-link ${isActive ? "active" : ""}`} onClick={() => setSidebarOpen(false)}>
              <span className="sidebar-link-inner">
                <svg className="sidebar-link-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" /></svg>
                <span className="sidebar-link-label">Help Center</span>
              </span>
            </NavLink>
          </nav>
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
              element={businessId ? <CampaignWizard businessId={businessId} /> : <Navigate to="/login" replace />}
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
            <Route
              path="/integrations"
              element={businessId ? <Integrations businessId={businessId} /> : <Navigate to="/login" replace />}
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

export default function App() {
  const location = useLocation();

  const marketingPage = MARKETING_ROUTES[location.pathname];
  if (marketingPage) {
    return marketingPage;
  }

  return (
    <AuthProvider>
      <CopilotProvider>
        <Routes>
          <Route path="/login" element={<Navigate to="/dashboard" replace />} />
          <Route path="/signup" element={<Navigate to="/dashboard" replace />} />
          <Route path="/get-started" element={<Navigate to="/dashboard" replace />} />
          <Route path="/*" element={<AuthenticatedApp />} />
        </Routes>
      </CopilotProvider>
    </AuthProvider>
  );
}

function OnboardingWrapper() {
  const { businessId, setBusinessId } = useAuth();
  if (businessId) return <Navigate to="/dashboard" replace />;
  return <Onboarding onOnboarded={setBusinessId} />;
}
