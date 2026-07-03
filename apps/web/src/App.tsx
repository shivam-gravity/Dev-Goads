import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { useState } from "react";
import Onboarding from "./pages/Onboarding.js";
import Dashboard from "./pages/Dashboard.js";
import CampaignDetail from "./pages/CampaignDetail.js";
import Billing from "./pages/Billing.js";

export default function App() {
  const [businessId, setBusinessId] = useState<string | null>(localStorage.getItem("businessId"));

  function handleOnboarded(id: string) {
    localStorage.setItem("businessId", id);
    setBusinessId(id);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">AdGo</div>
        {businessId && (
          <nav className="nav">
            <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "active" : "")}>
              Dashboard
            </NavLink>
            <NavLink to="/billing" className={({ isActive }) => (isActive ? "active" : "")}>
              Billing
            </NavLink>
          </nav>
        )}
      </header>

      <main className="content">
        <Routes>
          <Route
            path="/"
            element={businessId ? <Navigate to="/dashboard" replace /> : <Onboarding onOnboarded={handleOnboarded} />}
          />
          <Route
            path="/dashboard"
            element={businessId ? <Dashboard businessId={businessId} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/campaigns/:campaignId"
            element={businessId ? <CampaignDetail /> : <Navigate to="/" replace />}
          />
          <Route path="/billing" element={businessId ? <Billing businessId={businessId} /> : <Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
