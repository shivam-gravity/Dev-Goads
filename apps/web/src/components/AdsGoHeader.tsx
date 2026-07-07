import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClockIcon, GlobeIcon, BellIcon, UserIcon, CreditCardIcon, LinkIcon, LogOutIcon } from "./icons.js";
import { useAuth } from "../context/AuthContext.js";

export default function AdsGoHeader({ breadcrumb }: { breadcrumb: string[] }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileOpen]);

  const name = user?.name ?? "Guest";
  const initials = name.slice(0, 2).toUpperCase();

  function handleLogout() {
    setProfileOpen(false);
    logout();
    navigate("/login");
  }

  function goTo(path: string) {
    setProfileOpen(false);
    navigate(path);
  }

  return (
    <header className="adsgo-header">
      <div className="adsgo-crumb">
        {breadcrumb.map((label, i) => (
          <span key={label} className={i === breadcrumb.length - 1 ? "adsgo-crumb-current" : undefined}>
            {i > 0 ? `› ${label}` : label}
          </span>
        ))}
      </div>
      <div className="adsgo-header-right">
        <div className="header-meta-item">
          <ClockIcon />
          <span>UTC+5.5</span>
        </div>
        <div className="header-meta-item">
          <GlobeIcon />
          <span>English</span>
        </div>
        <div className="header-bell">
          <BellIcon />
        </div>
        <div className="header-profile-dropdown-wrap" ref={profileRef}>
          <div className="header-profile-dropdown" onClick={() => setProfileOpen((o) => !o)}>
            <div className="profile-avatar">{initials}</div>
            <div className="profile-info">
              <span className="profile-name">{name}</span>
              <span className="profile-username">{user?.email ?? name}</span>
            </div>
            <span style={{ fontSize: "10px", color: "#9ca3af", marginLeft: "4px" }}>▼</span>
          </div>
          {profileOpen && (
            <div className="header-profile-menu">
              <div className="header-profile-menu-section-label">Subscription</div>
              <button type="button" className="header-profile-plan-badge" onClick={() => goTo("/profile/subscribe")}>
                <span>Free</span>
                <span className="header-profile-plan-status">
                  <span className="live-dot" /> Free
                </span>
              </button>

              <div className="header-profile-menu-section-label">Manage My CRM Ads</div>
              <button type="button" className="header-profile-menu-item" onClick={() => goTo("/profile/your-profile")}>
                <UserIcon /> User Profile
              </button>
              <button type="button" className="header-profile-menu-item" onClick={() => goTo("/profile/subscribe")}>
                <CreditCardIcon /> Subscription
              </button>

              <div className="header-profile-menu-divider" />
              <div className="header-profile-menu-section-label">Setting</div>
              <button type="button" className="header-profile-menu-item" onClick={() => goTo("/profile/ad-platform-connection")}>
                <LinkIcon /> Ad Account Connect
              </button>
              <button type="button" className="header-profile-menu-item danger" onClick={handleLogout}>
                <LogOutIcon /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
