import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MascotIcon } from "./icons.js";

export default function SiteNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 24);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function closeMobile() {
    setMobileOpen(false);
  }

  return (
    <header className="landing-nav-wrap">
      <div className={`landing-nav ${scrolled ? "scrolled" : ""}`}>
        <Link to="/" className="brand brand-lockup" onClick={closeMobile}>
          <MascotIcon className="mascot mascot-sm hover-wiggle" />
          <span className="brand-text">
            CRM Ads
            <span className="brand-tagline">AI ad automation</span>
          </span>
        </Link>
        <nav className="landing-nav-links">
          <div className="nav-dropdown">
            <button className="nav-dropdown-trigger">
              Features <span className="nav-chevron">⌄</span>
            </button>
            <div className="nav-dropdown-menu">
              <Link to="/features">Overview</Link>
              <Link to="/auto-creative">Auto Creative</Link>
            </div>
          </div>
          <Link to="/pricing">Pricing</Link>
          <div className="nav-dropdown">
            <button className="nav-dropdown-trigger">
              Resources <span className="nav-chevron">⌄</span>
            </button>
            <div className="nav-dropdown-menu">
              <Link to="/resources">Resources</Link>
              <Link to="/blog">Blog</Link>
            </div>
          </div>
          <Link to="/compare">Compare</Link>
        </nav>
        <div className="nav-cta-cluster">
          <Link to="/contact" className="btn btn-secondary">
            Contact
          </Link>
          <Link to="/get-started" className="btn btn-primary">
            Get started
          </Link>
        </div>
        <button
          className={`nav-hamburger ${mobileOpen ? "open" : ""}`}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      <div className={`nav-mobile-panel ${mobileOpen ? "open" : ""}`}>
        <Link to="/features" onClick={closeMobile}>
          Features
        </Link>
        <Link to="/auto-creative" onClick={closeMobile}>
          Auto Creative
        </Link>
        <Link to="/pricing" onClick={closeMobile}>
          Pricing
        </Link>
        <Link to="/resources" onClick={closeMobile}>
          Resources
        </Link>
        <Link to="/blog" onClick={closeMobile}>
          Blog
        </Link>
        <Link to="/compare" onClick={closeMobile}>
          Compare
        </Link>
        <div className="nav-mobile-actions">
          <Link to="/contact" className="btn btn-secondary" onClick={closeMobile}>
            Contact
          </Link>
          <Link to="/get-started" className="btn btn-primary" onClick={closeMobile}>
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
