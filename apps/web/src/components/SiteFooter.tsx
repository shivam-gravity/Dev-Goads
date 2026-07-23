import { Link } from "react-router-dom";
import { MascotIcon } from "./icons.js";

export default function SiteFooter() {
  return (
    <footer className="landing-footer">
      <div className="footer-grid">
        <div className="footer-col footer-brand-col">
          <span className="brand-lockup">
            <MascotIcon className="mascot mascot-sm" />
            <span className="brand-text">
              CRM Ads
              <span className="brand-tagline">AI ad automation</span>
            </span>
          </span>
          <p>AI-generated ad strategy and creative, launched and optimized across Google and Meta.</p>
          <a href="mailto:hello@example.com" className="footer-contact">
            hello@example.com
          </a>
        </div>
        <div className="footer-col">
          <h4>Product</h4>
          <Link to="/features">Features</Link>
          <Link to="/auto-creative">Auto Creative</Link>
          <Link to="/pricing">Pricing</Link>
        </div>
        <div className="footer-col">
          <h4>Company</h4>
          <Link to="/about-us">About us</Link>
          <Link to="/compare">Compare</Link>
          <Link to="/contact">Contact</Link>
        </div>
        <div className="footer-col">
          <h4>Resources</h4>
          <Link to="/resources">Resources</Link>
          <Link to="/blog">Blog</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>CRM Ads — AI Ad Automation</span>
        <div className="footer-bottom-links">
          <Link to="/privacy-policy">Privacy policy</Link>
          <Link to="/terms">Terms of service</Link>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  );
}
